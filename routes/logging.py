from flask import Blueprint, render_template, request, redirect, url_for, flash, current_app, jsonify, session
from datetime import datetime, time
from datetime import date
from models import User, Log, Pouch
from services import add_log_entry, add_bulk_logs  # use service layer for log creation
from services.timezone_service import convert_utc_to_user_time, get_current_user_time
from extensions import db
from routes.auth import login_required, get_current_user
from sqlalchemy import desc
import re

# Specify the template folder for logging-related templates
logging_bp = Blueprint('logging', __name__, template_folder='../templates/logging')

@logging_bp.route('/add', methods=['GET', 'POST'])
@login_required
def add_log():
    """Add a single log entry"""
    try:
        user = get_current_user()
        if not user:
            current_app.logger.error('Add log error: No current user found')
            return redirect(url_for('auth.login'))
        
        if request.method == 'POST':

            current_app.logger.debug(f"Form data: {request.form.to_dict()}")
            current_app.logger.debug(f"User timezone: {user.timezone}")
            current_app.logger.debug(f"Session timezone: {session.get('user_timezone')}")
            # Get form data
            log_date_str = request.form.get('log_date', date.today().isoformat())
            log_time_str = request.form.get('log_time', '')
            pouch_id = request.form.get('pouch_id')
            custom_brand = request.form.get('custom_brand', '').strip()
            custom_nicotine_mg = request.form.get('custom_nicotine_mg')
            quantity = request.form.get('quantity', 1, type=int)
            notes = request.form.get('notes', '').strip()
            
            # Validation
            if quantity <= 0:
                flash('Quantity must be greater than 0.', 'error')
                return redirect(url_for('logging.add_log'))
            
            # Check if we have UTC values from timezone-aware frontend
            utc_log_date_str = request.form.get('utc_log_date')
            utc_log_time_str = request.form.get('utc_log_time')
            frontend_timezone = request.form.get('user_timezone')
            
            if utc_log_date_str and utc_log_time_str and frontend_timezone:
                # Use UTC values from timezone-aware frontend
                try:
                    log_date = datetime.strptime(utc_log_date_str, '%Y-%m-%d').date()
                    log_time = datetime.strptime(utc_log_time_str, '%H:%M').time()
                except ValueError:
                    flash('Invalid date/time format from timezone conversion.', 'error')
                    return redirect(url_for('logging.add_log'))
            else:
                # Fallback to server-side timezone conversion
                try:
                    log_date = datetime.strptime(log_date_str, '%Y-%m-%d').date()
                except ValueError:
                    flash('Invalid date format.', 'error')
                    return redirect(url_for('logging.add_log'))
                
                # Parse time (optional, in user's timezone)
                log_time = None
                if log_time_str:
                    try:
                        log_time = datetime.strptime(log_time_str, '%H:%M').time()
                    except ValueError:
                        flash('Invalid time format. Use HH:MM format.', 'error')
                        return redirect(url_for('logging.add_log'))
            
            # Use service layer to create log entry
            try:
                # Validate and process pouch selection
                if pouch_id and pouch_id != 'custom':
                    pouch = Pouch.query.get(pouch_id)
                    if not pouch:
                        flash('Selected pouch not found.', 'error')
                        return redirect(url_for('logging.add_log'))
                    # Use existing pouch id
                    if utc_log_date_str and utc_log_time_str:
                        # Direct UTC storage (already converted by frontend)
                        add_log_entry(
                            user_id=user.id,
                            log_date=log_date,
                            log_time=log_time,
                            quantity=quantity,
                            notes=notes,
                            pouch_id=pouch.id,
                            user_timezone=None  # Skip server-side conversion
                        )
                    else:
                        # Server-side timezone conversion
                        add_log_entry(
                            user_id=user.id,
                            log_date=log_date,
                            log_time=log_time,
                            quantity=quantity,
                            notes=notes,
                            pouch_id=pouch.id,
                            user_timezone=user.timezone
                        )
                elif custom_brand and custom_nicotine_mg:
                    try:
                        custom_mg = int(custom_nicotine_mg)
                        if custom_mg <= 0:
                            flash('Custom nicotine content must be greater than 0.', 'error')
                            return redirect(url_for('logging.add_log'))
                        # Create custom log entry
                        if utc_log_date_str and utc_log_time_str:
                            # Direct UTC storage (already converted by frontend)
                            add_log_entry(
                                user_id=user.id,
                                log_date=log_date,
                                log_time=log_time,
                                quantity=quantity,
                                notes=notes,
                                custom_brand=custom_brand,
                                custom_nicotine_mg=custom_mg,
                                user_timezone=None  # Skip server-side conversion
                            )
                        else:
                            # Server-side timezone conversion
                            add_log_entry(
                                user_id=user.id,
                                log_date=log_date,
                                log_time=log_time,
                                quantity=quantity,
                                notes=notes,
                                custom_brand=custom_brand,
                                custom_nicotine_mg=custom_mg,
                                user_timezone=user.timezone
                            )
                    except ValueError:
                        flash('Invalid nicotine content. Please enter a number.', 'error')
                        return redirect(url_for('logging.add_log'))
                else:
                    flash('Please select a pouch or enter custom details.', 'error')
                    return redirect(url_for('logging.add_log'))

                current_app.logger.info(f'Log entry added for user {user.email}: {quantity} pouches')
                flash('Log entry added successfully!', 'success')
                return redirect(url_for('logging.view_logs'))
            except Exception as e:
                current_app.logger.error(f'Add log error: {e}')
                flash('An error occurred while adding the log entry.', 'error')
                return redirect(url_for('logging.add_log'))
        
        # GET request - show form
        pouches = Pouch.query.filter_by(is_default=True).order_by(Pouch.brand, Pouch.nicotine_mg).all()
        user_pouches = Pouch.query.filter_by(created_by=user.id).order_by(Pouch.brand, Pouch.nicotine_mg).all()

        # Get today's date in user's timezone
        if user.timezone:
            _, user_today, user_current_time = get_current_user_time(user.timezone)
            today = user_today.isoformat()
            current_time = user_current_time.strftime('%H:%M')
        else:
            today = date.today().isoformat()
            current_time = datetime.now().time().strftime('%H:%M')
        
        return render_template('add_log.html', 
                             pouches=pouches, 
                             user_pouches=user_pouches, 
                             today=today,
                             current_time=current_time,
                             user_timezone=user.timezone)
        
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f'Add log error: {e}')
        flash('An error occurred while adding the log entry.', 'error')
        return redirect(url_for('logging.add_log'))

@logging_bp.route('/bulk', methods=['GET', 'POST'])
@login_required
def bulk_add():
    """Add multiple log entries at once"""
    try:
        user = get_current_user()
        
        if request.method == 'POST':
            bulk_text = request.form.get('bulk_text', '').strip()
            log_date_str = request.form.get('log_date', date.today().isoformat())
            
            if not bulk_text:
                flash('Please enter bulk log data.', 'error')
                return render_template('bulk_add.html')
            
            # Parse date (in user's timezone)
            try:
                log_date = datetime.strptime(log_date_str, '%Y-%m-%d').date()
            except ValueError:
                flash('Invalid date format.', 'error')
                return render_template('bulk_add.html')
            
            # Parse bulk text
            entries = parse_bulk_text(bulk_text)
            
            if not entries:
                flash('No valid entries found in bulk text.', 'error')
                return render_template('bulk_add.html')
            
            # Use service layer to process all entries at once with timezone
            try:
                added_count = add_bulk_logs(user_id=user.id, entries=entries, log_date=log_date, user_timezone=user.timezone)
                if added_count > 0:
                    current_app.logger.info(f'Bulk log entries added for user {user.email}: {added_count} entries')
                    flash(f'Successfully added {added_count} log entries!', 'success')
                else:
                    flash('No entries could be processed.', 'error')
                return redirect(url_for('logging.view_logs'))
            except Exception as e:
                current_app.logger.error(f'Bulk add error: {e}')
                flash('An error occurred during bulk entry.', 'error')
                return render_template('bulk_add.html')
        
        return render_template('bulk_add.html')
        
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f'Bulk add error: {e}')
        flash('An error occurred during bulk entry.', 'error')
        return render_template('bulk_add.html')

def parse_bulk_text(text):
    """Parse bulk text input into log entries"""
    entries = []
    lines = text.strip().split('\n')
    
    for line in lines:
        line = line.strip()
        if not line:
            continue
        
        try:
            # Pattern: "5 pouches at 09:00" or "3 ZYN 6mg at 14:30"
            # More flexible patterns
            patterns = [
                r'(\d+)\s+pouches?\s+at\s+(\d{1,2}):(\d{2})',
                r'(\d+)\s+([^0-9]+?)\s+(\d+)mg\s+at\s+(\d{1,2}):(\d{2})',
                r'(\d+)\s+([^0-9]+?)\s+at\s+(\d{1,2}):(\d{2})',
                r'(\d+)\s+pouches?',
                r'(\d+)\s+([^0-9]+?)\s+(\d+)mg',
            ]
            
            entry = None
            
            for pattern in patterns:
                match = re.search(pattern, line, re.IGNORECASE)
                if match:
                    groups = match.groups()
                    
                    if len(groups) == 3 and ':' in line:  # quantity pouches at time
                        quantity, hour, minute = groups
                        entry = {
                            'quantity': int(quantity),
                            'time': time(int(hour), int(minute))
                        }
                    elif len(groups) == 5:  # quantity brand mg at time
                        quantity, brand, nicotine_mg, hour, minute = groups
                        entry = {
                            'quantity': int(quantity),
                            'brand': brand.strip(),
                            'nicotine_mg': int(nicotine_mg),
                            'time': time(int(hour), int(minute))
                        }
                    elif len(groups) == 4:  # quantity brand at time
                        quantity, brand, hour, minute = groups
                        entry = {
                            'quantity': int(quantity),
                            'brand': brand.strip(),
                            'time': time(int(hour), int(minute))
                        }
                    elif len(groups) == 1:  # just quantity
                        quantity = groups[0]
                        entry = {
                            'quantity': int(quantity)
                        }
                    elif len(groups) == 3 and 'mg' in line:  # quantity brand mg
                        quantity, brand, nicotine_mg = groups
                        entry = {
                            'quantity': int(quantity),
                            'brand': brand.strip(),
                            'nicotine_mg': int(nicotine_mg)
                        }
                    
                    break
            
            if entry:
                entries.append(entry)
                
        except (ValueError, IndexError):
            # Skip invalid lines
            continue
    
    return entries

@logging_bp.route('/view')
@login_required
def view_logs():
    """View log history"""
    try:
        user = get_current_user()
        page = request.args.get('page', 1, type=int)
        per_page = current_app.config.get('LOGS_PER_PAGE', 20)
        
        # Get logs with pagination
        logs = Log.query.filter_by(user_id=user.id).order_by(
            desc(Log.log_date), desc(Log.log_time), desc(Log.created_at)
        ).paginate(
            page=page, per_page=per_page, error_out=False
        )
        
        # Calculate daily totals for displayed logs (convert to user timezone for grouping)
        daily_totals = {}
        for log in logs.items:
            # Convert UTC log datetime to user's timezone for proper daily grouping
            if user.timezone and log.log_time:
                _, user_date, _ = convert_utc_to_user_time(user.timezone, log.log_time)
                date_key = user_date
            else:
                date_key = log.log_time.date() if log.log_time else log.log_date
            
            if date_key not in daily_totals:
                daily_totals[date_key] = {'pouches': 0, 'mg': 0}
            
            daily_totals[date_key]['pouches'] += log.quantity
            daily_totals[date_key]['mg'] += log.get_total_nicotine()
        
        return render_template('view_logs.html', 
                             logs=logs, 
                             daily_totals=daily_totals,
                             user_timezone=user.timezone)
        
    except Exception as e:
        current_app.logger.error(f'View logs error: {e}')
        flash('An error occurred while loading logs.', 'error')
        return render_template('view_logs.html', logs=None)

@logging_bp.route('/edit/<int:log_id>', methods=['GET', 'POST'])
@login_required
def edit_log(log_id):
    """Edit a log entry"""
    try:
        user = get_current_user()
        log_entry = Log.query.filter_by(id=log_id, user_id=user.id).first()
        
        if not log_entry:
            flash('Log entry not found.', 'error')
            return redirect(url_for('logging.view_logs'))
        
        if request.method == 'POST':
            # Update log entry
            log_date_str = request.form.get('log_date')
            log_time_str = request.form.get('log_time', '')
            quantity = request.form.get('quantity', 1, type=int)
            notes = request.form.get('notes', '').strip()
            
            # Validation
            if quantity <= 0:
                flash('Quantity must be greater than 0.', 'error')
                return render_template('edit_log.html', log=log_entry, user_timezone=user.timezone)
            
            # Parse date (in user's timezone)
            try:
                user_date = datetime.strptime(log_date_str, '%Y-%m-%d').date()
            except ValueError:
                flash('Invalid date format.', 'error')
                return render_template('edit_log.html', log=log_entry, user_timezone=user.timezone)
            
            # Parse time (optional, in user's timezone)
            user_time = None
            if log_time_str:
                try:
                    user_time = datetime.strptime(log_time_str, '%H:%M').time()
                except ValueError:
                    flash('Invalid time format. Use HH:MM format.', 'error')
                    return render_template('edit_log.html', log=log_entry, user_timezone=user.timezone)
            
            # Convert user's date/time to UTC for storage
            from services.timezone_service import convert_user_time_to_utc
            if user_time is not None:
                utc_datetime, _, _ = convert_user_time_to_utc(user.timezone, user_date, user_time)
            else:
                # Use current time if no time specified
                _, current_date, current_time = get_current_user_time(user.timezone)
                utc_datetime, _, _ = convert_user_time_to_utc(user.timezone, user_date, current_time)
            
            log_entry.log_date = utc_datetime.date()  # Keep for backward compatibility
            log_entry.log_time = utc_datetime  # Store complete UTC datetime
            
            log_entry.quantity = quantity
            log_entry.notes = notes
            
            db.session.commit()
            
            current_app.logger.info(f'Log entry updated for user {user.email}: log_id {log_id}')
            flash('Log entry updated successfully!', 'success')
            return redirect(url_for('logging.view_logs'))
        
        return render_template('edit_log.html', log=log_entry, user_timezone=user.timezone)
        
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f'Edit log error: {e}')
        flash('An error occurred while editing the log entry.', 'error')
        return redirect(url_for('logging.view_logs'))

@logging_bp.route('/delete/<int:log_id>', methods=['POST'])
@login_required
def delete_log(log_id):
    """Delete a log entry"""
    try:
        user = get_current_user()
        log_entry = Log.query.filter_by(id=log_id, user_id=user.id).first()
        
        if not log_entry:
            flash('Log entry not found.', 'error')
            return redirect(url_for('logging.view_logs'))
        
        db.session.delete(log_entry)
        db.session.commit()
        
        current_app.logger.info(f'Log entry deleted for user {user.email}: log_id {log_id}')
        flash('Log entry deleted successfully!', 'success')
        
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f'Delete log error: {e}')
        flash('An error occurred while deleting the log entry.', 'error')
    
    return redirect(url_for('logging.view_logs'))

@logging_bp.route('/api/quick_add', methods=['POST'])
@login_required
def quick_add_api():
    """API endpoint for quick log addition"""
    try:
        user = get_current_user()
        data = request.get_json()
        
        if not data:
            return jsonify({'success': False, 'error': 'No data provided'})
        
        pouch_id = data.get('pouch_id')
        quantity = data.get('quantity', 1)
        
        if not pouch_id or quantity <= 0:
            return jsonify({'success': False, 'error': 'Invalid data'})
        
        pouch = Pouch.query.get(pouch_id)
        if not pouch:
            return jsonify({'success': False, 'error': 'Pouch not found'})
        
        # Use service layer to create quick log entry with current date and time in user's timezone
        try:
            _, user_date, user_time = get_current_user_time(user.timezone)
            add_log_entry(
                user_id=user.id,
                log_date=user_date,
                log_time=user_time,
                quantity=quantity,
                notes="",
                pouch_id=pouch.id,
                user_timezone=user.timezone
            )
            return jsonify({
                'success': True,
                'message': f'Added {quantity} {pouch.brand} ({pouch.nicotine_mg}mg)'
            })
        except Exception as e:
            current_app.logger.error(f'Quick add API error: {e}')
            return jsonify({'success': False, 'error': 'Server error'})
        
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f'Quick add API error: {e}')
        return jsonify({'success': False, 'error': 'Server error'})
