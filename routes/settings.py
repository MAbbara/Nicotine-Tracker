from flask import Blueprint, render_template, request, redirect, url_for, flash, current_app, session, jsonify
from models import Craving, User, Log, Pouch, Goal        # import models from the package
from extensions import db
from routes.auth import login_required, get_current_user
from services.log_service import (
    get_historical_brand,
    get_historical_nicotine_strength,
    log_local_datetime,
    summarize_logs,
)
from services.timezone_service import (
    get_all_timezones_for_dropdown,
    get_common_timezones,
    get_user_day_window,
    resolve_timezone,
    to_naive_utc,
    validate_timezone,
)
from services.preference_service import PreferenceService
from services.api_errors import (
    authentication_required_response,
    error_response,
)
from services.user_preferences_service import UserPreferencesService
from services.notification_service import NotificationService
from services.settings_validation_service import (
    SettingsValidationError,
    parse_account_mutation,
    parse_notification_settings,
    parse_preference_settings,
    parse_profile,
)
from services.email_verification_service import EmailVerificationService
from services.goal_evaluation_service import (
    HISTORY_FULL,
    batch_goal_progress,
)
from services.rate_limit_service import (
    analytics_read_limit,
    authenticated_write_limit,
    current_password_limit,
    destructive_limit,
    discord_test_limit,
    export_limit,
    weekly_report_limit,
)
import json
from datetime import date, datetime, time, timedelta

import pytz
from sqlalchemy import func

# Specify the template folder for settings-related templates
settings_bp = Blueprint('settings', __name__, template_folder='../templates/settings')


@settings_bp.before_request
@authenticated_write_limit()
def _limit_authenticated_settings_writes():
    return None

DATA_ACTIONS: frozenset[str] = frozenset({
    'export_data', 'cleanup_duplicates', 'merge_custom_pouches',
    'recalculate_goals', 'anonymize_data', 'delete_old_logs',
})
DESTRUCTIVE_DATA_ACTIONS = frozenset({
    'cleanup_duplicates', 'merge_custom_pouches', 'anonymize_data',
    'delete_old_logs',
})


def _delete_account_owned_data(user):
    """Delete ownership rows not covered by the User ORM cascades.

    Logs, goals, plans, preferences, settings, notifications, tokens, and
    related plan/check-in rows are owned through delete-orphan User
    relationships. Cravings have only a foreign key, while custom pouches use
    a nullable creator link; both therefore need explicit deletion before the
    User row is removed.
    """
    user_id = user.id
    custom_pouches = Pouch.query.filter_by(created_by=user_id).all()
    Craving.query.filter_by(user_id=user_id).delete(synchronize_session=False)
    for pouch in custom_pouches:
        db.session.delete(pouch)
    db.session.delete(user)


def _duplicate_log_groups(user_id):
    """Group duplicates by authoritative time and immutable product identity."""
    groups = {}
    logs = Log.query.filter_by(user_id=user_id).order_by(Log.id).all()
    for log in logs:
        key = (
            log.log_time,
            get_historical_brand(log),
            get_historical_nicotine_strength(log),
            log.quantity or 0,
            ' '.join((log.notes or '').split()),
        )
        groups.setdefault(key, []).append(log)
    return [group for group in groups.values() if len(group) > 1]


def _user_reset_time(user):
    preferences = user.preferences
    if preferences and preferences.daily_reset_time:
        return preferences.daily_reset_time
    return time.min


def _current_effective_day(user, resolved_timezone, now_utc=None):
    """Current reset-aware user day from one retained UTC instant."""
    now_utc = now_utc or datetime.now(pytz.UTC)
    if now_utc.tzinfo is None:
        now_utc = pytz.UTC.localize(now_utc)
    else:
        now_utc = now_utc.astimezone(pytz.UTC)
    reset_time = _user_reset_time(user)
    candidate = now_utc.astimezone(resolved_timezone).date()
    candidate_window = get_user_day_window(
        resolved_timezone.zone, candidate, reset_time
    )
    if now_utc < candidate_window.start_utc:
        candidate -= timedelta(days=1)
    return candidate


def _retention_cutoff_utc(user, days_to_keep, now_utc=None):
    """Naive UTC start of the earliest complete effective day to retain."""
    resolved_timezone = resolve_timezone(user.timezone)
    current_day = _current_effective_day(user, resolved_timezone, now_utc)
    first_retained_day = current_day - timedelta(days=days_to_keep - 1)
    cutoff_window = get_user_day_window(
        resolved_timezone.zone,
        first_retained_day,
        _user_reset_time(user),
    )
    return to_naive_utc(cutoff_window.start_utc)

@settings_bp.route('/')
@login_required
def index():
    """Redirect to profile settings page"""
    return redirect(url_for('settings.profile'))


@settings_bp.route('/preferences', methods=['GET', 'POST'])
@login_required
def preferences():
    """User preferences settings"""
    try:
        user = get_current_user()
        preferences_service = UserPreferencesService()
        available_rows = db.session.query(Pouch.brand).filter(
            db.or_(Pouch.is_default, Pouch.created_by == user.id)
        ).distinct().order_by(Pouch.brand).all()
        available_brands = [brand[0] for brand in available_rows]
        
        if request.method == 'POST':
            try:
                submitted = parse_preference_settings(
                    request.form, available_brands=available_brands,
                )
            except SettingsValidationError as error:
                retained = {
                    'units_preference': request.form.get('units_preference', ''),
                    'daily_reset_time': request.form.get('daily_reset_time', ''),
                    'preferred_brands': request.form.getlist('preferred_brands'),
                }
                return render_template(
                    'preferences.html', user=user, preferences=retained,
                    submitted_timezone=request.form.get('timezone', ''),
                    field_errors=error.field_errors,
                    all_timezones=get_all_timezones_for_dropdown(),
                    common_timezones=get_common_timezones(),
                    available_brands=available_brands,
                ), 422
            PreferenceService().apply_preference_settings(user.id, submitted)
            session['user_timezone'] = submitted.timezone
            flash('Preferences updated successfully!', 'success')
            return redirect(url_for('settings.preferences'))

        # GET request
        user_preferences = preferences_service.get_or_create_preferences(user.id)
        
        preferences_data = {
            'daily_reset_time': user_preferences.daily_reset_time.strftime('%H:%M') if user_preferences.daily_reset_time else '',
            'units_preference': user_preferences.units_preference,
            'preferred_brands': user_preferences.preferred_brands or []
        }
        
        all_timezones = get_all_timezones_for_dropdown()
        common_timezones = get_common_timezones()

        # Get available brands for selection
        return render_template('preferences.html',
                             user=user, 
                             preferences=preferences_data,
                             all_timezones=all_timezones,
                             common_timezones=common_timezones,
                             available_brands=available_brands,
                             field_errors={}, submitted_timezone=user.timezone)

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f'Preferences settings error: {e}')
        flash('An error occurred while loading preferences.', 'error')
        return redirect(url_for('settings.profile'))


@settings_bp.route('/notifications', methods=['GET', 'POST'])
@login_required
def notifications():
    """Notification settings"""
    try:
        user = get_current_user()
        preferences_service = UserPreferencesService()

        if request.method == 'POST':
            try:
                submitted = parse_notification_settings(request.form)
            except SettingsValidationError as error:
                retained = {
                    'notification_channel': request.form.getlist('notification_channel'),
                    'goal_notifications': request.form.get('goal_notifications') == 'on',
                    'achievement_notifications': request.form.get('achievement_notifications') == 'on',
                    'daily_reminders': request.form.get('daily_reminders') == 'on',
                    'weekly_reports': request.form.get('weekly_reports') == 'on',
                    'discord_webhook': request.form.get('discord_webhook', ''),
                    'reminder_time': request.form.get('reminder_time', ''),
                    'quiet_hours_start': request.form.get('quiet_hours_start', ''),
                    'quiet_hours_end': request.form.get('quiet_hours_end', ''),
                }
                return render_template(
                    'notifications.html', user=user, preferences=retained,
                    field_errors=error.field_errors,
                ), 422
            preferences_service.apply_notification_settings(user.id, submitted)
            flash('Notification settings updated successfully!', 'success')
            return redirect(url_for('settings.notifications'))
        
        # GET request
        current_preferences = preferences_service.get_notification_settings(user.id)
        webhook_settings = preferences_service.get_webhook_settings(user.id)
        
        if not current_preferences:
            current_preferences = {
                'notification_channel': ['email'], 'goal_notifications': True,
                'achievement_notifications': True, 'daily_reminders': False,
                'weekly_reports': False, 'reminder_time': None,
                'quiet_hours_start': None, 'quiet_hours_end': None,
                'notification_frequency': 'immediate'
            }
        
        if not webhook_settings:
            webhook_settings = {'discord_webhook': '', 'slack_webhook': ''}
        
        current_preferences.update(webhook_settings)

        return render_template(
            'notifications.html', user=user, preferences=current_preferences,
            field_errors={},
        )
    except Exception as e:
        current_app.logger.error(f'Notifications settings error: {e}')
        flash('An error occurred while loading notification settings.', 'error')
        return redirect(url_for('settings.profile'))


@settings_bp.route('/notifications/trigger-weekly', methods=['POST'])
@weekly_report_limit()
@login_required
def trigger_weekly_report():
    """Allow users to manually queue their weekly report."""
    try:
        user = get_current_user()
        if not user:
            return jsonify({'success': False, 'message': 'User not found.'}), 404

        preferences_service = UserPreferencesService()
        preferences = preferences_service.get_or_create_preferences(user.id)

        if not preferences or not preferences.weekly_reports:
            return jsonify({
                'success': False,
                'message': 'Enable weekly reports before sending a manual report.'
            }), 400

        notification_service = NotificationService()
        queued = notification_service.queue_weekly_report(user)

        if queued:
            return jsonify({
                'success': True,
                'message': 'Weekly report queued. It should arrive shortly.'
            })

        return jsonify({
            'success': False,
            'message': 'Weekly report could not be queued. Check your notification channels.'
        }), 400

    except Exception as e:
        current_app.logger.error(f'Manual weekly report trigger error: {e}', exc_info=True)
        return jsonify({
            'success': False,
            'message': 'An error occurred while attempting to send the weekly report.'
        }), 500


@settings_bp.route('/test-discord-webhook', methods=['POST'])
@discord_test_limit()
@login_required
def test_discord_webhook():
    """Test Discord webhook endpoint"""
    try:
        data = request.get_json(silent=True) or {}
        webhook_url = data.get('webhook_url', '')
        
        if not webhook_url:
            return jsonify({
                'success': False,
                'message': 'Please provide a webhook URL.'
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

@settings_bp.route('/data', methods=['GET', 'POST'])
@export_limit(
    methods=['POST'],
    exempt_when=lambda: request.form.get('action') != 'export_data',
)
@destructive_limit(
    methods=['POST'],
    exempt_when=lambda: request.form.get('action') not in DESTRUCTIVE_DATA_ACTIONS,
)
@login_required
def data():
    """Data and privacy settings"""
    try:
        user = get_current_user()

        if request.method == 'POST':
            actions = request.form.getlist('action')
            if len(actions) != 1 or actions[0] not in DATA_ACTIONS:
                flash('Choose one data action and try again.', 'error')
                return redirect(url_for('settings.data'))
            action = actions[0]

            if action == 'anonymize_data':
                if request.form.get('confirm_anonymize') != 'ANONYMIZE':
                    flash('Type ANONYMIZE to confirm anonymization.', 'error')
                    return redirect(url_for('settings.data'))
                user.age, user.gender, user.weight = None, None, None
                preferences_service = UserPreferencesService()
                user_preferences = preferences_service.get_or_create_preferences(user.id)
                user_preferences.preferred_brands = None
                user_preferences.units_preference = 'mg'
                for log in user.logs:
                    log.notes = None
                db.session.commit()
                current_app.logger.info(f'Data anonymized for user {user.email}')


                flash('Your personal data has been anonymized successfully.', 'success')

            elif action == 'delete_old_logs':
                if request.form.get('confirm_delete_logs') != 'DELETE LOGS':
                    flash('Type DELETE LOGS to confirm deletion.', 'error')
                    return redirect(url_for('settings.data'))
                days_to_keep = request.form.get('days_to_keep', type=int)
                if days_to_keep is None:
                    flash('Enter a whole number of days to keep.', 'error')
                    return redirect(url_for('settings.data'))
                if days_to_keep < 30:
                    flash('You must keep at least 30 days of data.', 'error')
                else:
                    cutoff_time = _retention_cutoff_utc(user, days_to_keep)
                    logs_to_delete = Log.query.filter(
                        Log.user_id == user.id,
                        Log.log_time < cutoff_time,
                    ).all()
                    for log in logs_to_delete:
                        db.session.delete(log)
                    deleted_count = len(logs_to_delete)
                    db.session.commit()
                    current_app.logger.info(f'Deleted {deleted_count} old logs for user {user.email}')
                    flash(f'Successfully deleted {deleted_count} old log entries.', 'success')
            
            elif action == 'export_data':
                return export_user_data(user)

            elif action == 'cleanup_duplicates':
                if request.form.get('confirm_cleanup_duplicates') != 'CLEANUP':
                    flash(
                        'Type CLEANUP to confirm duplicate log removal.',
                        'error',
                    )
                    return redirect(url_for('settings.data'))
                duplicates_removed = cleanup_duplicate_logs(user)
                flash(f'Removed {duplicates_removed} duplicate log entries.' if duplicates_removed > 0 else 'No duplicate entries found.', 'success' if duplicates_removed > 0 else 'info')

            elif action == 'merge_custom_pouches':
                if request.form.get('confirm_merge_pouches') != 'MERGE':
                    flash(
                        'Type MERGE to confirm merging duplicate pouch records.',
                        'error',
                    )
                    return redirect(url_for('settings.data'))
                merged_count = merge_similar_pouches(user)
                flash(f'Merged {merged_count} similar pouch entries.' if merged_count > 0 else 'No similar pouches found to merge.', 'success' if merged_count > 0 else 'info')
                    
            elif action == 'recalculate_goals':
                updated_goals = recalculate_goal_streaks(user)
                flash(f'Recalculated streaks for {updated_goals} goals.', 'success')
            
            return redirect(url_for('settings.data'))
        
        # GET request
        potential_duplicates = len(_duplicate_log_groups(user.id))
        
        custom_pouches = user.custom_pouches.all()
        similar_pouches = 0
        pouch_groups = {}
        for pouch in custom_pouches:
            key = (pouch.brand.lower().strip(), pouch.nicotine_mg)
            if key not in pouch_groups:
                pouch_groups[key] = 0
            pouch_groups[key] += 1
        for count in pouch_groups.values():
            if count > 1:
                similar_pouches += (count - 1)

        data_stats = {
            'potential_duplicates': potential_duplicates,
            'similar_pouches': similar_pouches
        }
        
        return render_template('data.html', user=user, data_stats=data_stats)
        
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f'Data & Privacy settings error: {e}')
        flash('An error occurred while processing data settings.', 'error')
        return redirect(url_for('settings.data'))


@settings_bp.route('/privacy/offline-queue', methods=['PATCH'])
def update_offline_queue_preference():
    """Persist the account-scoped browser replay preference."""
    user = get_current_user()
    if user is None:
        return authentication_required_response()

    payload = request.get_json(silent=True)
    field_errors = {}
    if not isinstance(payload, dict):
        field_errors['body'] = ['Send one JSON object.']
    else:
        unknown = sorted(set(payload) - {'enabled'})
        if unknown:
            field_errors['body'] = ['Only enabled may be changed here.']
        if 'enabled' not in payload or not isinstance(payload.get('enabled'), bool):
            field_errors['enabled'] = ['Choose true or false.']
    if field_errors:
        return error_response(
            422,
            'validation_error',
            'Check the highlighted fields and try again.',
            field_errors=field_errors,
        )

    preferences = PreferenceService().set_offline_queue_enabled(
        user.id, payload['enabled']
    )
    return jsonify({
        'offline_queue': {
            'enabled': preferences.offline_queue_enabled,
            'id': preferences.offline_queue_id,
        }
    })


@settings_bp.route('/profile', methods=['GET', 'POST'])
@login_required
def profile():
    """User profile settings"""
    try:
        user = get_current_user()
        
        if request.method == 'POST':
            try:
                submitted = parse_profile(request.form)
            except SettingsValidationError as error:
                return render_template(
                    'profile.html', user=user, field_errors=error.field_errors,
                    submitted=request.form,
                ), 422
            legacy_timezone = request.form.get('timezone', '')

            if legacy_timezone and not validate_timezone(legacy_timezone):
                return render_template(
                    'profile.html', user=user, submitted=request.form,
                    field_errors={'timezone': 'Choose a valid time zone.'},
                ), 422
            
            
            # Update user profile
            user.age = submitted.age
            user.gender = submitted.gender
            user.weight = float(submitted.weight) if submitted.weight is not None else None

            # Compatibility for clients that submitted timezone on the old
            # profile form. New UI uses the validated day-boundary API.
            if legacy_timezone:
                preferences = UserPreferencesService().get_or_create_preferences(
                    user.id, commit=False,
                )
                reset_text = (
                    preferences.daily_reset_time.strftime('%H:%M')
                    if preferences.daily_reset_time else '00:00'
                )
                PreferenceService().update_day_boundary(
                    user.id, legacy_timezone, reset_text, commit=False
                )
            
            db.session.commit()
            if legacy_timezone:
                session['user_timezone'] = legacy_timezone
            
            current_app.logger.info(f'Profile updated for user {user.email}')
            flash('Profile updated successfully!', 'success')
            return redirect(url_for('settings.profile'))
        
        # GET request - display profile
        return render_template('profile.html', user=user, field_errors={}, submitted={})


        
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f'Profile error: {e}')
        flash('An error occurred while updating your profile.', 'error')
        return render_template(
            'profile.html', user=get_current_user(), submitted=request.form,
            field_errors={},
        ), 500

@settings_bp.route('/account', methods=['GET', 'POST'])
@current_password_limit()
@destructive_limit(
    methods=['POST'],
    exempt_when=lambda: request.form.get('action') != 'delete_account',
)
@login_required
def account():
    """Account settings"""
    try:
        user = get_current_user()
        
        # Get account statistics
        account_stats = {
            'member_since': user.created_at.strftime('%B %d, %Y') if user.created_at else 'Unknown',
            'email_verified': user.email_verified,
            'total_logs': user.logs.count(),
            'total_pouches_logged': sum(log.quantity for log in user.logs),
            'custom_pouches_created': user.custom_pouches.count(),
            'goals_created': user.goals.count()
        }

        def render_account_error(errors, values=None):
            return render_template(
                'account.html', user=user, account_stats=account_stats,
                account_errors=errors, account_values=values or {},
            ), 422
        
        if request.method == 'POST':
            try:
                mutation = parse_account_mutation(request.form)
            except SettingsValidationError as error:
                return render_account_error(
                    error.field_errors,
                    {'new_email': request.form.get('new_email', '')[:120]},
                )
            action = mutation.action
            
            if action == 'update_email':
                new_email = mutation.values['new_email']
                password = mutation.values['password']
                
                if not user.check_password(password):
                    return render_account_error(
                        {'password': 'Current password is incorrect.'},
                        {'new_email': new_email},
                    )
                
                # Check if email already exists
                existing_user = User.query.filter(
                    func.lower(User.email) == new_email.casefold()
                ).first()
                if existing_user and existing_user.id != user.id:
                    return render_account_error(
                        {'new_email': 'This email address is already in use.'},
                        {'new_email': new_email},
                    )
                
                # Update email
                old_email = user.email
                verification_service = EmailVerificationService()
                try:
                    verification_service.revoke_user_tokens(user.id, commit=False)
                    user.email = new_email
                    user.email_verified = False
                    delivered, _delivery_message = verification_service.send_verification_email(
                        user.id, commit=False, enforce_cooldown=False,
                    )
                    if not delivered:
                        raise RuntimeError('verification notification was not queued')
                    db.session.commit()
                except Exception:
                    db.session.rollback()
                    return render_account_error(
                        {'new_email': 'Email could not be updated. Try again.'},
                        {'new_email': new_email},
                    )
                session['user_email'] = new_email
                
                current_app.logger.info(f'Email changed from {old_email} to {new_email}')
                flash('Email updated. Check your new address for a verification message.', 'success')
                
            elif action == 'change_password':
                current_password = mutation.values['current_password']
                new_password = mutation.values['new_password']
                confirm_password = mutation.values['confirm_password']
                
                # Validation
                if not current_password:
                    return render_account_error({'current_password': 'Please enter your current password.'})
                
                if not user.check_password(current_password):
                    return render_account_error({'current_password': 'Current password is incorrect.'})
                
                if len(new_password) < 6:
                    return render_account_error({'new_password': 'Use 8 to 128 characters.'})
                
                if new_password != confirm_password:
                    return render_account_error({'confirm_password': 'New passwords do not match.'})
                
                if current_password == new_password:
                    return render_account_error({'new_password': 'New password must be different from current password.'})
                
                # Update password
                user.set_password(new_password)
                db.session.commit()
                
                current_app.logger.info(f'Password changed for user {user.email}')
                flash('Password changed successfully!', 'success')
                
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
                    return render_account_error({'delete_password': 'Please enter your password to confirm account deletion.'})
                
                if not user.check_password(password):
                    return render_account_error({'delete_password': 'Password is incorrect.'})
                
                if confirmation.lower() != 'delete my account':
                    return render_account_error({'confirmation': 'Please type "delete my account" to confirm.'})
                
                # Log the deletion
                user_email = user.email
                current_app.logger.info(f'Account deletion initiated for user {user_email}')
                
                _delete_account_owned_data(user)
                db.session.commit()
                
                # Clear session
                session.clear()
                flash('Your account has been deleted.', 'info')
                session['_clear_site_data_after_account_deletion'] = True

                current_app.logger.info(f'Account deleted for user {user_email}')
                return redirect(url_for('index'))
                
            return redirect(url_for('settings.account'))
        
        return render_template('account.html', user=user, account_stats=account_stats)
        
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f'Account settings error: {e}')
        flash('An error occurred while updating account settings.', 'error')
        return render_template('account.html', user=get_current_user(), account_stats={
            'member_since': 'N/A',
            'email_verified': False,
            'total_logs': 'N/A',
            'total_pouches_logged': 'N/A',
            'custom_pouches_created': 'N/A',
            'goals_created': 'N/A'
        })



def cleanup_duplicate_logs(user):
    """Remove duplicate log entries for a user"""
    try:
        removed_count = 0
        for duplicate_group in _duplicate_log_groups(user.id):
            for log in duplicate_group[1:]:
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
        resolved_timezone = resolve_timezone(user.timezone)
        today = _current_effective_day(user, resolved_timezone)
        batched = batch_goal_progress(
            user,
            goals,
            today,
            resolved_timezone,
            history_mode=HISTORY_FULL,
        ) if goals else {}
        
        for goal in goals:
            # Reset streaks
            goal.current_streak = 0
            goal.best_streak = 0
            
            current_streak = 0
            best_streak = 0

            achievements = []
            for progress in batched[goal.id]:
                achieved = bool(
                    progress['available'] and progress['achieved']
                )
                achievements.append(achieved)
                if achieved:
                    current_streak += 1
                    best_streak = max(best_streak, current_streak)
                else:
                    current_streak = 0

            # Current streak is the trailing run of completed observations.
            current_streak = 0
            for achieved in reversed(achievements):
                if achieved:
                    current_streak += 1
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
        resolved_timezone = resolve_timezone(user.timezone)
        preferences = user.preferences
        # Collect all user data
        user_data = {
            'profile': {
                'email': user.email,
                'created_at': user.created_at.isoformat() if user.created_at else None,
                'age': user.age,
                'gender': user.gender,
                'weight': user.weight,
                'timezone': user.timezone,
                'units_preference': (
                    preferences.units_preference if preferences else 'mg'
                ),
                'preferred_brands': (
                    preferences.preferred_brands if preferences else None
                ),
                'email_verified': user.email_verified
            },


            'logs': [],
            'custom_pouches': [],
            'goals': []
        }
        
        # Get logs
        for log in user.logs:
            local_datetime = log_local_datetime(log, resolved_timezone)
            historical_brand = get_historical_brand(log)
            historical_strength = get_historical_nicotine_strength(log)
            log_data = {
                'date': local_datetime.date().isoformat(),
                'time': local_datetime.replace(tzinfo=None).isoformat(),
                'log_datetime_utc': pytz.UTC.localize(
                    to_naive_utc(log.log_time)
                ).isoformat(),
                'quantity': log.quantity,
                'notes': log.notes,
                'created_at': log.created_at.isoformat() if log.created_at else None
            }

            product_key = 'pouch' if log.pouch_id is not None else 'custom_pouch'
            log_data[product_key] = {
                'brand': historical_brand,
                'nicotine_mg': (
                    float(historical_strength)
                    if historical_strength is not None
                    else None
                ),
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
@analytics_read_limit()
@login_required
def statistics():
    """User statistics page"""
    try:
        user = get_current_user()
        
        now_utc = datetime.utcnow()
        week_ago = now_utc - timedelta(days=7)
        month_ago = now_utc - timedelta(days=30)

        all_logs = Log.query.filter_by(user_id=user.id).all()
        total_summary = summarize_logs(all_logs)
        week_logs_set = Log.query.filter(
            Log.user_id == user.id,
            Log.log_time >= week_ago,
            Log.log_time < now_utc,
        ).all()
        month_logs_set = Log.query.filter(
            Log.user_id == user.id,
            Log.log_time >= month_ago,
            Log.log_time < now_utc,
        ).all()
        week_summary = summarize_logs(week_logs_set)
        month_summary = summarize_logs(month_logs_set)

        brand_totals = {}
        for log in all_logs:
            brand = get_historical_brand(log)
            if brand is not None:
                brand_totals[brand] = (
                    brand_totals.get(brand, 0) + (log.quantity or 0)
                )
        most_used_brand = (
            max(brand_totals, key=brand_totals.get) if brand_totals else None
        )
        
        # Account age
        account_age = None
        if user.created_at:
            account_age = (datetime.now() - user.created_at).days
        
        statistics = {
            'total_logs': total_summary['total_logs'],
            'total_pouches': int(total_summary['total_pouches']),
            'total_nicotine': int(total_summary['total_mg']),
            'unknown_strength_count': total_summary['unknown_strength_count'],
            'week_logs': week_summary['total_logs'],
            'week_pouches': int(week_summary['total_pouches']),
            'week_unknown_strength_count': week_summary['unknown_strength_count'],
            'month_logs': month_summary['total_logs'],
            'month_pouches': int(month_summary['total_pouches']),
            'month_unknown_strength_count': month_summary['unknown_strength_count'],
            'most_used_brand': most_used_brand,
            'account_age': account_age,
            'daily_average': round(
                total_summary['total_pouches'] / max(account_age, 1), 1
            ) if account_age else 0
        }
        
        return render_template('statistics.html', user=user, stats=statistics)
        
    except Exception as e:
        current_app.logger.error(f'Statistics error: {e}')
        flash('An error occurred while loading statistics.', 'error')
        return redirect(url_for('settings.account'))
