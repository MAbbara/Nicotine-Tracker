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
            # Calculate previous week's statistics (Mon-Sun)
            # Current week starts Monday
            today = date.today()
            current_week_start = today - timedelta(days=today.weekday())
            # Last week range: Monday to Sunday
            week_start = current_week_start - timedelta(days=7)
            week_end = current_week_start - timedelta(days=1)
            
            # Get user's logs for this week
            from models.log import Log
            week_logs = Log.query.filter(
                Log.user_id == user.id,
                Log.log_date >= week_start,
                Log.log_date <= week_end
            ).all()
            
            total_pouches = sum(log.quantity for log in week_logs)
            total_nicotine = sum(log.get_total_nicotine() for log in week_logs)
            daily_avg_pouches = (total_pouches / 7.0) if 7 else 0.0
            daily_avg_mg = (total_nicotine / 7.0) if 7 else 0.0
            logger.debug(
                f"User {user.id} weekly stats: {total_pouches} pouches, {total_nicotine:.1f}mg nicotine."
            )
            
            # Get active goals progress
            active_goals = Goal.query.filter_by(user_id=user.id, is_active=True).all()
            goals_summary = []
            
            for goal in active_goals:
                from routes.goals import calculate_goal_progress
                # Evaluate goal status as of end of last week
                progress = calculate_goal_progress(user, goal, week_end)
                goals_summary.append({
                    'type': goal.goal_type.replace('_', ' ').title(),
                    'target': goal.target_value,
                    'current': progress['current'],
                    'achieved': progress['achieved']
                })
            goals_on_track = sum(1 for g in goals_summary if g.get('achieved'))
            active_streaks = sum(1 for g in active_goals if getattr(g, 'current_streak', 0) > 0)
            
            # Create report message
            subject = f"📊 Your Weekly Progress Report"
            message = f"""
            <h3>Week of {week_start.strftime('%B %d')} - {week_end.strftime('%B %d, %Y')}</h3>

            <h4>📈 Usage Summary</h4>
            <ul>
                <li><strong>Total Pouches:</strong> {total_pouches}</li>
                <li><strong>Total Nicotine:</strong> {total_nicotine:.1f}mg</li>
                <li><strong>Daily Average:</strong> {daily_avg_pouches:.1f} pouches</li>
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
                'week_end': week_end.isoformat(),
                'total_pouches': total_pouches,
                'total_nicotine': total_nicotine,
                'daily_average_pouches': round(daily_avg_pouches, 1),
                'daily_average_mg': round(daily_avg_mg, 1),
                'total_logs': len(week_logs),
                'goals_count': len(goals_summary),
                'goals_on_track': goals_on_track,
                'active_streaks': active_streaks
            }
            
            # Queue notification
            logger.info(f"Queuing weekly report for user {user.id}")
            return self.notification_service.queue_notification(
                user_id=user.id,
                category='weekly_report',
                subject=subject,
                message=message,
                priority=4,
                extra_data=extra_data
            )

            
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
