from flask import Blueprint, render_template, request, redirect, url_for, flash, current_app, jsonify, make_response
from datetime import date, datetime, time
from models import User, Log, Pouch, Goal
from services import add_log_entry  # use service layer for adding logs during import
from extensions import db
from routes.auth import login_required, get_current_user
import csv
import io
import json
from werkzeug.utils import secure_filename
import os

# Specify the template folder for import/export templates
import_export_bp = Blueprint('import_export', __name__, template_folder='../templates/data')

ALLOWED_EXTENSIONS = {'csv', 'json'}

def allowed_file(filename):
    """Check if file extension is allowed"""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@import_export_bp.route('/')
@login_required
def index():
    """Import/Export main page"""
    try:
        user = get_current_user()

        # Get some statistics for display
        total_logs = user.logs.count()
        total_pouches = sum(log.quantity for log in user.logs)
        custom_pouches_count = user.custom_pouches.count()

        stats = {
            'total_logs': total_logs,
            'total_pouches': total_pouches,
            'custom_pouches': custom_pouches_count
        }

        return render_template('import_export.html', stats=stats)

    except Exception as e:
        current_app.logger.error(f'Import/Export index error: {e}')
        flash('An error occurred while loading the page.', 'error')
        return render_template('import_export.html', stats={})

@import_export_bp.route('/export/csv')
@login_required
def export_csv():
    """Export logs to CSV"""
    try:
        user = get_current_user()

        # Create CSV data
        output = io.StringIO()
        writer = csv.writer(output)

        # Write header
        writer.writerow([
            'Date', 'Time', 'Brand', 'Nicotine (mg)', 'Quantity',
            'Total Nicotine (mg)', 'Notes', 'Created At'
        ])

        # Write data
        logs = user.logs.order_by(Log.log_date.desc(), Log.log_time.desc()).all()

        for log in logs:
            writer.writerow([
                log.log_date.isoformat(),
                log.log_time.isoformat() if log.log_time else '',
                log.get_brand_name(),
                log.get_nicotine_content(),
                log.quantity,
                log.get_total_nicotine(),
                log.notes or '',
                log.created_at.isoformat() if log.created_at else ''
            ])

        # Create response
        output.seek(0)
        response = make_response(output.getvalue())
        response.headers['Content-Disposition'] = f'attachment; filename=nicotine_logs_{date.today().isoformat()}.csv'
        response.headers['Content-Type'] = 'text/csv'

        current_app.logger.info(f'CSV export completed for user {user.email}: {len(logs)} logs')
        return response

    except Exception as e:
        current_app.logger.error(f'CSV export error: {e}')
        flash('An error occurred while exporting data.', 'error')
        return redirect(url_for('import_export.index'))

@import_export_bp.route('/export/json')
@login_required
def export_json():
    """Export all data to JSON"""
    try:
        user = get_current_user()

        # Collect all data
        export_data = {
            'export_info': {
                'exported_at': datetime.utcnow().isoformat(),
                'user_email': user.email,
                'version': '1.0'
            },
            'logs': [],
            'custom_pouches': [],
            'goals': []
        }

        # Export logs
        for log in user.logs.order_by(Log.log_date.desc()).all():
            log_data = {
                'date': log.log_date.isoformat(),
                'time': log.log_time.isoformat() if log.log_time else None,
                'quantity': log.quantity,
                'notes': log.notes,
                'created_at': log.created_at.isoformat() if log.created_at else None
            }

            if log.pouch:
                log_data['pouch'] = {
                    'brand': log.pouch.brand,
                    'nicotine_mg': log.pouch.nicotine_mg,
                    'is_default': log.pouch.is_default
                }
            else:
                log_data['custom_pouch'] = {
                    'brand': log.custom_brand,
                    'nicotine_mg': log.custom_nicotine_mg
                }

            export_data['logs'].append(log_data)

        # Export custom pouches
        for pouch in user.custom_pouches.all():
            export_data['custom_pouches'].append({
                'brand': pouch.brand,
                'nicotine_mg': pouch.nicotine_mg,
                'created_at': pouch.created_at.isoformat() if pouch.created_at else None
            })

        # Export goals
        for goal in user.goals.all():
            export_data['goals'].append({
                'goal_type': goal.goal_type,
                'target_value': goal.target_value,
                'current_streak': goal.current_streak,
                'best_streak': goal.best_streak,
                'start_date': goal.start_date.isoformat() if goal.start_date else None,
                'end_date': goal.end_date.isoformat() if goal.end_date else None,
                'is_active': goal.is_active,
                'enable_notifications': goal.enable_notifications,
                'notification_threshold': goal.notification_threshold,
                'created_at': goal.created_at.isoformat() if goal.created_at else None
            })

        # Create response
        response = make_response(json.dumps(export_data, indent=2))
        response.headers['Content-Disposition'] = f'attachment; filename=nicotine_tracker_full_export_{date.today().isoformat()}.json'
        response.headers['Content-Type'] = 'application/json'

        current_app.logger.info(f'JSON export completed for user {user.email}')
        return response

    except Exception as e:
        current_app.logger.error(f'JSON export error: {e}')
        flash('An error occurred while exporting data.', 'error')
        return redirect(url_for('import_export.index'))

@import_export_bp.route('/import', methods=['GET', 'POST'])
@login_required
def import_data():
    """Import data from CSV or JSON"""
    try:
        user = get_current_user()

        if request.method == 'POST':
            # Check if file was uploaded
            if 'file' not in request.files:
                flash('No file selected.', 'error')
                return render_template('import_data.html')

            file = request.files['file']

            if file.filename == '':
                flash('No file selected.', 'error')
                return render_template('import_data.html')

            if not allowed_file(file.filename):
                flash('Invalid file type. Please upload a CSV or JSON file.', 'error')
                return render_template('import_data.html')

            # Get import options
            overwrite_existing = request.form.get('overwrite_existing') == 'on'
            import_custom_pouches = request.form.get('import_custom_pouches') == 'on'
            import_goals = request.form.get('import_goals') == 'on'

            try:
                filename = secure_filename(file.filename)
                file_extension = filename.rsplit('.', 1)[1].lower()

                if file_extension == 'csv':
                    result = import_csv_data(user, file, overwrite_existing)
                elif file_extension == 'json':
                    result = import_json_data(user, file, overwrite_existing, import_custom_pouches, import_goals)
                else:
                    flash('Unsupported file format.', 'error')
                    return render_template('import_data.html')

                if result['success']:
                    flash(f'Import completed successfully! {result["message"]}', 'success')
                    current_app.logger.info(f'Data import completed for user {user.email}: {result["message"]}')
                else:
                    flash(f'Import failed: {result["error"]}', 'error')

                return redirect(url_for('import_export.index'))

            except Exception as e:
                current_app.logger.error(f'File processing error: {e}')
                flash('An error occurred while processing the file.', 'error')

        return render_template('import_data.html')

    except Exception as e:
        current_app.logger.error(f'Import data error: {e}')
        flash('An error occurred during import.', 'error')
        return render_template('import_data.html')

def import_csv_data(user, file, overwrite_existing):
    """Import data from CSV file"""
    try:
        # Read CSV content
        stream = io.StringIO(file.stream.read().decode("UTF8"), newline=None)
        csv_input = csv.DictReader(stream)

        imported_count = 0
        skipped_count = 0
        error_count = 0
        errors = []

        for row_num, row in enumerate(csv_input, start=2):  # Start at 2 because of header
            try:
                # Parse required fields
                date_str = row.get('Date', '').strip()
                brand = row.get('Brand', '').strip()
                nicotine_mg_str = row.get('Nicotine (mg)', '').strip()
                quantity_str = row.get('Quantity', '1').strip()

                if not date_str or not brand or not nicotine_mg_str:
                    errors.append(f'Row {row_num}: Missing required fields')
                    error_count += 1
                    continue

                # Parse date
                try:
                    log_date = datetime.strptime(date_str, '%Y-%m-%d').date()
                except ValueError:
                    errors.append(f'Row {row_num}: Invalid date format')
                    error_count += 1
                    continue

                # Parse time (optional)
                log_time = None
                time_str = row.get('Time', '').strip()
                if time_str:
                    try:
                        log_time = datetime.strptime(time_str, '%H:%M:%S').time()
                    except ValueError:
                        try:
                            log_time = datetime.strptime(time_str, '%H:%M').time()
                        except ValueError:
                            errors.append(f'Row {row_num}: Invalid time format')
                            error_count += 1
                            continue

                # Parse nicotine and quantity
                try:
                    nicotine_mg = int(float(nicotine_mg_str))
                    quantity = int(float(quantity_str))
                except ValueError:
                    errors.append(f'Row {row_num}: Invalid numeric values')
                    error_count += 1
                    continue

                # Check for existing log (if not overwriting)
                if not overwrite_existing:
                    existing_log = Log.query.filter_by(
                        user_id=user.id,
                        log_date=log_date,
                        log_time=log_time
                    ).first()

                    if existing_log:
                        skipped_count += 1
                        continue

                # Find or create pouch
                pouch = Pouch.query.filter_by(brand=brand, nicotine_mg=nicotine_mg).first()

                # Add log entry via service layer
                notes = row.get('Notes', '').strip() or None
                if pouch:
                    add_log_entry(
                        user_id=user.id,
                        log_date=log_date,
                        log_time=log_time,
                        quantity=quantity,
                        notes=notes or "",
                        pouch_id=pouch.id
                    )
                else:
                    add_log_entry(
                        user_id=user.id,
                        log_date=log_date,
                        log_time=log_time,
                        quantity=quantity,
                        notes=notes or "",
                        custom_brand=brand,
                        custom_nicotine_mg=nicotine_mg
                    )
                imported_count += 1

            except Exception as e:
                errors.append(f'Row {row_num}: {str(e)}')
                error_count += 1

        # The add_log_entry service commits individually; no additional commit needed for logs

        message = f'Imported {imported_count} logs'
        if skipped_count > 0:
            message += f', skipped {skipped_count} duplicates'
        if error_count > 0:
            message += f', {error_count} errors'

        return {
            'success': imported_count > 0 or (imported_count == 0 and error_count == 0),
            'message': message,
            'errors': errors[:5]  # Return first 5 errors
        }

    except Exception as e:
        db.session.rollback()
        return {
            'success': False,
            'error': f'CSV processing error: {str(e)}'
        }

def import_json_data(user, file, overwrite_existing, import_custom_pouches, import_goals):
    """Import data from JSON file"""
    try:
        # Read JSON content
        json_data = json.load(file.stream)

        imported_logs = 0
        imported_pouches = 0
        imported_goals = 0
        errors = []

        # Import logs
        if 'logs' in json_data:
            for log_data in json_data['logs']:
                try:
                    # Parse date
                    log_date = datetime.strptime(log_data['date'], '%Y-%m-%d').date()

                    # Parse time (optional)
                    log_time = None
                    if log_data.get('time'):
                        try:
                            # Try full HH:MM:SS format first
                            log_time = datetime.strptime(log_data['time'], '%H:%M:%S').time()
                        except ValueError:
                            try:
                                # Fallback to HH:MM format
                                log_time = datetime.strptime(log_data['time'], '%H:%M').time()
                            except ValueError:
                                log_time = None

                    # Check for existing log when not overwriting
                    if not overwrite_existing:
                        existing_log = Log.query.filter_by(
                            user_id=user.id,
                            log_date=log_date,
                            log_time=log_time
                        ).first()
                        if existing_log:
                            continue

                    # Determine quantity and notes
                    quantity = log_data.get('quantity', 1)
                    notes = log_data.get('notes') or ""

                    # Determine pouch or custom details and use service layer to add log
                    if 'pouch' in log_data:
                        pouch_info = log_data['pouch']
                        pouch = Pouch.query.filter_by(
                            brand=pouch_info['brand'],
                            nicotine_mg=pouch_info['nicotine_mg']
                        ).first()
                        if pouch:
                            # Use existing pouch id
                            add_log_entry(
                                user_id=user.id,
                                log_date=log_date,
                                log_time=log_time,
                                quantity=quantity,
                                notes=notes,
                                pouch_id=pouch.id
                            )
                        else:
                            # If pouch not found, treat as custom
                            add_log_entry(
                                user_id=user.id,
                                log_date=log_date,
                                log_time=log_time,
                                quantity=quantity,
                                notes=notes,
                                custom_brand=pouch_info['brand'],
                                custom_nicotine_mg=pouch_info['nicotine_mg']
                            )
                    elif 'custom_pouch' in log_data:
                        custom_pouch = log_data['custom_pouch']
                        add_log_entry(
                            user_id=user.id,
                            log_date=log_date,
                            log_time=log_time,
                            quantity=quantity,
                            notes=notes,
                            custom_brand=custom_pouch['brand'],
                            custom_nicotine_mg=custom_pouch['nicotine_mg']
                        )
                    else:
                        # If no pouch info, treat as unknown custom brand
                        add_log_entry(
                            user_id=user.id,
                            log_date=log_date,
                            log_time=log_time,
                            quantity=quantity,
                            notes=notes,
                            custom_brand='Unknown',
                            custom_nicotine_mg=0
                        )
                    imported_logs += 1

                except Exception as e:
                    errors.append(f'Log import error: {str(e)}')

        # Import custom pouches
        if import_custom_pouches and 'custom_pouches' in json_data:
            for pouch_data in json_data['custom_pouches']:
                try:
                    # Check if pouch already exists for this user
                    existing_pouch = Pouch.query.filter_by(
                        brand=pouch_data['brand'],
                        nicotine_mg=pouch_data['nicotine_mg'],
                        created_by=user.id
                    ).first()
                    if not existing_pouch:
                        new_pouch = Pouch(
                            brand=pouch_data['brand'],
                            nicotine_mg=pouch_data['nicotine_mg'],
                            is_default=False,
                            created_by=user.id
                        )
                        db.session.add(new_pouch)
                        imported_pouches += 1
                except Exception as e:
                    errors.append(f'Pouch import error: {str(e)}')

        # Import goals
        if import_goals and 'goals' in json_data:
            for goal_data in json_data['goals']:
                try:
                    # Skip if similar active goal already exists
                    existing_goal = Goal.query.filter_by(
                        user_id=user.id,
                        goal_type=goal_data['goal_type'],
                        target_value=goal_data['target_value'],
                        is_active=True
                    ).first()
                    if not existing_goal:
                        new_goal = Goal(
                            user_id=user.id,
                            goal_type=goal_data['goal_type'],
                            target_value=goal_data['target_value'],
                            current_streak=goal_data.get('current_streak', 0),
                            best_streak=goal_data.get('best_streak', 0),
                            is_active=goal_data.get('is_active', False),
                            enable_notifications=goal_data.get('enable_notifications', True),
                            notification_threshold=goal_data.get('notification_threshold', 0.8)
                        )
                        # Parse optional start and end dates
                        if goal_data.get('start_date'):
                            new_goal.start_date = datetime.strptime(goal_data['start_date'], '%Y-%m-%d').date()
                        if goal_data.get('end_date'):
                            new_goal.end_date = datetime.strptime(goal_data['end_date'], '%Y-%m-%d').date()
                        db.session.add(new_goal)
                        imported_goals += 1
                except Exception as e:
                    errors.append(f'Goal import error: {str(e)}')

        # Commit remaining changes for pouches and goals (logs are committed individually)
        if imported_pouches > 0 or imported_goals > 0:
            try:
                db.session.commit()
            except Exception as e:
                db.session.rollback()
                return {
                    'success': False,
                    'error': f'Database commit error: {str(e)}'
                }

        message_parts = []
        if imported_logs > 0:
            message_parts.append(f'{imported_logs} logs')
        if imported_pouches > 0:
            message_parts.append(f'{imported_pouches} custom pouches')
        if imported_goals > 0:
            message_parts.append(f'{imported_goals} goals')
        message = f'Imported {", ".join(message_parts)}' if message_parts else 'No new data imported'
        return {
            'success': len(message_parts) > 0,
            'message': message,
            'errors': errors[:5]
        }
    except Exception as e:
        db.session.rollback()
        return {
            'success': False,
            'error': f'JSON processing error: {str(e)}'
        }

@import_export_bp.route('/template/csv')
def download_csv_template():
    """Download CSV template"""
    try:
        # Create template CSV
        output = io.StringIO()
        writer = csv.writer(output)

        # Write header
        writer.writerow([
            'Date', 'Time', 'Brand', 'Nicotine (mg)', 'Quantity', 'Notes'
        ])

        # Write example rows
        writer.writerow([
            '2024-01-15', '09:30', 'ZYN Cool Mint', '6', '2', 'Morning session'
        ])
        writer.writerow([
            '2024-01-15', '14:00', 'VELO Ice Cool', '4', '1', ''
        ])

        # Create response
        output.seek(0)
        response = make_response(output.getvalue())
        response.headers['Content-Disposition'] = 'attachment; filename=nicotine_tracker_template.csv'
        response.headers['Content-Type'] = 'text/csv'

        return response

    except Exception as e:
        current_app.logger.error(f'CSV template error: {e}')
        flash('An error occurred while generating the template.', 'error')
        return redirect(url_for('import_export.index'))
