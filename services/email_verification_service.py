"""Email Verification Service.
Handles email verification token management with minimal data collection.
"""
from datetime import datetime, timedelta
import secrets
from flask import current_app, url_for
from extensions import db
from models.email_verification import EmailVerification
from models.user import User

class EmailVerificationService:
    
    def create_verification_token(self, user_id, expires_hours=24):
        """Create a new email verification token for a user"""
        try:
            # Create new verification token with minimal data
            verification_token = EmailVerification(
                user_id=user_id,
                token=secrets.token_urlsafe(32),
                expires_at=datetime.utcnow() + timedelta(hours=expires_hours)
            )
            
            db.session.add(verification_token)
            db.session.commit()
            
            current_app.logger.info(f'Email verification token created for user {user_id}')
            return verification_token
            
        except Exception as e:
            db.session.rollback()
            current_app.logger.error(f'Error creating verification token: {e}')
            raise
    
    def validate_verification_token(self, token):
        """Validate an email verification token"""
        try:
            verification_token = EmailVerification.query.filter_by(token=token).first()
            
            if not verification_token:
                return None, "Invalid verification token"
            
            if verification_token.is_verified:
                return None, "Email has already been verified"
            
            if datetime.utcnow() > verification_token.expires_at:
                return None, "Verification token has expired"
            
            return verification_token, None
            
        except Exception as e:
            current_app.logger.error(f'Error validating verification token: {e}')
            return None, "Error validating verification token"
    
    def verify_email_with_token(self, token):
        """Verify email using token"""
        try:
            verification_token, error = self.validate_verification_token(token)
            
            if error:
                return False, error
            
            # Get the user
            user = User.query.get(verification_token.user_id)
            if not user:
                return False, "User not found"
            
            # Mark email as verified
            user.email_verified = True
            
            # Mark token as used
            verification_token.is_verified = True
            verification_token.verified_at = datetime.utcnow()
            
            db.session.commit()
            
            current_app.logger.info(f'Email verification completed for user {user.id}')
            return True, "Email verified successfully"
            
        except Exception as e:
            db.session.rollback()
            current_app.logger.error(f'Error verifying email: {e}')
            return False, "Error verifying email"
    
    def send_verification_email(self, user_id):
        """Send verification email to user"""
        try:
            user = User.query.get(user_id)
            if not user:
                return False, "User not found"
            
            if user.email_verified:
                return False, "Email already verified"
            
            # Check rate limiting
            if not self.can_send_verification(user_id):
                return False, "Please wait before requesting another verification email"
            
            # Create verification token
            verification_token = self.create_verification_token(user_id)
            
            # Send email using existing notification system
            from services.notification_service import NotificationService
            notification_service = NotificationService()
            
            verification_url = url_for('auth.verify_email', token=verification_token.token, _external=True)
            
            subject = "🔐 Verify Your Email - Nicotine Tracker"
            message = self._create_verification_email_content(user, verification_url)
            
            # In development mode, log the verification URL and auto-verify
            if current_app.config.get('FLASK_ENV') == 'development' or current_app.debug:
                current_app.logger.info(f'Development mode: Verification URL for {user.email}: {verification_url}')
                # Auto-verify in development
                user.email_verified = True
                verification_token.is_verified = True
                verification_token.verified_at = datetime.utcnow()
                db.session.commit()
                return True, "Email auto-verified in development mode"
            
            # Queue email notification
            success = notification_service.queue_notification(
                user_id=user_id,
                notification_type='email',
                category='email_verification',
                subject=subject,
                message=message,
                priority=1,  # High priority
                extra_data={'verification_url': verification_url}
            )
            
            if success:
                current_app.logger.info(f'Verification email queued for {user.email}')
                return True, "Verification email sent successfully"
            else:
                return False, "Failed to send verification email"
                
        except Exception as e:
            db.session.rollback()
            current_app.logger.error(f'Error sending verification email: {e}')
            return False, "Failed to send verification email"
    
    def can_send_verification(self, user_id, cooldown_minutes=5):
        """Check if user can request another verification email"""
        try:
            user = User.query.get(user_id)
            if not user or user.email_verified:
                return False
            
            # Check recent attempts (rate limiting)
            recent_attempts = self.get_recent_attempts(user_id, hours=1)
            if recent_attempts >= 3:  # Max 3 attempts per hour
                return False
            
            # Check cooldown period
            since_cooldown = datetime.utcnow() - timedelta(minutes=cooldown_minutes)
            recent_token = EmailVerification.query.filter(
                EmailVerification.user_id == user_id,
                EmailVerification.created_at >= since_cooldown
            ).first()
            
            return recent_token is None
            
        except Exception as e:
            current_app.logger.error(f'Error checking send eligibility: {e}')
            return False
    
    def get_recent_attempts(self, user_id, hours=1):
        """Get recent verification attempts for rate limiting"""
        try:
            since = datetime.utcnow() - timedelta(hours=hours)
            return EmailVerification.query.filter(
                EmailVerification.user_id == user_id,
                EmailVerification.created_at >= since
            ).count()
            
        except Exception as e:
            current_app.logger.error(f'Error getting recent attempts: {e}')
            return 0
    
    def get_verification_status(self, user_id):
        """Get verification status for a user"""
        try:
            user = User.query.get(user_id)
            if not user:
                return None
            
            # Get latest verification token
            latest_token = EmailVerification.query.filter_by(
                user_id=user_id
            ).order_by(EmailVerification.created_at.desc()).first()
            
            status = {
                'email_verified': user.email_verified,
                'can_send': self.can_send_verification(user_id),
                'recent_attempts': self.get_recent_attempts(user_id),
                'has_pending_token': False,
                'token_expires_at': None
            }
            
            if latest_token and not latest_token.is_verified:
                status['has_pending_token'] = True
                status['token_expires_at'] = latest_token.expires_at.isoformat()
            
            return status
            
        except Exception as e:
            current_app.logger.error(f'Error getting verification status: {e}')
            return None
    
    def cleanup_expired_tokens(self):
        """Remove expired verification tokens (for maintenance)"""
        try:
            expired_tokens = EmailVerification.query.filter(
                EmailVerification.expires_at < datetime.utcnow()
            ).all()
            
            count = len(expired_tokens)
            for token in expired_tokens:
                db.session.delete(token)
            
            db.session.commit()
            
            if count > 0:
                current_app.logger.info(f'Cleaned up {count} expired email verification tokens')
            
            return count
            
        except Exception as e:
            db.session.rollback()
            current_app.logger.error(f'Error cleaning up expired tokens: {e}')
            return 0
    
    def revoke_user_tokens(self, user_id):
        """Revoke all active verification tokens for a user"""
        try:
            active_tokens = EmailVerification.query.filter(
                EmailVerification.user_id == user_id,
                EmailVerification.is_verified == False,
                EmailVerification.expires_at > datetime.utcnow()
            ).all()
            
            count = len(active_tokens)
            for token in active_tokens:
                token.is_verified = True
                token.verified_at = datetime.utcnow()
            
            db.session.commit()
            
            if count > 0:
                current_app.logger.info(f'Revoked {count} active verification tokens for user {user_id}')
            
            return count
            
        except Exception as e:
            db.session.rollback()
            current_app.logger.error(f'Error revoking user tokens: {e}')
            return 0
    
    def _create_verification_email_content(self, user, verification_url):
        """Create email verification content"""
        return f"""
Hi {user.email},

Welcome to Nicotine Tracker! Please verify your email address by clicking the link below:

{verification_url}

This link will expire in 24 hours.

If you didn't create this account, please ignore this email.

Best regards,
Nicotine Tracker Team
        """.strip()
