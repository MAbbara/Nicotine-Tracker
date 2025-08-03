from flask import Blueprint, render_template, request, redirect, url_for, flash, current_app, session
from models import User, Log, Pouch, Goal        # import models from the package
from extensions import db
from routes.auth import login_required, get_current_user
import json
from datetime import datetime

# Specify the template folder for settings-related templates
settings_bp = Blueprint('settings', __name__, template_folder='../templates/settings')

@settings_bp.route('/')
@login_required
def index():
    """Settings main page"""
    try:
        user = get_current_user()
        return render_template('settings.html', user=user)
    except Exception as e:
        current_app.logger.error(f'Settings index error: {e}')
        flash('An error occurred while loading settings.', 'error')
        return render_template('settings.html', user=get_current_user())

@settings_bp.route('/preferences', methods=['GET', 'POST'])
@login_required
def preferences():
    """User preferences settings"""
    try:
        user = get_current_user()
        
        if request.method == 'POST':
            # Get form data
            units_preference = request.form.get('units_preference', 'mg').strip()
            timezone = request.form.get('timezone', 'UTC').strip()
            
            # Notification preferences
            email_notifications = request.form.get('email_notifications') == 'on'
            goal_notifications = request.form.get('goal_notifications') == 'on'
            daily_reminders = request.form.get('daily_reminders') == 'on'
            discord_webhook = request.form.get('discord_webhook', '').strip()
            
            # Display preferences
            default_view = request.form.get('default_view', 'dashboard').strip()
            chart_theme = request.form.get('chart_theme', 'light').strip()
            logs_per_page = request.form.get('logs_per_page', 20, type=int)
            
            # Validation
            if units_preference not in ['mg', 'percentage']:
                flash('Please select a valid units preference.', 'error')
                return render_template('preferences.html', user=user)
            
            if default_view not in ['dashboard', 'logs', 'catalog']:
                flash('Please select a valid default view.', 'error')
                return render_template('preferences.html', user=user)
            
            if chart_theme not in ['light', 'dark']:
                flash('Please select a valid chart theme.', 'error')
                return render_template('preferences.html', user=user)
            
            if logs_per_page < 5 or logs_per_page > 100:
                flash('Logs per page must be between 5 and 100.', 'error')
                return render_template('preferences.html', user=user)
            
            # Update user preferences
            user.units_preference = units_preference
            user.timezone = timezone
            
            # Store additional preferences as JSON-like dict (extend the model if needed)
            preferences_data = {
                'email_notifications': email_notifications,
                'goal_notifications': goal_notifications,
                'daily_reminders': daily_reminders,
                'discord_webhook': discord_webhook,
                'default_view': default_view,
                'chart_theme': chart_theme,
                'logs_per_page': logs_per_page
            }
            # For now, we'll store in session (in production, extend User model)
            session['user_preferences'] = preferences_data
            
            db.session.commit()
            
            current_app.logger.info(f'Preferences updated for user {user.email}')
            flash('Preferences updated successfully!', 'success')
            return redirect(url_for('settings.preferences'))
        
        # GET request - load current preferences
        current_preferences = session.get('user_preferences', {
            'email_notifications': True,
            'goal_notifications': True,
            'daily_reminders': False,
            'discord_webhook': '',
            'default_view': 'dashboard',
            'chart_theme': 'light',
            'logs_per_page': 20
        })
        
        return render_template('preferences.html', user=user, preferences=current_preferences)
        
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f'Preferences error: {e}')
        flash('An error occurred while updating preferences.', 'error')
        return render_template('preferences.html', user=get_current_user())

@settings_bp.route('/privacy', methods=['GET', 'POST'])
@login_required
def privacy():
    """Privacy settings"""
    try:
        user = get_current_user()
        
        if request.method == 'POST':
            action = request.form.get('action')
            
            if action == 'anonymize_data':
                # Anonymize user data (keep logs but remove personal info)
                user.age = None
                user.gender = None
                user.weight = None
                user.preferred_brands = None
                
                # Clear notes from logs
                user_logs = Log.query.filter_by(user_id=user.id).all()
                for log in user_logs:
                    log.notes = None
                
                db.session.commit()
                
                current_app.logger.info(f'Data anonymized for user {user.email}')
                flash('Your personal data has been anonymized successfully.', 'success')
                
            elif action == 'delete_old_logs':
                days_to_keep = request.form.get('days_to_keep', 365, type=int)
                
                if days_to_keep < 30:
                    flash('You must keep at least 30 days of data.', 'error')
                    return render_template('privacy.html', user=user)
                
                # Delete logs older than specified days
                from datetime import date, timedelta
                cutoff_date = date.today() - timedelta(days=days_to_keep)
                old_logs = Log.query.filter(
                    Log.user_id == user.id,
                    Log.log_date < cutoff_date
                ).all()
                
                deleted_count = len(old_logs)
                for log in old_logs:
                    db.session.delete(log)
                
                db.session.commit()
                
                current_app.logger.info(f'Deleted {deleted_count} old logs for user {user.email}')
                flash(f'Successfully deleted {deleted_count} old log entries.', 'success')
                
            elif action == 'export_data':
                # Redirect to export functionality
                return redirect(url_for('import_export.export_json'))
                
            return redirect(url_for('settings.privacy'))
        
        # Calculate data statistics
        total_logs = user.logs.count()
        oldest_log = user.logs.order_by(Log.log_date.asc()).first()
        newest_log = user.logs.order_by(Log.log_date.desc()).first()
        
        data_stats = {
            'total_logs': total_logs,
            'oldest_log_date': oldest_log.log_date if oldest_log else None,
            'newest_log_date': newest_log.log_date if newest_log else None,
            'custom_pouches': user.custom_pouches.count(),
            'active_goals': user.goals.filter_by(is_active=True).count()
        }
        
        return render_template('privacy.html', user=user, data_stats=data_stats)
        
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f'Privacy settings error: {e}')
        flash('An error occurred while processing privacy settings.', 'error')
        return render_template('privacy.html', user=get_current_user())

@settings_bp.route('/data_management', methods=['GET', 'POST'])
@login_required
def data_management():
    """Data management settings"""
    try:
        user = get_current_user()
        
        if request.method == 'POST':
            action = request.form.get('action')
            
            if action == 'cleanup_duplicates':
                # Find and remove duplicate log entries
                duplicates_removed = cleanup_duplicate_logs(user)
                if duplicates_removed > 0:
                    flash(f'Removed {duplicates_removed} duplicate log entries.', 'success')
                    current_app.logger.info(f'Cleaned up {duplicates_removed} duplicates for user {user.email}')
                else:
                    flash('No duplicate entries found.', 'info')
                    
            elif action == 'merge_custom_pouches':
                # Merge similar custom pouches
                merged_count = merge_similar_pouches(user)
                if merged_count > 0:
                    flash(f'Merged {merged_count} similar pouch entries.', 'success')
                    current_app.logger.info(f'Merged {merged_count} pouches for user {user.email}')
                else:
                    flash('No similar pouches found to merge.', 'info')
                    
            elif action == 'recalculate_goals':
                # Recalculate goal streaks
                updated_goals = recalculate_goal_streaks(user)
                flash(f'Recalculated streaks for {updated_goals} goals.', 'success')
                current_app.logger.info(f'Recalculated goal streaks for user {user.email}')
                
            return redirect(url_for('settings.data_management'))
        
        # Get data statistics
        from sqlalchemy import func
        
        # Check for potential duplicates
        duplicate_check = db.session.query(
            Log.log_date,
            Log.log_time,
            func.count(Log.id).label('count')
        ).filter_by(user_id=user.id).group_by(
            Log.log_date, Log.log_time
        ).having(func.count(Log.id) > 1).all()
        potential_duplicates = len(duplicate_check)
        
        # Check for similar custom pouches
        custom_pouches = user.custom_pouches.all()
        similar_pouches = 0
        for i, pouch1 in enumerate(custom_pouches):
            for pouch2 in custom_pouches[i+1:]:
                if (pouch1.brand.lower().strip() == pouch2.brand.lower().strip() and 
                    pouch1.nicotine_mg == pouch2.nicotine_mg):
                    similar_pouches += 1
        
        data_stats = {
            'total_logs': user.logs.count(),
            'custom_pouches': len(custom_pouches),
            'active_goals': user.goals.filter_by(is_active=True).count(),
            'potential_duplicates': potential_duplicates,
            'similar_pouches': similar_pouches
        }
        
        return render_template('data_management.html', user=user, data_stats=data_stats)
        
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f'Data management error: {e}')
        flash('An error occurred while managing data.', 'error')
        return render_template('data_management.html', user=get_current_user())

@settings_bp.route('/account', methods=['GET', 'POST'])
@login_required
def account():
    """Account settings"""
    try:
        user = get_current_user()
        
        if request.method == 'POST':
            action = request.form.get('action')
            
            if action == 'update_email':
                new_email = request.form.get('new_email', '').strip().lower()
                password = request.form.get('password', '')
                
                # Validation
                if not new_email or '@' not in new_email:
                    flash('Please enter a valid email address.', 'error')
                    return render_template('account.html', user=user)
                
                if not user.check_password(password):
                    flash('Current password is incorrect.', 'error')
                    return render_template('account.html', user=user)
                
                # Check if email already exists
                existing_user = User.query.filter_by(email=new_email).first()
                if existing_user and existing_user.id != user.id:
                    flash('This email address is already in use.', 'error')
                    return render_template('account.html', user=user)
                
                # Update email
                old_email = user.email
                user.email = new_email
                user.email_verified = False  # Require re-verification
                user.generate_verification_token()
                
                db.session.commit()
                
                current_app.logger.info(f'Email changed from {old_email} to {new_email}')
                flash('Email updated successfully! Please verify your new email address.', 'success')
                
            elif action == 'download_data':
                # Redirect to data export
                return redirect(url_for('profile.export_data'))
                
            elif action == 'delete_account':
                # Redirect to account deletion
                return redirect(url_for('profile.delete_account'))
                
            return redirect(url_for('settings.account'))
        
        # Get account statistics
        account_stats = {
            'member_since': user.created_at.strftime('%B %d, %Y') if user.created_at else 'Unknown',
            'email_verified': user.email_verified,
            'total_logs': user.logs.count(),
            'total_pouches_logged': sum(log.quantity for log in user.logs),
            'custom_pouches_created': user.custom_pouches.count(),
            'goals_created': user.goals.count()
        }
        
        return render_template('account.html', user=user, account_stats=account_stats)
        
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f'Account settings error: {e}')
        flash('An error occurred while updating account settings.', 'error')
        return render_template('account.html', user=get_current_user())

def cleanup_duplicate_logs(user):
    """Remove duplicate log entries for a user"""
    try:
        from sqlalchemy import func
        
        # Find duplicates based on date, time, and pouch
        duplicates = db.session.query(
            Log.log_date,
            Log.log_time,
            Log.pouch_id,
            Log.custom_brand,
            Log.custom_nicotine_mg,
            func.min(Log.id).label('keep_id'),
            func.count(Log.id).label('count')
        ).filter_by(user_id=user.id).group_by(
            Log.log_date, Log.log_time, Log.pouch_id, Log.custom_brand, Log.custom_nicotine_mg
        ).having(func.count(Log.id) > 1).all()
        
        removed_count = 0
        for duplicate in duplicates:
            # Keep the first log, delete the rest
            logs_to_delete = Log.query.filter(
                Log.user_id == user.id,
                Log.log_date == duplicate.log_date,
                Log.log_time == duplicate.log_time,
                Log.pouch_id == duplicate.pouch_id,
                Log.custom_brand == duplicate.custom_brand,
                Log.custom_nicotine_mg == duplicate.custom_nicotine_mg,
                Log.id != duplicate.keep_id
            ).all()
            for log in logs_to_delete:
                db.session.delete(log)
                removed_count += 1
        
        db.session.commit()
        return removed_count
        
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f'Cleanup duplicates error: {e}')
        return 0

def merge_similar_pouches(user):
    """Merge similar custom pouches"""
    try:
        custom_pouches = user.custom_pouches.all()
        merged_count = 0
        
        # Group pouches by brand and nicotine content
        pouch_groups = {}
        for pouch in custom_pouches:
            key = (pouch.brand.lower().strip(), pouch.nicotine_mg)
            if key not in pouch_groups:
                pouch_groups[key] = []
            pouch_groups[key].append(pouch)
        
        # Merge groups with multiple pouches
        for group in pouch_groups.values():
            if len(group) > 1:
                # Keep the oldest pouch, merge others into it
                keep_pouch = min(group, key=lambda p: p.created_at or datetime.min)
                for pouch in group:
                    if pouch.id != keep_pouch.id:
                        # Update logs to use the kept pouch
                        logs_to_update = Log.query.filter_by(pouch_id=pouch.id).all()
                        for log in logs_to_update:
                            log.pouch_id = keep_pouch.id
                        # Delete the duplicate pouch
                        db.session.delete(pouch)
                        merged_count += 1
        
        db.session.commit()
        return merged_count
        
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f'Merge pouches error: {e}')
        return 0

def recalculate_goal_streaks(user):
    """Recalculate goal streaks for all user goals"""
    try:
        goals = user.goals.all()
        updated_count = 0
        
        for goal in goals:
            # Reset streaks
            goal.current_streak = 0
            goal.best_streak = 0
            
            # Recalculate from start date or 30 days ago
            from datetime import date, timedelta
            start_date = goal.start_date or (date.today() - timedelta(days=30))
            current_date = start_date
            current_streak = 0
            best_streak = 0
            
            while current_date <= date.today():
                if goal.check_goal_progress(current_date):
                    current_streak += 1
                    best_streak = max(best_streak, current_streak)
                else:
                    current_streak = 0
                current_date += timedelta(days=1)
            
            # Update current streak (consecutive days from today backwards)
            current_streak = 0
            check_date = date.today()
            while check_date >= start_date:
                if goal.check_goal_progress(check_date):
                    current_streak += 1
                    check_date -= timedelta(days=1)
                else:
                    break
            
            goal.current_streak = current_streak
            goal.best_streak = best_streak
            updated_count += 1
        
        db.session.commit()
        return updated_count
        
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f'Recalculate streaks error: {e}')
        return 0
