from flask import Blueprint, render_template, request, redirect, url_for, flash, session, current_app
from werkzeug.security import generate_password_hash, check_password_hash  # still imported if you need them elsewhere
from flask_mail import Message
from models import User
from services import create_user              # new import
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

def send_reset_email(user):
    """Send password reset email (placeholder implementation)"""
    try:
        if current_app.config['MAIL_USERNAME']:
            msg = Message(
                'Password Reset - Nicotine Tracker',
                sender=current_app.config['MAIL_DEFAULT_SENDER'],
                recipients=[user.email]
            )
            msg.body = f'''
            Hi {user.email},
            
            You requested a password reset. Click the link below to reset your password:
            {url_for('auth.reset_password', token=user.reset_token, _external=True)}
            
            This link will expire in 1 hour.
            
            If you didn't request this reset, please ignore this email.
            
            Best regards,
            Nicotine Tracker Team
            '''
            mail.send(msg)
            current_app.logger.info(f'Password reset email sent to {user.email}')
        else:
            current_app.logger.info(f'Email not configured. Reset token for {user.email}: {user.reset_token}')
    except Exception as e:
        current_app.logger.error(f'Failed to send reset email: {e}')

@auth_bp.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        try:
            email = request.form.get('email', '').strip().lower()
            password = request.form.get('password', '')
            confirm_password = request.form.get('confirm_password', '')

            # …validation omitted for brevity…

            existing_user = User.query.filter_by(email=email).first()
            if existing_user:
                flash('An account with this email already exists.', 'error')
                return render_template('register.html')

            # Create the user via the service layer
            user = create_user(email=email, password=password)

            # Generate verification token and persist it
            user.generate_verification_token()
            db.session.commit()

            # Send verification email
            send_verification_email(user)

            flash('Registration successful! Please check your email to verify your account.', 'success')
            return redirect(url_for('auth.login'))

        except Exception as e:
            db.session.rollback()
            current_app.logger.error(f'Registration error: {e}')
            flash('An error occurred during registration. Please try again.', 'error')

    return render_template('register.html')

@auth_bp.route('/login', methods=['GET', 'POST'])
def login():
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
    return redirect(url_for('index'))

@auth_bp.route('/verify_email/<token>')
def verify_email(token):
    try:
        user = User.query.filter_by(verification_token=token).first()
        
        if user:
            user.email_verified = True
            user.verification_token = None
            db.session.commit()
            
            current_app.logger.info(f'Email verified for user {user.email}')
            flash('Email verified successfully! You can now log in.', 'success')
        else:
            flash('Invalid or expired verification token.', 'error')
            
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f'Email verification error: {e}')
        flash('An error occurred during email verification.', 'error')
    
    return redirect(url_for('auth.login'))

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
                user.generate_reset_token()
                db.session.commit()
                send_reset_email(user)
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
        user = User.query.filter_by(reset_token=token).first()
        
        if not user or not user.reset_token_expires or user.reset_token_expires < datetime.utcnow():
            flash('Invalid or expired reset token.', 'error')
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
            
            user.set_password(password)
            user.reset_token = None
            user.reset_token_expires = None
            db.session.commit()
            
            current_app.logger.info(f'Password reset completed for {user.email}')
            flash('Password reset successful! You can now log in with your new password.', 'success')
            return redirect(url_for('auth.login'))
        
        return render_template('reset_password.html', token=token)
        
    except Exception as e:
        db.session.rollback()
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
        return User.query.get(session['user_id'])
    return None
