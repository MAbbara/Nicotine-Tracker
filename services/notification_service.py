"""Notification Service.
Handles email and Discord webhook notifications with queue processing.
"""
import json
import requests
from datetime import datetime, timedelta
from flask import current_app, render_template_string
from flask_mail import Message
from extensions import db, mail
from models.notification import NotificationQueue, NotificationHistory
from models.user_preferences import UserPreferences
from models.user import User
from services.user_preferences_service import UserPreferencesService


class NotificationService:
    
    def __init__(self):
        self.preferences_service = UserPreferencesService()
    
    def queue_notification(self, user_id, notification_type, category, subject, message, 
                          recipient=None, priority=5, extra_data=None, scheduled_for=None):
        """Queue a notification for sending"""
        try:
            user = User.query.get(user_id)
            if not user:
                current_app.logger.error(f'User {user_id} not found for notification')
                return False
            
            # Check if user wants this type of notification
            if not self.preferences_service.should_send_notification(user_id, category):
                current_app.logger.info(f'User {user_id} has disabled {category} notifications')
                return False
            
            # Check quiet hours
            if self.preferences_service.is_quiet_hours(user_id):
                # Schedule for after quiet hours
                preferences = self.preferences_service.get_or_create_preferences(user_id)
                if preferences and preferences.quiet_hours_end:
                    from datetime import time
                    now = datetime.now()
                    quiet_end = datetime.combine(now.date(), preferences.quiet_hours_end)
                    if quiet_end < now:
                        quiet_end += timedelta(days=1)
                    scheduled_for = quiet_end
            
            # Determine recipient if not provided
            if not recipient:
                if notification_type == 'email':
                    recipient = user.email
                elif notification_type == 'discord':
                    webhook_settings = self.preferences_service.get_webhook_settings(user_id)
                    if webhook_settings and webhook_settings.get('discord_webhook'):
                        recipient = webhook_settings['discord_webhook']
                    else:
                        current_app.logger.warning(f'No Discord webhook configured for user {user_id}')
                        return False
            
            # Create notification queue entry
            notification = NotificationQueue(
                user_id=user_id,
                notification_type=notification_type,
                category=category,
                subject=subject,
                message=message,
                recipient=recipient,
                priority=priority,
                extra_data=extra_data,
                scheduled_for=scheduled_for or datetime.utcnow()
            )
            
            db.session.add(notification)
            db.session.commit()
            
            current_app.logger.info(f'Queued {notification_type} notification for user {user_id}: {category}')
            return True
            
        except Exception as e:
            db.session.rollback()
            current_app.logger.error(f'Error queuing notification: {e}')
            return False
    
    def send_email_notification(self, notification):
        """Send an email notification"""
        try:
            # Skip email sending in development mode
            if current_app.config.get('FLASK_ENV') == 'development' or current_app.debug:
                current_app.logger.info(f'Development mode: Skipping email notification to {notification.recipient}')
                current_app.logger.info(f'Email subject: {notification.subject}')
                current_app.logger.info(f'Email content: {notification.message[:200]}...')
                return True
            
            if not current_app.config.get('MAIL_USERNAME'):
                current_app.logger.warning('Email not configured, skipping email notification')
                return False
            
            msg = Message(
                subject=notification.subject,
                sender=current_app.config['MAIL_DEFAULT_SENDER'],
                recipients=[notification.recipient]
            )
            
            # Check if message is already HTML (for email verification and other custom templates)
            if notification.message.strip().startswith('<!DOCTYPE html>') or notification.message.strip().startswith('<html'):
                # Message is already HTML, use it directly
                msg.html = notification.message
                # Create a plain text version by stripping HTML tags (basic)
                import re
                msg.body = re.sub('<[^<]+?>', '', notification.message).strip()
            else:
                # Use HTML template for better formatting
                msg.html = self._format_email_html(notification)
                msg.body = notification.message
            
            mail.send(msg)
            current_app.logger.info(f'Email sent successfully to {notification.recipient}')
            return True
            
        except Exception as e:
            current_app.logger.error(f'Failed to send email notification: {e}')
            return False
    
    def send_discord_notification(self, notification):
        """Send a Discord webhook notification"""
        try:
            webhook_url = notification.recipient
            
            # Format message for Discord
            embed = self._format_discord_embed(notification)
            
            payload = {
                "embeds": [embed]
            }
            
            response = requests.post(
                webhook_url,
                json=payload,
                headers={'Content-Type': 'application/json'},
                timeout=10
            )
            
            if response.status_code == 204:
                current_app.logger.info(f'Discord notification sent successfully')
                return True
            else:
                current_app.logger.error(f'Discord webhook failed: {response.status_code} - {response.text}')
                return False
                
        except Exception as e:
            current_app.logger.error(f'Failed to send Discord notification: {e}')
            return False
    
    def process_notification_queue(self, limit=50):
        """Process pending notifications in the queue"""
        try:
            # Get pending notifications ordered by priority and scheduled time
            notifications = NotificationQueue.query.filter(
                NotificationQueue.status == 'pending',
                NotificationQueue.scheduled_for <= datetime.utcnow(),
                NotificationQueue.attempts < NotificationQueue.max_attempts
            ).order_by(
                NotificationQueue.priority.asc(),
                NotificationQueue.scheduled_for.asc()
            ).limit(limit).all()
            
            processed = 0
            for notification in notifications:
                success = self._send_notification(notification)
                processed += 1
                
                if success:
                    # Mark as sent and create history record
                    notification.status = 'sent'
                    self._create_history_record(notification, 'sent')
                    db.session.delete(notification)  # Remove from queue
                else:
                    # Increment attempts and potentially reschedule
                    notification.attempts += 1
                    notification.last_attempt_at = datetime.utcnow()
                    
                    if notification.attempts >= notification.max_attempts:
                        notification.status = 'failed'
                        self._create_history_record(notification, 'failed')
                        db.session.delete(notification)  # Remove failed notification
                    else:
                        # Reschedule with exponential backoff
                        backoff_minutes = 2 ** notification.attempts
                        notification.scheduled_for = datetime.utcnow() + timedelta(minutes=backoff_minutes)
                        notification.status = 'pending'
            
            db.session.commit()
            current_app.logger.info(f'Processed {processed} notifications from queue')
            return processed
            
        except Exception as e:
            db.session.rollback()
            current_app.logger.error(f'Error processing notification queue: {e}')
            return 0
    
    def _send_notification(self, notification):
        """Send a single notification based on its type"""
        try:
            notification.status = 'processing'
            db.session.commit()
            
            if notification.notification_type == 'email':
                return self.send_email_notification(notification)
            elif notification.notification_type == 'discord':
                return self.send_discord_notification(notification)
            else:
                current_app.logger.error(f'Unknown notification type: {notification.notification_type}')
                return False
                
        except Exception as e:
            current_app.logger.error(f'Error sending notification {notification.id}: {e}')
            return False
    
    def _create_history_record(self, notification, delivery_status):
        """Create a history record for the notification"""
        try:
            history = NotificationHistory(
                user_id=notification.user_id,
                notification_type=notification.notification_type,
                category=notification.category,
                subject=notification.subject,
                recipient=notification.recipient,
                delivery_status=delivery_status,
                attempts_made=notification.attempts,
                original_queue_id=notification.id
            )
            
            db.session.add(history)
            
        except Exception as e:
            current_app.logger.error(f'Error creating history record: {e}')
    
    def _format_email_html(self, notification):
        """Format email notification as HTML using appropriate template"""
        from flask import render_template, url_for
        
        try:
            # Map notification categories to specific templates
            template_map = {
                'daily_reminder': 'emails/daily_reminder.html',
                'goal_achievement': 'emails/goal_achievement.html', 
                'achievement': 'emails/goal_achievement.html',
                'weekly_report': 'emails/weekly_report.html',
                'test_email': 'emails/test_email.html'
            }
            
            template_name = template_map.get(notification.category, 'emails/generic_notification.html')
            
            # Prepare template context
            context = {
                'subject': notification.subject,
                'message': notification.message,
                'extra_data': notification.extra_data,
                'dashboard_url': url_for('dashboard.index', _external=True) if hasattr(notification, 'user_id') else '#'
            }
            
            # Add specific context for goal achievements
            if notification.category in ['goal_achievement', 'achievement'] and notification.extra_data:
                context['achievement_type'] = notification.extra_data.get('achievement_type', 'milestone')
                # Create a mock goal object for template compatibility
                if 'goal_type' in notification.extra_data:
                    context['goal'] = type('Goal', (), {
                        'goal_type': notification.extra_data.get('goal_type', ''),
                        'target_value': notification.extra_data.get('target_value', 0),
                        'current_streak': notification.extra_data.get('current_streak', 0),
                        'best_streak': notification.extra_data.get('best_streak', 0)
                    })()
            
            # Add action URL if available
            if notification.extra_data and 'action_url' in notification.extra_data:
                context['action_url'] = notification.extra_data['action_url']
            
            return render_template(template_name, **context)
            
        except Exception as e:
            current_app.logger.error(f'Error rendering email template: {e}')
            # Fallback to generic template
            return render_template('emails/generic_notification.html',
                                 subject=notification.subject,
                                 message=notification.message,
                                 extra_data=notification.extra_data)
    
    def _format_discord_embed(self, notification):
        """Format notification as Discord embed"""
        embed = {
            "title": notification.subject,
            "description": notification.message,
            "color": self._get_embed_color(notification.category),
            "timestamp": datetime.utcnow().isoformat(),
            "footer": {
                "text": "Nicotine Tracker"
            }
        }
        
        # Add fields based on extra data
        if notification.extra_data:
            fields = []
            
            if 'progress' in notification.extra_data:
                fields.append({
                    "name": "Progress",
                    "value": f"{notification.extra_data['progress']}%",
                    "inline": True
                })
            
            if 'streak' in notification.extra_data:
                fields.append({
                    "name": "Current Streak",
                    "value": f"{notification.extra_data['streak']} days",
                    "inline": True
                })
            
            if 'goal_type' in notification.extra_data:
                fields.append({
                    "name": "Goal Type",
                    "value": notification.extra_data['goal_type'].replace('_', ' ').title(),
                    "inline": True
                })
            
            if fields:
                embed["fields"] = fields
        
        return embed
    
    def _get_embed_color(self, category):
        """Get Discord embed color based on notification category"""
        colors = {
            'goal_reminder': 0x3b82f6,      # Blue
            'daily_reminder': 0x10b981,     # Green
            'weekly_report': 0x8b5cf6,      # Purple
            'achievement': 0xf59e0b,        # Yellow
            'warning': 0xef4444,            # Red
            'info': 0x6b7280               # Gray
        }
        return colors.get(category, 0x6b7280)
    
    def test_discord_webhook(self, webhook_url):
        """Test Discord webhook connectivity"""
        try:
            test_embed = {
                "title": "🧪 Webhook Test",
                "description": "This is a test message from Nicotine Tracker to verify your Discord webhook is working correctly.",
                "color": 0x10b981,
                "timestamp": datetime.utcnow().isoformat(),
                "footer": {
                    "text": "Nicotine Tracker - Test Message"
                }
            }
            
            payload = {"embeds": [test_embed]}
            
            response = requests.post(
                webhook_url,
                json=payload,
                headers={'Content-Type': 'application/json'},
                timeout=10
            )
            
            if response.status_code == 204:
                return True, "Test message sent successfully!"
            else:
                return False, f"Webhook test failed: {response.status_code}"
                
        except requests.exceptions.Timeout:
            return False, "Request timed out. Please check your webhook URL."
        except requests.exceptions.RequestException as e:
            return False, f"Connection error: {str(e)}"
        except Exception as e:
            return False, f"Unexpected error: {str(e)}"
    
    def send_goal_achievement_notification(self, user_id, goal, achievement_type="milestone"):
        """Send notification when user achieves a goal milestone"""
        try:
            if achievement_type == "milestone":
                subject = f"🎯 Goal Milestone Reached!"
                message = f"Congratulations! You've reached a milestone in your {goal.goal_type.replace('_', ' ')} goal."
            elif achievement_type == "completed":
                subject = f"🏆 Goal Completed!"
                message = f"Amazing! You've successfully completed your {goal.goal_type.replace('_', ' ')} goal!"
            else:
                subject = f"📈 Goal Progress Update"
                message = f"Great progress on your {goal.goal_type.replace('_', ' ')} goal!"
            
            extra_data = {
                'goal_type': goal.goal_type,
                'target_value': goal.target_value,
                'current_streak': goal.current_streak,
                'best_streak': goal.best_streak
            }
            
            # Queue both email and Discord notifications if configured
            preferences = self.preferences_service.get_notification_settings(user_id)
            webhook_settings = self.preferences_service.get_webhook_settings(user_id)
            
            if preferences and preferences.get('achievement_notifications'):
                if preferences.get('email_notifications'):
                    self.queue_notification(
                        user_id=user_id,
                        notification_type='email',
                        category='achievement',
                        subject=subject,
                        message=message,
                        priority=3,
                        extra_data=extra_data
                    )
                
                if webhook_settings and webhook_settings.get('discord_webhook'):
                    self.queue_notification(
                        user_id=user_id,
                        notification_type='discord',
                        category='achievement',
                        subject=subject,
                        message=message,
                        priority=3,
                        extra_data=extra_data
                    )
            
            return True
            
        except Exception as e:
            current_app.logger.error(f'Error sending goal achievement notification: {e}')
            return False
    
    def send_daily_reminder(self, user_id):
        """Send daily reminder notification"""
        try:
            subject = "📝 Daily Nicotine Tracking Reminder"
            message = "Don't forget to log your nicotine usage today! Consistent tracking helps you stay on top of your goals."
            
            # Queue both email and Discord notifications if configured
            preferences = self.preferences_service.get_notification_settings(user_id)
            webhook_settings = self.preferences_service.get_webhook_settings(user_id)
            
            if preferences and preferences.get('daily_reminders'):
                if preferences.get('email_notifications'):
                    self.queue_notification(
                        user_id=user_id,
                        notification_type='email',
                        category='daily_reminder',
                        subject=subject,
                        message=message,
                        priority=4
                    )
                
                if webhook_settings and webhook_settings.get('discord_webhook'):
                    self.queue_notification(
                        user_id=user_id,
                        notification_type='discord',
                        category='daily_reminder',
                        subject=subject,
                        message=message,
                        priority=4
                    )
            
            return True
            
        except Exception as e:
            current_app.logger.error(f'Error sending daily reminder: {e}')
            return False
    
    def get_notification_history(self, user_id, limit=50):
        """Get notification history for a user"""
        try:
            history = NotificationHistory.query.filter_by(
                user_id=user_id
            ).order_by(
                NotificationHistory.sent_at.desc()
            ).limit(limit).all()
            
            return [h.to_dict() for h in history]
            
        except Exception as e:
            current_app.logger.error(f'Error getting notification history: {e}')
            return []
    
    def send_test_email(self, recipient_email):
        """Send a test email to verify SMTP configuration using template"""
        try:
            # Skip email sending in development mode
            if current_app.config.get('FLASK_ENV') == 'development' or current_app.debug:
                current_app.logger.info(f'Development mode: Test email would be sent to {recipient_email}')
                current_app.logger.info('Subject: 🧪 Email Configuration Test')
                current_app.logger.info('Content: This is a test email from Nicotine Tracker to verify your email configuration is working correctly.')
                print(f"✅ Test email simulation successful for {recipient_email}")
                return True
            
            if not current_app.config.get('MAIL_USERNAME'):
                current_app.logger.warning('Email not configured, cannot send test email')
                print("❌ Email not configured. Please set MAIL_USERNAME and other email settings.")
                return False
            
            from flask import render_template
            
            msg = Message(
                subject='🧪 Email Configuration Test',
                sender=current_app.config['MAIL_DEFAULT_SENDER'],
                recipients=[recipient_email]
            )
            
            # Use the test email template
            msg.html = render_template('emails/test_email.html')
            
            # Plain text fallback
            msg.body = """
This is a test email from Nicotine Tracker to verify your email configuration is working correctly.

If you received this email, your SMTP settings are properly configured!

Best regards,
Nicotine Tracker Team
            """
            
            mail.send(msg)
            current_app.logger.info(f'Test email sent successfully to {recipient_email}')
            print(f"✅ Test email sent successfully to {recipient_email}")
            return True
            
        except Exception as e:
            current_app.logger.error(f'Failed to send test email: {e}')
            print(f"❌ Failed to send test email: {e}")
            return False
