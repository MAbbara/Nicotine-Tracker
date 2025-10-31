"""Background Tasks Service.
Handles periodic tasks like processing notification queue and sending scheduled notifications.
"""
import schedule
import time
import logging
from datetime import datetime, date, timedelta
from flask import current_app
from extensions import db
from models.user import User
from models.goal import Goal
from models.user_preferences import UserPreferences
from services.notification_service import NotificationService
from services.user_preferences_service import UserPreferencesService
from services.email_verification_service import EmailVerificationService
from services import timezone_service as tz_service


logger = logging.getLogger('background_tasks')


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
        schedule.every(10).seconds.do(self.process_notification_queue)

        schedule.every().minute.do(self.send_daily_reminders)
        schedule.every().monday.at("10:00").do(self.send_weekly_reports)

        schedule.every(30).minutes.do(self.check_goal_thresholds)
        schedule.every().day.at("02:00").do(self.cleanup_expired_tokens)
    
    def run_scheduler(self):
        """Run the background scheduler (should be called in a separate process/thread)"""
        with self.app.app_context():
            logger.info("Background task scheduler started")
            
            while True:
                try:
                    schedule.run_pending()
                    time.sleep(5)  # Check every 10 seconds
                except Exception as e:
                    logger.error(f"Background scheduler error: {e}", exc_info=True)
                    time.sleep(5)


    
    def process_notification_queue(self):
        """Process pending notifications in the queue"""
        logger.debug("Checking notification queue...")
        try:
            with self.app.app_context():
                processed = self.notification_service.process_notification_queue()
                if processed > 0:
                    logger.info(f"Processed {processed} notifications from queue")
                else:
                    logger.debug("Notification queue was empty.")
        except Exception as e:
            logger.error(f"Error processing notification queue: {e}", exc_info=True)

    
    def send_daily_reminders(self):
        """Send daily reminders to users who have them enabled at their preferred time."""
        logger.debug("Running daily reminder check...")
        try:
            with self.app.app_context():
                users_to_remind = db.session.query(User).join(UserPreferences).filter(
                    UserPreferences.daily_reminders == True,
                    db.func.json_length(UserPreferences.notification_channel) > 0
                ).all()
                logger.debug(f"Found {len(users_to_remind)} users with daily reminders enabled.")


                sent_count = 0
                for user in users_to_remind:
                    logger.debug(f"Checking user {user.id} for daily reminder.")
                    # Determine the target time for the reminder, falling back to daily reset time
                    preferences = self.preferences_service.get_or_create_preferences(user.id)
                    target_time = preferences.reminder_time or preferences.daily_reset_time

                    if not target_time:
                        logger.debug(f"User {user.id} has no target time for reminders. Skipping.")
                        continue
                    
                    
                    # Get user's local time to ensure reminder is sent at the correct local time
                    user_local_time, _, _ = tz_service.get_current_user_time(user.timezone)
                    if not user_local_time:
                        logger.warning(f"Could not determine local time for user {user.id}. Skipping.")
                        continue
                    
                    logger.debug(f"User {user.id}: Local time is {user_local_time.strftime('%H:%M')}, Target time is {target_time.strftime('%H:%M')}.")

                    # Check if it's the user's reminder time (minute precision)
                    if user_local_time.hour == target_time.hour and user_local_time.minute == target_time.minute:
                        logger.info(f"Time match for user {user.id}. Checking if recently notified.")

                        # Check if a reminder was already sent in the last 23 hours to prevent duplicates
                        if not self._recently_notified(user.id, 'daily_reminder', hours=23):
                            logger.info(f"Sending daily reminder to user {user.id}.")
                            self.notification_service.send_daily_reminder(user.id)
                            sent_count += 1
                        else:
                            logger.debug(f"User {user.id} was recently notified. Skipping. {self._recently_notified(user.id, 'daily_reminder', hours=23)}")
                
                if sent_count > 0:
                    logger.info(f"Sent daily reminders to {sent_count} users")
                else:
                    logger.debug("No daily reminders sent in this run.")
                    
        except Exception as e:
            logger.error(f"Error sending daily reminders: {e}", exc_info=True)


    
    def send_weekly_reports(self):
        """Send weekly progress reports to users who have them enabled"""
        logger.info("Running weekly report job...")
        try:
            with self.app.app_context():
                # Get users with weekly reports enabled
                users_with_reports = db.session.query(User).join(UserPreferences).filter(
                    UserPreferences.weekly_reports == True,
                    db.func.json_length(UserPreferences.notification_channel) > 0
                ).all()
                logger.debug(f"Found {len(users_with_reports)} users with weekly reports enabled.")


                
                sent_count = 0
                for user in users_with_reports:
                    logger.debug(f"Generating weekly report for user {user.id}")
                    success = self._send_weekly_report(user)
                    if success:
                        sent_count += 1
                
                if sent_count > 0:
                    logger.info(f"Sent weekly reports to {sent_count} users")
                else:
                    logger.info("No weekly reports sent.")
                    
        except Exception as e:
            logger.error(f"Error sending weekly reports: {e}", exc_info=True)

    
    def check_goal_thresholds(self):
        """Check for goals approaching their thresholds and send warnings"""
        logger.debug("Checking goal thresholds...")
        try:
            with self.app.app_context():
                # Get active goals with notifications enabled
                active_goals = Goal.query.filter_by(
                    is_active=True,
                    enable_notifications=True
                ).all()
                logger.debug(f"Found {len(active_goals)} active goals with notifications on.")
                
                notifications_sent = 0
                today = date.today()
                
                for goal in active_goals:
                    user = goal.user
                    logger.debug(f"Checking goal {goal.id} for user {user.id}")
                    
                    # Calculate current progress
                    from routes.goals import calculate_goal_progress
                    progress = calculate_goal_progress(user, goal, today)
                    
                    # Check if approaching threshold (and not already exceeded)
                    threshold_percentage = goal.notification_threshold * 100
                    logger.debug(f"Goal {goal.id}: Progress={progress['percentage']:.2f}%, Threshold={threshold_percentage:.2f}%")
                    if (progress['percentage'] >= threshold_percentage and 
                        progress['percentage'] <= 100):
                        
                        # Check if we haven't sent a notification recently
                        if not self._recently_notified(user.id, 'goal_reminder', hours=4):
                            logger.info(f"Goal {goal.id} for user {user.id} has crossed threshold. Sending notification.")
                            subject = f"⚠️ Goal Threshold Alert"
                            message = f"You're at {progress['percentage']:.0f}% of your {goal.goal_type.replace('_', ' ')} goal ({progress['current']}/{progress['target']}). Stay mindful of your usage!"
                            
                            extra_data = {
                                'goal_type': goal.goal_type,
                                'progress': progress['percentage'],
                                'current': progress['current'],
                                'target': progress['target']
                            }
                            
                            # The service will filter based on user prefs.
                            self.notification_service.queue_notification(
                                user_id=user.id,
                                category='goal_reminder',
                                subject=subject,
                                message=message,
                                priority=2,
                                extra_data=extra_data
                            )
                            notifications_sent += 1

                        else:
                            logger.debug(f"Goal {goal.id} for user {user.id} crossed threshold, but recently notified. Skipping.")
                
                if notifications_sent > 0:
                    logger.info(f"Sent goal threshold notifications for {notifications_sent} goal(s)")
                else:
                    logger.debug("No goal threshold notifications sent in this run.")
                    
        except Exception as e:
            logger.error(f"Error checking goal thresholds: {e}", exc_info=True)


    
    def _send_weekly_report(self, user):
        """Send weekly progress report to a user"""
        try:
            logger.debug(f"Calculating weekly stats for user {user.id}")
            queued = self.notification_service.queue_weekly_report(user)
            if queued:
                logger.info(f"Queued weekly report for user {user.id}")
            else:
                logger.warning(f"Weekly report not queued for user {user.id}")
            return queued

            
        except Exception as e:
            logger.error(f"Error creating weekly report for user {user.id}: {e}", exc_info=True)
            return False

    
    def cleanup_expired_tokens(self):

        """Clean up expired email verification tokens"""
        logger.debug("Running expired token cleanup...")
        try:
            with self.app.app_context():
                cleaned = self.verification_service.cleanup_expired_tokens()
                if cleaned > 0:
                    logger.info(f"Cleaned up {cleaned} expired email verification tokens")
                else:
                    logger.debug("No expired tokens to clean up.")
        except Exception as e:
            logger.error(f"Error cleaning up expired tokens: {e}", exc_info=True)

    
    def _recently_notified(self, user_id, category, hours):
        """Check if a notification of a certain category was sent to a user recently."""
        try:
            from models.notification import NotificationHistory
            
            cutoff_time = datetime.utcnow() - timedelta(hours=hours)
            
            recent_notification = NotificationHistory.query.filter(
                NotificationHistory.user_id == user_id,
                NotificationHistory.category == category,
                NotificationHistory.sent_at >= cutoff_time,
                NotificationHistory.delivery_status != "failed"
            ).first()

            return recent_notification is not None
        except Exception as e:
            logger.error(f"Error checking recent notifications for user {user_id}: {e}", exc_info=True)
            return False




# Standalone function to run the background processor
def run_background_tasks(app):
    """Run background tasks - should be called in a separate process"""
    processor = BackgroundTaskProcessor(app)
    processor.run_scheduler()
