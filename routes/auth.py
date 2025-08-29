from flask import Blueprint, render_template, request, redirect, url_for, flash, session, current_app, jsonify
from flask_mail import Message
from models import User
from services import create_user              # new import
from services.password_reset_service import PasswordResetService
from services.email_verification_service import EmailVerificationService
from services.timezone_service import validate_timezone
from extensions import db, mail
import re
from datetime import datetime, timedelta

auth_bp = Blueprint('auth', __name__, template_folder="../templates/auth")

def is_valid_email(email):
    """Simple email validation"""
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return re.match(pattern, email) is not None

def send_verification_email(user):
    """Send email verification (mock or real based on environment)"""
    try:
        if current_app.config.get('FLASK_ENV') == 'development':
            # In development, skip sending email and auto-verify
            user.email_verified = True
            user.verification_token = None
            db.session.commit()
            current_app.logger.info(f'Development mode: auto-verified email for {user.email}')
        elif current_app.config['MAIL_USERNAME']:
            msg = Message(
                'Verify Your Email - Nicotine Tracker',
                sender=current_app.config['MAIL_DEFAULT_SENDER'],
                recipients=[user.email]
            )
            msg.body = f'''
            Hi {user.email},
            
            Please click the link below to verify your email address:
            {url_for('auth.verify_email', token=user.verification_token, _external=True)}
            
            If you didn't create this account, please ignore this email.
            
            Best regards,
            Nicotine Tracker Team
            '''
            mail.send(msg)
            current_app.logger.info(f'Verification email sent to {user.email}')
        else:
            current_app.logger.info(f'Email not configured. Verification token for {user.email}: {user.verification_token}')
    except Exception as e:
        current_app.logger.error(f'Failed to send verification email: {e}')

def send_reset_email(user, reset_token):
    """Send password reset email using template"""
    try:
        if current_app.config['MAIL_USERNAME']:
            reset_url = url_for('auth.reset_password', token=reset_token.token, _external=True)
            
            # Use notification service to send templated email
            from services.notification_service import NotificationService
            notification_service = NotificationService()
            
            subject = "🔑 Password Reset - Nicotine Tracker"
            message = render_template('emails/password_reset.html', 
                                    user=user, 
                                    reset_url=reset_url)
            
            # Queue the email
            success = notification_service.queue_notification(
                user_id=user.id,
                category='password_reset',
                subject=subject,
                message=message,
                priority=1,  # High priority
                extra_data={'reset_url': reset_url}
            )
            
            if success:
                current_app.logger.info(f'Password reset email queued for {user.email}')
            else:
                current_app.logger.error(f'Failed to queue password reset email for {user.email}')
        else:
            current_app.logger.info(f'Email not configured. Reset token for {user.email}: {reset_token.token}')
    except Exception as e:
        current_app.logger.error(f'Failed to send reset email: {e}')

@auth_bp.route('/register', methods=['GET', 'POST'])
def register():
    if 'user_id' in session:
        return redirect(url_for('dashboard.index'))
    if request.method == 'POST':

        try:
            email = request.form.get('email', '').strip().lower()
            password = request.form.get('password', '')
            confirm_password = request.form.get('confirm_password', '')

            # Basic validation
            if not email or not is_valid_email(email):
                flash('Please enter a valid email address.', 'error')
                return render_template('register.html')
            
            if len(password) < 6:
                flash('Password must be at least 6 characters long.', 'error')
                return render_template('register.html')
            
            if password != confirm_password:
                flash('Passwords do not match.', 'error')
                return render_template('register.html')

            existing_user = User.query.filter_by(email=email).first()
            if existing_user:
                flash('An account with this email already exists.', 'error')
                return render_template('register.html')

            # Create the user via the service layer
            user = create_user(email=email, password=password)

            # Send verification email using the new service
            verification_service = EmailVerificationService()
            success, message = verification_service.send_verification_email(user.id)
            
            if success:
                flash('Registration successful! Please check your email to verify your account.', 'success')
            else:
                flash(f'Registration successful, but there was an issue sending the verification email: {message}', 'warning')
            
            return redirect(url_for('auth.login'))

        except Exception as e:
            db.session.rollback()
            current_app.logger.error(f'Registration error: {e}')
            flash('An error occurred during registration. Please try again.', 'error')

    return render_template('register.html')

@auth_bp.route('/login', methods=['GET', 'POST'])
def login():
    if 'user_id' in session:
        return redirect(url_for('dashboard.index'))
    if request.method == 'POST':

        try:
            email = request.form.get('email', '').strip().lower()
            password = request.form.get('password', '')
            remember_me = request.form.get('remember_me') == 'on'
            
            if not email or not password:
                flash('Please enter both email and password.', 'error')
                return render_template('login.html')
            
            user = User.query.filter_by(email=email).first()
            
            if user and user.check_password(password):
                session['user_id'] = user.id
                session['user_email'] = user.email
                session['user_timezone'] = user.timezone or 'UTC'
                session.permanent = remember_me
                
                current_app.logger.info(f'User {email} logged in successfully')
                flash('Login successful!', 'success')
                
                # Redirect to next page or dashboard
                next_page = request.args.get('next')
                return redirect(next_page) if next_page else redirect(url_for('dashboard.index'))
            else:
                flash('Invalid email or password.', 'error')
                
        except Exception as e:
            current_app.logger.error(f'Login error: {e}')
            flash('An error occurred during login. Please try again.', 'error')
    
    return render_template('login.html')

@auth_bp.route('/logout')
def logout():
    user_email = session.get('user_email', 'Unknown')
    session.clear()
    current_app.logger.info(f'User {user_email} logged out')
    flash('You have been logged out successfully.', 'info')
    
    # Create response and clear cookies
    response = redirect(url_for('index'))
    
    # Clear all session-related cookies
    response.set_cookie('session', '', expires=0, path='/')
    response.set_cookie('remember_token', '', expires=0, path='/')
    
    # Add JavaScript to clear client-side storage
    response.headers['Clear-Site-Data'] = '"cache", "cookies", "storage"'
    
    return response

@auth_bp.route('/verify_email/<token>')
def verify_email(token):
    try:
        verification_service = EmailVerificationService()
        success, message = verification_service.verify_email_with_token(token)
        
        if success:
            flash(message, 'success')
        else:
            flash(message, 'error')
            
    except Exception as e:
        current_app.logger.error(f'Email verification error: {e}')
        flash('An error occurred during email verification.', 'error')
    
    return redirect(url_for('auth.login'))

@auth_bp.route('/resend_verification', methods=['POST'])
def resend_verification():
    """Resend verification email for logged in user"""
    try:
        if 'user_id' not in session:
            flash('Please log in to resend verification email.', 'error')
            return redirect(url_for('auth.login'))
        
        user_id = session['user_id']
        user = db.session.get(User, user_id)

        if not user:
            flash('User not found.', 'error')
            return redirect(url_for('auth.login'))
        
        if user.email_verified:
            flash('Your email is already verified.', 'info')
            return redirect(url_for('dashboard.index'))
        
        verification_service = EmailVerificationService()
        success, message = verification_service.send_verification_email(user_id)
        
        if success:
            flash('Verification email sent! Please check your inbox.', 'success')
        else:
            flash(f'Failed to send verification email: {message}', 'error')
            current_app.logger.error(f"Error occurred in auth.resend_verification {message}") 
            
    except Exception as e:
        current_app.logger.error(f'Resend verification error: {e}')
        flash('An error occurred while sending verification email.', 'error')
    
    return redirect(request.referrer or url_for('dashboard.index'))

@auth_bp.route('/forgot_password', methods=['GET', 'POST'])
def forgot_password():
    if request.method == 'POST':
        try:
            email = request.form.get('email', '').strip().lower()
            
            if not email or not is_valid_email(email):
                flash('Please enter a valid email address.', 'error')
                return render_template('forgot_password.html')
            
            user = User.query.filter_by(email=email).first()
            
            if user:
                # Check rate limiting
                reset_service = PasswordResetService()
                recent_attempts = reset_service.get_recent_attempts(user.id, hours=1)
                
                if recent_attempts >= 3:
                    flash('Too many password reset attempts. Please try again later.', 'error')
                    return render_template('forgot_password.html')
                
                # Create reset token using service
                reset_token = reset_service.create_reset_token(user.id)
                send_reset_email(user, reset_token)
                current_app.logger.info(f'Password reset requested for {email}')
            
            # Always show success message for security
            flash('If an account with that email exists, a password reset link has been sent.', 'info')
            return redirect(url_for('auth.login'))
            
        except Exception as e:
            db.session.rollback()
            current_app.logger.error(f'Forgot password error: {e}')
            flash('An error occurred. Please try again.', 'error')
    
    return render_template('forgot_password.html')

@auth_bp.route('/reset_password/<token>', methods=['GET', 'POST'])
def reset_password(token):
    try:
        reset_service = PasswordResetService()
        
        # Validate token using service
        reset_token, error = reset_service.validate_reset_token(token)
        
        if error:
            flash(error, 'error')
            return redirect(url_for('auth.forgot_password'))
        
        if request.method == 'POST':
            password = request.form.get('password', '')
            confirm_password = request.form.get('confirm_password', '')
            
            if len(password) < 6:
                flash('Password must be at least 6 characters long.', 'error')
                return render_template('reset_password.html', token=token)
            
            if password != confirm_password:
                flash('Passwords do not match.', 'error')
                return render_template('reset_password.html', token=token)
            
            # Use reset token via service
            success, message = reset_service.use_reset_token(token, password)
            
            if success:
                flash(message, 'success')
                return redirect(url_for('auth.login'))
            else:
                flash(message, 'error')
                return render_template('reset_password.html', token=token)
        
        return render_template('reset_password.html', token=token)
        
    except Exception as e:
        current_app.logger.error(f'Password reset error: {e}')
        flash('An error occurred during password reset.', 'error')
        return redirect(url_for('auth.forgot_password'))

# Helper function for login required decorator
def login_required(f):
    """Decorator to require login for routes"""
    from functools import wraps
    
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            flash('Please log in to access this page.', 'warning')
            return redirect(url_for('auth.login', next=request.url))
        return f(*args, **kwargs)
    return decorated_function

def get_current_user():
    """Get current logged in user"""
    if 'user_id' in session:
        return db.session.get(User, session['user_id'])
    return None


# Make current user available in all templates
@auth_bp.app_context_processor
def inject_current_user():
    """Inject current user into template context"""
    return dict(current_user=get_current_user())

@auth_bp.route('/api/update-timezone', methods=['POST'])
@login_required
def update_timezone():
    """API endpoint to update user's timezone"""
    try:
        data = request.get_json()
        if not data or 'timezone' not in data:
            return jsonify({'success': False, 'error': 'Timezone not provided'}), 400
        
        new_timezone = data['timezone']
        
        # Validate timezone
        if not validate_timezone(new_timezone):
            return jsonify({'success': False, 'error': 'Invalid timezone'}), 400
        
        # Get current user
        user = get_current_user()
        if not user:
            return jsonify({'success': False, 'error': 'User not found'}), 404
        
        # Update user's timezone
        user.timezone = new_timezone
        db.session.commit()
        
        # Update session
        session['user_timezone'] = new_timezone
        
        current_app.logger.info(f'Timezone updated for user {user.email}: {new_timezone}')
        return jsonify({'success': True, 'timezone': new_timezone})
        
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f'Update timezone error: {e}')
        return jsonify({'success': False, 'error': 'Server error'}), 500
