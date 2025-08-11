from flask import Blueprint, render_template, request, redirect, url_for, flash, current_app, session, jsonify
from models import User, Log, Pouch, Goal        # import models from the package
from extensions import db
from routes.auth import login_required, get_current_user
from services.timezone_service import get_all_timezones_for_dropdown, get_common_timezones
from services.user_preferences_service import UserPreferencesService
from services.notification_service import NotificationService
from services.email_verification_service import EmailVerificationService
import json
from datetime import datetime

# Specify the template folder for settings-related templates
settings_bp = Blueprint('settings', __name__, template_folder='../templates/settings')

@settings_bp.route('/', methods=['GET'])
@login_required
def index():
    """Settings main page"""
    try:
        user = get_current_user()
        preferences_service = UserPreferencesService()
        
        # GET request - load current preferences from database

        current_preferences = preferences_service.get_notification_settings(user.id)
        webhook_settings = preferences_service.get_webhook_settings(user.id)
        
        if not current_preferences:
            # Fallback to defaults if service fails
            current_preferences = {
                'email_notifications': True,
                'goal_notifications': True,
                'achievement_notifications': True,
                'daily_reminders': False,
                'weekly_reports': False,
                'reminder_time': None,
                'quiet_hours_start': None,
                'quiet_hours_end': None,
                'notification_frequency': 'immediate'
            }
        
        if not webhook_settings:
            webhook_settings = {
                'discord_webhook': '',
                'slack_webhook': ''
            }
        
        # Merge webhook settings into preferences for template
        current_preferences.update(webhook_settings)
        
        # Get timezone data for dropdown
        all_timezones = get_all_timezones_for_dropdown()
        common_timezones = get_common_timezones()
        
        return render_template('settings.html', 
                             user=user, 
                             preferences=current_preferences,
                             all_timezones=all_timezones,
                             common_timezones=common_timezones)
    except Exception as e:
        current_app.logger.error(f'Settings index error: {e}')
        flash('An error occurred while loading settings.', 'error')
        
        # Provide default preferences even on error
        default_preferences = {
            'email_notifications': True,
            'goal_notifications': True,
            'achievement_notifications': True,
            'daily_reminders': False,
            'weekly_reports': False,
            'discord_webhook': '',
            'reminder_time': None,
            'quiet_hours_start': None,
            'quiet_hours_end': None,
            'notification_frequency': 'immediate'
        }
        
        # Get timezone data for dropdown even on error
        try:
            all_timezones = get_all_timezones_for_dropdown()
            common_timezones = get_common_timezones()
        except Exception:
            all_timezones = []
            common_timezones = [('UTC', 'UTC (Coordinated Universal Time)')]
        
        return render_template('settings.html', 
                             user=get_current_user(), 
                             preferences=default_preferences,
                             all_timezones=all_timezones,
                             common_timezones=common_timezones)

@settings_bp.route('/test-discord-webhook', methods=['POST'])
@login_required
def test_discord_webhook():
    """Test Discord webhook endpoint"""
    try:
        data = request.get_json()
        webhook_url = data.get('webhook_url', '').strip()
        
        if not webhook_url:
            return jsonify({
                'success': False,
                'message': 'Please provide a webhook URL.'
            }), 400
        
        # Validate URL format
        if not webhook_url.startswith('https://discord.com/api/webhooks/'):
            return jsonify({
                'success': False,
                'message': 'Please provide a valid Discord webhook URL.'
            }), 400
        
        # Test the webhook
        notification_service = NotificationService()
        success, message = notification_service.test_discord_webhook(webhook_url)
        
        return jsonify({
            'success': success,
            'message': message
        })
        
    except Exception as e:
        current_app.logger.error(f'Discord webhook test error: {e}')
        return jsonify({
            'success': False,
            'message': 'An error occurred while testing the webhook.'
        }), 500

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
                # Export user data directly
                return export_user_data(user)
                
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

@settings_bp.route('/profile', methods=['GET', 'POST'])
@login_required
def profile():
    """User profile settings"""
    try:
        user = get_current_user()
        
        if request.method == 'POST':
            # Get form data
            age = request.form.get('age', type=int)
            gender = request.form.get('gender', '').strip()
            weight = request.form.get('weight', type=float)
            timezone = request.form.get('timezone', 'UTC').strip()
            units_preference = request.form.get('units_preference', 'mg').strip()
            
            # Get preferred brands (multiple selection)
            preferred_brands = request.form.getlist('preferred_brands')
            
            # Validation
            if age is not None and (age < 18 or age > 120):
                flash('Please enter a valid age between 18 and 120.', 'error')
                return render_template('profile.html', user=user)
            
            if weight is not None and (weight < 30 or weight > 500):
                flash('Please enter a valid weight between 30 and 500 kg.', 'error')
                return render_template('profile.html', user=user)
            
            if gender and gender not in ['male', 'female', 'other', 'prefer_not_to_say']:
                flash('Please select a valid gender option.', 'error')
                return render_template('profile.html', user=user)
            
            if units_preference not in ['mg', 'percentage']:
                flash('Please select a valid units preference.', 'error')
                return render_template('profile.html', user=user)
            
            # Update user profile
            user.age = age
            user.gender = gender if gender else None
            user.weight = weight
            user.timezone = timezone
            user.units_preference = units_preference
            
            # Update session timezone for immediate effect
            session['user_timezone'] = timezone
            
            # Store preferred brands as JSON
            if preferred_brands:
                user.preferred_brands = json.dumps(preferred_brands)
            else:
                user.preferred_brands = None
            
            db.session.commit()
            
            current_app.logger.info(f'Profile updated for user {user.email}')
            flash('Profile updated successfully!', 'success')
            return redirect(url_for('settings.profile'))
        
        # GET request - display profile
        # Parse preferred brands from JSON
        preferred_brands = []
        if user.preferred_brands:
            try:
                preferred_brands = json.loads(user.preferred_brands)
            except (json.JSONDecodeError, TypeError):
                preferred_brands = []
        
        # Get available brands for selection
        from models import Pouch
        available_brands = db.session.query(Pouch.brand).distinct().order_by(Pouch.brand).all()
        available_brands = [brand[0] for brand in available_brands]
        
        # Get timezone data
        from services.timezone_service import get_common_timezones, get_all_timezones_for_dropdown
        common_timezones = get_common_timezones()
        all_timezones = get_all_timezones_for_dropdown()
        
        return render_template('profile.html', 
                             user=user, 
                             preferred_brands=preferred_brands,
                             available_brands=available_brands,
                             common_timezones=common_timezones,
                             all_timezones=all_timezones)
        
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f'Profile error: {e}')
        flash('An error occurred while updating your profile.', 'error')
        return render_template('profile.html', user=get_current_user())

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
                
                db.session.commit()
                
                # Send verification email for new address
                verification_service = EmailVerificationService()
                verification_service.send_verification_email(user.id)
                
                current_app.logger.info(f'Email changed from {old_email} to {new_email}')
                flash('Email updated successfully! Please verify your new email address.', 'success')
                
            elif action == 'change_password':
                current_password = request.form.get('current_password', '')
                new_password = request.form.get('new_password', '')
                confirm_password = request.form.get('confirm_password', '')
                
                # Validation
                if not current_password:
                    flash('Please enter your current password.', 'error')
                    return render_template('account.html', user=user)
                
                if not user.check_password(current_password):
                    flash('Current password is incorrect.', 'error')
                    return render_template('account.html', user=user)
                
                if len(new_password) < 6:
                    flash('New password must be at least 6 characters long.', 'error')
                    return render_template('account.html', user=user)
                
                if new_password != confirm_password:
                    flash('New passwords do not match.', 'error')
                    return render_template('account.html', user=user)
                
                if current_password == new_password:
                    flash('New password must be different from current password.', 'error')
                    return render_template('account.html', user=user)
                
                # Update password
                user.set_password(new_password)
                db.session.commit()
                
                current_app.logger.info(f'Password changed for user {user.email}')
                flash('Password changed successfully!', 'success')
                
            elif action == 'download_data':
                # Export user data directly
                return export_user_data(user)
                
            elif action == 'resend_verification':
                # Resend email verification
                if user.email_verified:
                    flash('Your email is already verified.', 'info')
                else:
                    verification_service = EmailVerificationService()
                    success, message = verification_service.send_verification_email(user.id)
                    
                    if success:
                        flash('Verification email sent successfully! Please check your inbox.', 'success')
                        current_app.logger.info(f'Verification email resent for user {user.email}')
                    else:
                        flash(f'Failed to send verification email: {message}', 'error')
                        current_app.logger.error(f'Failed to resend verification email for user {user.email}: {message}')
                
            elif action == 'delete_account':
                password = request.form.get('password', '')
                confirmation = request.form.get('confirmation', '')
                
                # Validation
                if not password:
                    flash('Please enter your password to confirm account deletion.', 'error')
                    return render_template('account.html', user=user)
                
                if not user.check_password(password):
                    flash('Password is incorrect.', 'error')
                    return render_template('account.html', user=user)
                
                if confirmation.lower() != 'delete my account':
                    flash('Please type "delete my account" to confirm.', 'error')
                    return render_template('account.html', user=user)
                
                # Log the deletion
                user_email = user.email
                current_app.logger.info(f'Account deletion initiated for user {user_email}')
                
                # Delete user account (cascade will handle related records)
                db.session.delete(user)
                db.session.commit()
                
                # Clear session
                from flask import session
                session.clear()
                
                current_app.logger.info(f'Account deleted for user {user_email}')
                flash('Your account has been deleted successfully.', 'info')
                return redirect(url_for('index'))
                
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

def export_user_data(user):
    """Export user data (GDPR compliance)"""
    try:
        # Collect all user data
        user_data = {
            'profile': {
                'email': user.email,
                'created_at': user.created_at.isoformat() if user.created_at else None,
                'age': user.age,
                'gender': user.gender,
                'weight': user.weight,
                'timezone': user.timezone,
                'units_preference': user.units_preference,
                'preferred_brands': json.loads(user.preferred_brands) if user.preferred_brands else None,
                'email_verified': user.email_verified
            },
            'logs': [],
            'custom_pouches': [],
            'goals': []
        }
        
        # Get logs
        for log in user.logs:
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
                    'nicotine_mg': log.pouch.nicotine_mg
                }
            else:
                log_data['custom_pouch'] = {
                    'brand': log.custom_brand,
                    'nicotine_mg': log.custom_nicotine_mg
                }
            
            user_data['logs'].append(log_data)
        
        # Get custom pouches
        for pouch in user.custom_pouches:
            user_data['custom_pouches'].append({
                'brand': pouch.brand,
                'nicotine_mg': pouch.nicotine_mg,
                'created_at': pouch.created_at.isoformat() if pouch.created_at else None
            })
        
        # Get goals
        for goal in user.goals:
            user_data['goals'].append({
                'goal_type': goal.goal_type,
                'target_value': goal.target_value,
                'current_streak': goal.current_streak,
                'best_streak': goal.best_streak,
                'start_date': goal.start_date.isoformat() if goal.start_date else None,
                'end_date': goal.end_date.isoformat() if goal.end_date else None,
                'is_active': goal.is_active,
                'created_at': goal.created_at.isoformat() if goal.created_at else None
            })
        
        # Create JSON response
        from flask import jsonify, make_response
        import datetime
        
        response = make_response(jsonify(user_data))
        response.headers['Content-Disposition'] = f'attachment; filename=nicotine_tracker_data_{datetime.date.today().isoformat()}.json'
        response.headers['Content-Type'] = 'application/json'
        
        current_app.logger.info(f'Data export requested by user {user.email}')
        return response
        
    except Exception as e:
        current_app.logger.error(f'Export data error: {e}')
        flash('An error occurred while exporting your data.', 'error')
        return redirect(url_for('settings.account'))

@settings_bp.route('/statistics')
@login_required
def statistics():
    """User statistics page"""
    try:
        user = get_current_user()
        
        # Calculate various statistics
        from datetime import date, timedelta
        from sqlalchemy import func
        
        today = date.today()
        week_ago = today - timedelta(days=7)
        month_ago = today - timedelta(days=30)
        
        # Total statistics
        total_logs = user.logs.count()
        total_pouches = db.session.query(func.sum(Log.quantity)).filter_by(user_id=user.id).scalar() or 0
        
        # Calculate total nicotine
        total_nicotine = 0
        for log in user.logs:
            total_nicotine += log.get_total_nicotine()
        
        # Weekly statistics
        week_logs = user.logs.filter(Log.log_date >= week_ago).count()
        week_pouches = db.session.query(func.sum(Log.quantity)).filter(
            Log.user_id == user.id,
            Log.log_date >= week_ago
        ).scalar() or 0
        
        # Monthly statistics
        month_logs = user.logs.filter(Log.log_date >= month_ago).count()
        month_pouches = db.session.query(func.sum(Log.quantity)).filter(
            Log.user_id == user.id,
            Log.log_date >= month_ago
        ).scalar() or 0
        
        # Most used brand
        most_used_brand = db.session.query(
            Pouch.brand,
            func.sum(Log.quantity).label('total')
        ).join(Log).filter(
            Log.user_id == user.id
        ).group_by(Pouch.brand).order_by(func.sum(Log.quantity).desc()).first()
        
        # Account age
        account_age = None
        if user.created_at:
            account_age = (datetime.now() - user.created_at).days
        
        statistics = {
            'total_logs': total_logs,
            'total_pouches': int(total_pouches),
            'total_nicotine': int(total_nicotine),
            'week_logs': week_logs,
            'week_pouches': int(week_pouches),
            'month_logs': month_logs,
            'month_pouches': int(month_pouches),
            'most_used_brand': most_used_brand.brand if most_used_brand else None,
            'account_age': account_age,
            'daily_average': round(total_pouches / max(account_age, 1), 1) if account_age else 0
        }
        
        return render_template('statistics.html', user=user, stats=statistics)
        
    except Exception as e:
        current_app.logger.error(f'Statistics error: {e}')
        flash('An error occurred while loading statistics.', 'error')
        return redirect(url_for('settings.account'))
