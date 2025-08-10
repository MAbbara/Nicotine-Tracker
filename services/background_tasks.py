"""Background Tasks Service.
Handles periodic tasks like processing notification queue and sending scheduled notifications.
"""
import schedule
import time
from datetime import datetime, date, timedelta
from flask import current_app
from extensions import db
from models.user import User
from models.goal import Goal
from models.user_preferences import UserPreferences
from services.notification_service import NotificationService
from services.user_preferences_service import UserPreferencesService
from services.email_verification_service import EmailVerificationService
from services.timezone_service import TimezoneService



class BackgroundTaskProcessor:
    
    def __init__(self, app=None):
        self.app = app
        self.notification_service = NotificationService()
        self.preferences_service = UserPreferencesService()
        self.verification_service = EmailVerificationService()
        
        if app:
            self.init_app(app)
    
    def init_app(self, app):
        """Initialize with Flask app"""
        self.app = app
        
        # Schedule tasks
        schedule.every(5).minutes.do(self.process_notification_queue)
        schedule.every().minute.do(self.send_daily_reminders)
        schedule.every().monday.at("10:00").do(self.send_weekly_reports)

        schedule.every(30).minutes.do(self.check_goal_thresholds)
        schedule.every().day.at("02:00").do(self.cleanup_expired_tokens)
    
    def run_scheduler(self):
        """Run the background scheduler (should be called in a separate process/thread)"""
        with self.app.app_context():
            current_app.logger.info("Background task scheduler started")
            
            while True:
                try:
                    schedule.run_pending()
                    time.sleep(60)  # Check every minute
                except Exception as e:
                    current_app.logger.error(f"Background scheduler error: {e}")
                    time.sleep(60)
    
    def process_notification_queue(self):
        """Process pending notifications in the queue"""
        try:
            with self.app.app_context():
                processed = self.notification_service.process_notification_queue()
                if processed > 0:
                    current_app.logger.info(f"Processed {processed} notifications from queue")
        except Exception as e:
            current_app.logger.error(f"Error processing notification queue: {e}")
    
    def send_daily_reminders(self):
        """Send daily reminders to users who have them enabled at their preferred time."""
        try:
            with self.app.app_context():
                users_to_remind = db.session.query(User).join(UserPreferences).filter(
                    UserPreferences.daily_reminders == True,
                    UserPreferences.notification_channel != 'none'
                ).all()
                
                sent_count = 0
                for user in users_to_remind:
                    # Determine the target time for the reminder, falling back to daily reset time
                    preferences = self.preferences_service.get_or_create_preferences(user.id)
                    target_time = preferences.reminder_time or preferences.daily_reset_time

                    if not target_time:
                        continue
                    
                    # Get user's local time to ensure reminder is sent at the correct local time
                    user_local_time = TimezoneService.get_user_local_time(user.id)
                    if not user_local_time:
                        continue

                    # Check if it's the user's reminder time (minute precision)
                    if user_local_time.hour == target_time.hour and user_local_time.minute == target_time.minute:
                        # Check if a reminder was already sent in the last 23 hours to prevent duplicates
                        if not self._recently_notified(user.id, 'daily_reminder', hours=23):
                            self.notification_service.send_daily_reminder(user.id)
                            sent_count += 1
                
                if sent_count > 0:
                    current_app.logger.info(f"Sent daily reminders to {sent_count} users")
                    
        except Exception as e:
            current_app.logger.error(f"Error sending daily reminders: {e}")

    
    def send_weekly_reports(self):
        """Send weekly progress reports to users who have them enabled"""
        try:
            with self.app.app_context():
                # Get users with weekly reports enabled
                users_with_reports = db.session.query(User).join(UserPreferences).filter(
                    UserPreferences.weekly_reports == True,
                    UserPreferences.notification_channel != 'none'
                ).all()

                
                sent_count = 0
                for user in users_with_reports:
                    success = self._send_weekly_report(user)
                    if success:
                        sent_count += 1
                
                if sent_count > 0:
                    current_app.logger.info(f"Sent weekly reports to {sent_count} users")
                    
        except Exception as e:
            current_app.logger.error(f"Error sending weekly reports: {e}")
    
    def check_goal_thresholds(self):
        """Check for goals approaching their thresholds and send warnings"""
        try:
            with self.app.app_context():
                # Get active goals with notifications enabled
                active_goals = Goal.query.filter_by(
                    is_active=True,
                    enable_notifications=True
                ).all()
                
                notifications_sent = 0
                today = date.today()
                
                for goal in active_goals:
                    user = goal.user
                    
                    # Calculate current progress
                    from routes.goals import calculate_goal_progress
                    progress = calculate_goal_progress(user, goal, today)
                    
                    # Check if approaching threshold (and not already exceeded)
                    threshold_percentage = goal.notification_threshold * 100
                    if (progress['percentage'] >= threshold_percentage and 
                        progress['percentage'] <= 100):
                        
                        # Check if we haven't sent a notification recently
                        if not self._recently_notified(user.id, 'goal_reminder', hours=4):
                            subject = f"⚠️ Goal Threshold Alert"
                            message = f"You're at {progress['percentage']:.0f}% of your {goal.goal_type.replace('_', ' ')} goal ({progress['current']}/{progress['target']}). Stay mindful of your usage!"
                            
                            extra_data = {
                                'goal_type': goal.goal_type,
                                'progress': progress['percentage'],
                                'current': progress['current'],
                                'target': progress['target']
                            }
                            
                            # Queue notifications for both channels. The service will filter based on user prefs.
                            self.notification_service.queue_notification(
                                user_id=user.id,
                                notification_type='email',
                                category='goal_reminder',
                                subject=subject,
                                message=message,
                                priority=2,
                                extra_data=extra_data
                            )
                            self.notification_service.queue_notification(
                                user_id=user.id,
                                notification_type='discord',
                                category='goal_reminder',
                                subject=subject,
                                message=message,
                                priority=2,
                                extra_data=extra_data
                            )
                            notifications_sent += 1
                
                if notifications_sent > 0:
                    current_app.logger.info(f"Sent goal threshold notifications for {notifications_sent} goal(s)")
                    
        except Exception as e:
            current_app.logger.error(f"Error checking goal thresholds: {e}")

    
    def _send_weekly_report(self, user):
        """Send weekly progress report to a user"""
        try:
            # Calculate weekly statistics
            today = date.today()
            week_start = today - timedelta(days=today.weekday())
            week_end = week_start + timedelta(days=6)
            
            # Get user's logs for this week
            from models.log import Log
            week_logs = Log.query.filter(
                Log.user_id == user.id,
                Log.log_date >= week_start,
                Log.log_date <= today
            ).all()
            
            total_pouches = sum(log.quantity for log in week_logs)
            total_nicotine = sum(log.get_total_nicotine() for log in week_logs)
            
            # Get active goals progress
            active_goals = Goal.query.filter_by(user_id=user.id, is_active=True).all()
            goals_summary = []
            
            for goal in active_goals:
                from routes.goals import calculate_goal_progress
                progress = calculate_goal_progress(user, goal, today)
                goals_summary.append({
                    'type': goal.goal_type.replace('_', ' ').title(),
                    'target': goal.target_value,
                    'current': progress['current'],
                    'achieved': progress['achieved']
                })
            
            # Create report message
            subject = f"📊 Your Weekly Progress Report"
            message = f"""
            <h3>Week of {week_start.strftime('%B %d')} - {min(week_end, today).strftime('%B %d, %Y')}</h3>
            
            <h4>📈 Usage Summary</h4>
            <ul>
                <li><strong>Total Pouches:</strong> {total_pouches}</li>
                <li><strong>Total Nicotine:</strong> {total_nicotine:.1f}mg</li>
                <li><strong>Daily Average:</strong> {total_pouches / 7:.1f} pouches</li>
            </ul>
            
            <h4>🎯 Goals Progress</h4>
            """
            
            if goals_summary:
                message += "<ul>"
                for goal in goals_summary:
                    status = "✅ Achieved" if goal['achieved'] else "⏳ In Progress"
                    message += f"<li><strong>{goal['type']}:</strong> {goal['current']}/{goal['target']} - {status}</li>"
                message += "</ul>"
            else:
                message += "<p>No active goals. Consider setting some goals to track your progress!</p>"
            
            message += """
            <p>Keep up the great work! Remember, every small step counts towards your health goals.</p>
            """
            
            extra_data = {
                'week_start': week_start.isoformat(),
                'week_end': min(week_end, today).isoformat(),
                'total_pouches': total_pouches,
                'total_nicotine': total_nicotine,
                'goals_count': len(goals_summary)
            }
            
            # Queue notification
            return self.notification_service.queue_notification(
                user_id=user.id,
                notification_type='email',
                category='weekly_report',
                subject=subject,
                message=message,
                priority=4,
                extra_data=extra_data
            )
            
        except Exception as e:
            current_app.logger.error(f"Error creating weekly report for user {user.id}: {e}")
            return False
    
    def cleanup_expired_tokens(self):

        """Clean up expired email verification tokens"""
        try:
            with self.app.app_context():
                cleaned = self.verification_service.cleanup_expired_tokens()
                if cleaned > 0:
                    current_app.logger.info(f"Cleaned up {cleaned} expired email verification tokens")
        except Exception as e:
            current_app.logger.error(f"Error cleaning up expired tokens: {e}")
    
    def _recently_notified(self, user_id, category, hours):
        """Check if a notification of a certain category was sent to a user recently."""
        try:
            from models.notification import NotificationHistory
            
            cutoff_time = datetime.utcnow() - timedelta(hours=hours)
            
            recent_notification = NotificationHistory.query.filter(
                NotificationHistory.user_id == user_id,
                NotificationHistory.category == category,
                NotificationHistory.sent_at >= cutoff_time
            ).first()
            
            return recent_notification is not None
        except Exception as e:
            current_app.logger.error(f"Error checking recent notifications: {e}")
            return False



# Standalone function to run the background processor
def run_background_tasks(app):
    """Run background tasks - should be called in a separate process"""
    processor = BackgroundTaskProcessor(app)
    processor.run_scheduler()
