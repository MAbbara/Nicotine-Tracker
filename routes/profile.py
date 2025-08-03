from flask import Blueprint, render_template, request, redirect, url_for, flash, current_app
from models import User, Pouch             # import Pouch at the top
from extensions import db
from routes.auth import login_required, get_current_user
import json
from datetime import datetime
from sqlalchemy import func
from models import Log, Pouch

# Specify the template folder for profile-related templates
profile_bp = Blueprint('profile', __name__, template_folder='../templates/profile')

@profile_bp.route('/', methods=['GET', 'POST'])
@login_required
def index():
    """User profile page"""
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
            
            # Store preferred brands as JSON
            if preferred_brands:
                user.preferred_brands = json.dumps(preferred_brands)
            else:
                user.preferred_brands = None
            
            db.session.commit()
            
            current_app.logger.info(f'Profile updated for user {user.email}')
            flash('Profile updated successfully!', 'success')
            return redirect(url_for('profile.index'))
        
        # GET request - display profile
        # Parse preferred brands from JSON
        preferred_brands = []
        if user.preferred_brands:
            try:
                preferred_brands = json.loads(user.preferred_brands)
            except (json.JSONDecodeError, TypeError):
                preferred_brands = []
        
        # Get available brands for selection
        available_brands = db.session.query(Pouch.brand).distinct().order_by(Pouch.brand).all()
        available_brands = [brand[0] for brand in available_brands]
        
        return render_template('profile.html', 
                             user=user, 
                             preferred_brands=preferred_brands,
                             available_brands=available_brands)
        
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f'Profile error: {e}')
        flash('An error occurred while updating your profile.', 'error')
        return render_template('profile.html', user=get_current_user())

@profile_bp.route('/change_password', methods=['GET', 'POST'])
@login_required
def change_password():
    """Change user password"""
    try:
        user = get_current_user()
        
        if request.method == 'POST':
            current_password = request.form.get('current_password', '')
            new_password = request.form.get('new_password', '')
            confirm_password = request.form.get('confirm_password', '')
            
            # Validation
            if not current_password:
                flash('Please enter your current password.', 'error')
                return render_template('change_password.html')
            
            if not user.check_password(current_password):
                flash('Current password is incorrect.', 'error')
                return render_template('change_password.html')
            
            if len(new_password) < 6:
                flash('New password must be at least 6 characters long.', 'error')
                return render_template('change_password.html')
            
            if new_password != confirm_password:
                flash('New passwords do not match.', 'error')
                return render_template('change_password.html')
            
            if current_password == new_password:
                flash('New password must be different from current password.', 'error')
                return render_template('change_password.html')
            
            # Update password
            user.set_password(new_password)
            db.session.commit()
            
            current_app.logger.info(f'Password changed for user {user.email}')
            flash('Password changed successfully!', 'success')
            return redirect(url_for('profile.index'))
        
        return render_template('change_password.html')
        
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f'Change password error: {e}')
        flash('An error occurred while changing your password.', 'error')
        return render_template('change_password.html')

@profile_bp.route('/delete_account', methods=['GET', 'POST'])
@login_required
def delete_account():
    """Delete user account"""
    try:
        user = get_current_user()
        
        if request.method == 'POST':
            password = request.form.get('password', '')
            confirmation = request.form.get('confirmation', '')
            
            # Validation
            if not password:
                flash('Please enter your password to confirm account deletion.', 'error')
                return render_template('delete_account.html')
            
            if not user.check_password(password):
                flash('Password is incorrect.', 'error')
                return render_template('delete_account.html')
            
            if confirmation.lower() != 'delete my account':
                flash('Please type "delete my account" to confirm.', 'error')
                return render_template('delete_account.html')
            
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
        
        return render_template('delete_account.html')
        
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f'Delete account error: {e}')
        flash('An error occurred while deleting your account.', 'error')
        return render_template('delete_account.html')

@profile_bp.route('/export_data')
@login_required
def export_data():
    """Export user data (GDPR compliance)"""
    try:
        user = get_current_user()
        
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
        return redirect(url_for('profile.index'))

@profile_bp.route('/privacy_settings', methods=['GET', 'POST'])
@login_required
def privacy_settings():
    """Privacy settings page"""
    try:
        user = get_current_user()
        
        if request.method == 'POST':
            # Handle privacy settings updates
            # This is a placeholder for future privacy features
            flash('Privacy settings updated successfully!', 'success')
            return redirect(url_for('profile.privacy_settings'))
        
        return render_template('privacy_settings.html', user=user)
        
    except Exception as e:
        current_app.logger.error(f'Privacy settings error: {e}')
        flash('An error occurred while loading privacy settings.', 'error')
        return redirect(url_for('profile.index'))

@profile_bp.route('/statistics')
@login_required
def statistics():
    """User statistics page"""
    try:
        user = get_current_user()
        
        # Calculate various statistics
        from datetime import date, timedelta
        from sqlalchemy import func
        from models import Log, Pouch
        
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
        return redirect(url_for('profile.index'))
