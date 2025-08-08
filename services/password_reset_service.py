"""Password Reset Service.
Handles password reset token management with minimal data collection.
"""
from datetime import datetime, timedelta
import secrets
from flask import current_app
from extensions import db
from models.password_reset import PasswordReset
from models.user import User

class PasswordResetService:
    
    def create_reset_token(self, user_id, expires_hours=1):
        """Create a new password reset token for a user"""
        try:
            # Create new reset token with minimal data
            reset_token = PasswordReset(
                user_id=user_id,
                token=secrets.token_urlsafe(32),
                expires_at=datetime.utcnow() + timedelta(hours=expires_hours)
            )
            
            db.session.add(reset_token)
            db.session.commit()
            
            current_app.logger.info(f'Password reset token created for user {user_id}')
            return reset_token
            
        except Exception as e:
            db.session.rollback()
            current_app.logger.error(f'Error creating reset token: {e}')
            raise
    
    def validate_reset_token(self, token):
        """Validate a password reset token"""
        try:
            reset_token = PasswordReset.query.filter_by(token=token).first()
            
            if not reset_token:
                return None, "Invalid reset token"
            
            if reset_token.is_used:
                return None, "Reset token has already been used"
            
            if datetime.utcnow() > reset_token.expires_at:
                return None, "Reset token has expired"
            
            return reset_token, None
            
        except Exception as e:
            current_app.logger.error(f'Error validating reset token: {e}')
            return None, "Error validating reset token"
    
    def use_reset_token(self, token, new_password):
        """Use a reset token to change password"""
        try:
            reset_token, error = self.validate_reset_token(token)
            
            if error:
                return False, error
            
            # Get the user
            user = User.query.get(reset_token.user_id)
            if not user:
                return False, "User not found"
            
            # Update password
            user.set_password(new_password)
            
            # Mark token as used
            reset_token.is_used = True
            reset_token.used_at = datetime.utcnow()
            
            db.session.commit()
            
            current_app.logger.info(f'Password reset completed for user {user.id}')
            return True, "Password reset successful"
            
        except Exception as e:
            db.session.rollback()
            current_app.logger.error(f'Error using reset token: {e}')
            return False, "Error resetting password"
    
    def get_recent_attempts(self, user_id, hours=1):
        """Get recent password reset attempts for rate limiting"""
        try:
            since = datetime.utcnow() - timedelta(hours=hours)
            return PasswordReset.query.filter(
                PasswordReset.user_id == user_id,
                PasswordReset.created_at >= since
            ).count()
            
        except Exception as e:
            current_app.logger.error(f'Error getting recent attempts: {e}')
            return 0
    
    def cleanup_expired_tokens(self):
        """Remove expired password reset tokens (for maintenance)"""
        try:
            expired_tokens = PasswordReset.query.filter(
                PasswordReset.expires_at < datetime.utcnow()
            ).all()
            
            count = len(expired_tokens)
            for token in expired_tokens:
                db.session.delete(token)
            
            db.session.commit()
            
            if count > 0:
                current_app.logger.info(f'Cleaned up {count} expired password reset tokens')
            
            return count
            
        except Exception as e:
            db.session.rollback()
            current_app.logger.error(f'Error cleaning up expired tokens: {e}')
            return 0
    
    def revoke_user_tokens(self, user_id):
        """Revoke all active password reset tokens for a user"""
        try:
            active_tokens = PasswordReset.query.filter(
                PasswordReset.user_id == user_id,
                PasswordReset.is_used == False,
                PasswordReset.expires_at > datetime.utcnow()
            ).all()
            
            count = len(active_tokens)
            for token in active_tokens:
                token.is_used = True
                token.used_at = datetime.utcnow()
            
            db.session.commit()
            
            if count > 0:
                current_app.logger.info(f'Revoked {count} active password reset tokens for user {user_id}')
            
            return count
            
        except Exception as e:
            db.session.rollback()
            current_app.logger.error(f'Error revoking user tokens: {e}')
            return 0
