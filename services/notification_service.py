"""Notification Service.
Handles email and Discord webhook notifications with queue processing.
"""
import json
import hashlib
import re
import requests
from datetime import datetime, time, timedelta
from flask import current_app, render_template_string
from flask_mail import Message
from extensions import db, mail
from models.notification import NotificationQueue, NotificationHistory
from models.user import User
from models.goal import Goal
from services.log_service import logs_for_user_window, summarize_logs
from services.user_preferences_service import UserPreferencesService
from services import timezone_service as tz_service
from services.goal_evaluation_service import (
    effective_day_for_user,
    evaluate_goal_period,
    latest_completed_week,
)
from sqlalchemy.exc import IntegrityError


class NotificationService:
    
    def __init__(self):
        self.preferences_service = UserPreferencesService()
        self.send_handlers = {
            'email': self.send_email_notification,
            'discord': self.send_discord_notification,
        }

    def _normalize_extra_data(self, extra):
        """Ensure extra data is returned as a dictionary."""
        if not extra:
            return {}
        if isinstance(extra, dict):
            return extra
        if isinstance(extra, str):
            try:
                parsed = json.loads(extra)
                return parsed if isinstance(parsed, dict) else {}
            except json.JSONDecodeError:
                return {}
        return {}

    @staticmethod
    def _strip_html(content):
        """Remove basic HTML tags for plain text fallbacks."""
        if not content:
            return ''
        return re.sub(r'<[^>]+>', '', content)

    @staticmethod
    def _weekly_idempotency_key(user_id, period_start, notification_type):
        material = (
            f'weekly-report\0{user_id}\0{period_start.isoformat()}\0'
            f'{notification_type}'
        )
        return hashlib.sha256(material.encode('utf-8')).hexdigest()

    def _weekly_rows(self, user_id, period_start):
        return NotificationQueue.query.filter_by(
            user_id=user_id,
            category='weekly_report',
            report_period_start=period_start,
        ).order_by(NotificationQueue.notification_type).all()

    @staticmethod
    def _is_weekly_uniqueness_conflict(error, dialect_name):
        """Identify only the weekly period/channel uniqueness conflict."""
        original = getattr(error, 'orig', None)
        message = str(original or error)
        constraint = 'uq_notification_weekly_period_channel'
        if dialect_name == 'mysql':
            args = getattr(original, 'args', ())
            return bool(args and args[0] == 1062 and constraint in message)
        if dialect_name == 'sqlite':
            columns = (
                'notification_queue.user_id, '
                'notification_queue.category, '
                'notification_queue.report_period_start, '
                'notification_queue.notification_type'
            )
            return 'UNIQUE constraint failed' in message and columns in message
        return constraint in message

    def _queue_weekly_channels(self, user, preferences, period_start, subject,
                               message, extra_data):
        channels = []
        if self.preferences_service.should_send_notification(
                user.id, 'weekly_report', 'email'):
            channels.append(('email', user.email))
        if self.preferences_service.should_send_notification(
                user.id, 'weekly_report', 'discord'):
            webhook = preferences.discord_webhook
            if webhook:
                channels.append(('discord', webhook))
        expected_types = {channel for channel, _recipient in channels}
        existing = self._weekly_rows(user.id, period_start)
        if not channels:
            return []

        existing_by_type = {
            row.notification_type: row for row in existing
        }
        missing_channels = [
            (channel, recipient)
            for channel, recipient in channels
            if channel not in existing_by_type
        ]
        if not missing_channels:
            return [existing_by_type[channel] for channel in sorted(expected_types)]

        for notification_type, recipient in missing_channels:
            db.session.add(NotificationQueue(
                user_id=user.id,
                notification_type=notification_type,
                category='weekly_report',
                subject=subject,
                message=message,
                recipient=recipient,
                priority=4,
                extra_data=extra_data,
                report_period_start=period_start,
                idempotency_key=self._weekly_idempotency_key(
                    user.id, period_start, notification_type
                ),
                scheduled_for=datetime.utcnow(),
            ))
        try:
            db.session.commit()
        except IntegrityError as error:
            db.session.rollback()
            dialect_name = db.session.get_bind().dialect.name
            if not self._is_weekly_uniqueness_conflict(error, dialect_name):
                raise
            replay = self._weekly_rows(user.id, period_start)
            replay_by_type = {
                row.notification_type: row for row in replay
            }
            if expected_types.issubset(replay_by_type):
                return [
                    replay_by_type[channel] for channel in sorted(expected_types)
                ]
            raise
        except Exception:
            db.session.rollback()
            raise
        committed = {
            row.notification_type: row
            for row in self._weekly_rows(user.id, period_start)
        }
        return [committed[channel] for channel in sorted(expected_types)]

    def queue_weekly_report(self, user, *, now_utc=None):
        """Generate and queue a weekly report notification for a user."""
        try:
            resolved_tz = tz_service.resolve_timezone(user.timezone)
            resolved_zone = resolved_tz.zone

            preferences = self.preferences_service.get_or_create_preferences(user.id)
            if not preferences:
                current_app.logger.error(f'Preferences not found for user {user.id} while queuing weekly report')
                return False

            reset_time = preferences.daily_reset_time or time.min

            if now_utc is None:
                local_now, _, _ = tz_service.get_current_user_time(
                    resolved_zone
                )
                now_utc = local_now
            effective_day = effective_day_for_user(
                user,
                now_utc=now_utc,
                resolved_timezone=resolved_tz,
            )
            previous_week_date = latest_completed_week(effective_day)
            week_window = tz_service.get_user_week_window(
                resolved_zone, previous_week_date, reset_time
            )
            last_week_start_local = week_window.week_start_date
            last_week_end_local = last_week_start_local + timedelta(days=6)

            week_logs = logs_for_user_window(user.id, week_window)
            summary = summarize_logs(week_logs)
            total_pouches = summary['total_pouches']
            unknown_strength_count = summary['unknown_strength_count']
            nicotine_available = unknown_strength_count == 0
            total_nicotine = (
                float(summary['total_mg']) if nicotine_available else None
            )
            daily_avg_pouches = total_pouches / 7.0
            daily_avg_mg = (
                total_nicotine / 7.0 if nicotine_available else None
            )

            active_goals = Goal.query.filter_by(user_id=user.id, is_active=True).all()
            goals_summary = []

            for goal in active_goals:
                progress = evaluate_goal_period(
                    user,
                    goal,
                    (
                        last_week_start_local
                        if goal.goal_type == 'weekly_reduction'
                        else last_week_end_local
                    ),
                    resolved_timezone=resolved_tz,
                )
                goals_summary.append({
                    'type': goal.goal_type.replace('_', ' ').title(),
                    'target': goal.target_value,
                    'current': progress['current'],
                    'achieved': progress['achieved'],
                    'available': progress['available'],
                    'reason': progress['reason'],
                    'unknown_strength_count': progress[
                        'unknown_strength_count'
                    ],
                })

            goals_on_track = sum(1 for g in goals_summary if g.get('achieved'))
            active_streaks = sum(1 for g in active_goals if getattr(g, 'current_streak', 0) > 0)

            subject = "Your Weekly Progress Report"
            nicotine_line = (
                f"  <li><strong>Total Nicotine:</strong> "
                f"{total_nicotine:.1f}mg</li>\n"
                if nicotine_available else
                "  <li><strong>Total Nicotine:</strong> unavailable — "
                f"strength data is missing from {unknown_strength_count} "
                f"log {'entry' if unknown_strength_count == 1 else 'entries'}"
                ".</li>\n"
            )
            message = (
                f"<h3>Week of {last_week_start_local.strftime('%B %d')} - "
                f"{last_week_end_local.strftime('%B %d, %Y')}</h3>\n\n"
                "<h4>Usage Summary</h4>\n"
                "<ul>\n"
                f"  <li><strong>Total Pouches:</strong> {total_pouches}</li>\n"
                f"{nicotine_line}"
                f"  <li><strong>Daily Average:</strong> {daily_avg_pouches:.1f} pouches</li>\n"
                "</ul>\n\n"
                "<h4>Goals Progress</h4>\n"
            )

            if goals_summary:
                message += "<ul>"
                for goal_summary in goals_summary:
                    if not goal_summary['available']:
                        if goal_summary['reason'] == 'unknown_strength':
                            count = goal_summary['unknown_strength_count']
                            status = (
                                'Unavailable — strength data is missing from '
                                f'{count} log '
                                f'{"entry" if count == 1 else "entries"}'
                            )
                        else:
                            status = 'Not enough evidence'
                        reading = ''
                    else:
                        status = (
                            'Guide met' if goal_summary['achieved']
                            else 'Guide not reached'
                        )
                        reading = (
                            f'{goal_summary["current"]}/'
                            f'{goal_summary["target"]} — '
                        )
                    message += (
                        f"<li><strong>{goal_summary['type']}:</strong> "
                        f"{reading}{status}</li>"
                    )
                message += "</ul>"
            else:
                message += "<p>No active goals. Consider setting some goals to track your progress!</p>"

            message += (
                "<p>Keep up the great work! Remember, every small step counts towards your health goals.</p>"
            )

            extra_data = {
                'week_start': last_week_start_local.isoformat(),
                'week_end': last_week_end_local.isoformat(),
                'total_pouches': total_pouches,
                'total_nicotine': (
                    round(total_nicotine, 1)
                    if total_nicotine is not None else None
                ),
                'unknown_strength_count': unknown_strength_count,
                'daily_average_pouches': round(daily_avg_pouches, 1),
                'daily_average_mg': (
                    round(daily_avg_mg, 1)
                    if daily_avg_mg is not None else None
                ),
                'total_logs': summary['total_logs'],
                'goals_count': len(goals_summary),
                'goals_on_track': goals_on_track,
                'active_streaks': active_streaks
            }

            current_app.logger.info(
                "Queueing weekly report for user %s covering %s to %s",
                user.id,
                last_week_start_local,
                last_week_end_local
            )

            return self._queue_weekly_channels(
                user,
                preferences,
                last_week_start_local,
                subject,
                message,
                extra_data,
            )

        except Exception as e:
            db.session.rollback()
            current_app.logger.error(
                f'Error queuing weekly report for user {user.id}: {e}',
                exc_info=True,
            )
            raise
    
    def queue_notification(self, user_id, category, subject, message, priority=5, extra_data=None):
        """
        Queues notifications for a user based on their channel and category preferences.
        Iterates through all possible channels and queues a notification if the user
        has opted in for that channel and category.
        """
        try:
            possible_channels = ['email', 'discord']  # Add new channels here in the future
            queued_count = 0

            for channel_type in possible_channels:
                if self.preferences_service.should_send_notification(user_id, category, channel_type):
                    if self._queue_single_notification(user_id, channel_type, category, subject, message, priority=priority, extra_data=extra_data):
                        queued_count += 1
            
            return queued_count > 0

        except Exception as e:
            current_app.logger.error(f'Error queuing notifications for user {user_id}: {e}')
            return False

    def _queue_single_notification(self, user_id, notification_type, category, subject, message, 
                                 recipient=None, priority=5, extra_data=None, scheduled_for=None):
        """Queues a single notification to a specific channel after validation."""
        try:
            user = User.query.get(user_id)
            if not user:
                current_app.logger.error(f'User {user_id} not found for notification')
                return False
            
            # Check quiet hours
            if self.preferences_service.is_quiet_hours(user_id):
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
            current_app.logger.error(f'Error queuing single notification: {e}')
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
                    if notification.category != 'weekly_report':
                        db.session.delete(notification)  # Ephemeral queue item
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

            handler = self.send_handlers.get(notification.notification_type)
            if handler:
                return handler(notification)
            
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
            # Use a request context to allow url_for to work with _external=True
            with current_app.test_request_context():
                # Map notification categories to specific templates
                template_map = {
                    'daily_reminder': 'emails/daily_reminder.html',
                    'goal_achievement': 'emails/goal_achievement.html', 
                    'achievement': 'emails/goal_achievement.html',
                    'weekly_report': 'emails/weekly_report.html',
                    'test_email': 'emails/test_email.html'
                }
                
                template_name = template_map.get(notification.category, 'emails/generic_notification.html')
                extra_data = self._normalize_extra_data(notification.extra_data)

                # Prepare template context
                context = {
                    'subject': notification.subject,
                    'message': notification.message,
                    'extra_data': extra_data,
                    'dashboard_url': url_for('dashboard.index', _external=True) if hasattr(notification, 'user_id') else '#'
                }

                # Enrich context for weekly reports so template fields render with numbers
                if notification.category == 'weekly_report' and extra_data:
                    ed = extra_data
                    # Map expected template variables with safe fallbacks
                    context.update({
                        'total_logs': ed.get('total_logs', ed.get('total_pouches', 0)),
                        'daily_average': ed.get('daily_average_pouches', 0),
                        'goals_on_track': ed.get('goals_on_track', ed.get('goals_count', 0)),
                        'active_streaks': ed.get('active_streaks', 0),
                        'total_pouches': ed.get('total_pouches', 0),
                        'total_nicotine': ed.get('total_nicotine'),
                        'daily_average_mg': ed.get('daily_average_mg'),
                        'unknown_strength_count': ed.get(
                            'unknown_strength_count', 0
                        ),
                    })
                
                # Add specific context for goal achievements
                if notification.category in ['goal_achievement', 'achievement'] and extra_data:
                    context['achievement_type'] = extra_data.get('achievement_type', 'milestone')
                    # Create a mock goal object for template compatibility
                    if 'goal_type' in extra_data:
                        context['goal'] = type('Goal', (), {
                            'goal_type': extra_data.get('goal_type', ''),
                            'target_value': extra_data.get('target_value', 0),
                            'current_streak': extra_data.get('current_streak', 0),
                            'best_streak': extra_data.get('best_streak', 0)
                        })()
                
                # Add action URL if available
                if extra_data and 'action_url' in extra_data:
                    context['action_url'] = extra_data['action_url']
                
                return render_template(template_name, **context)

            
        except Exception as e:
            current_app.logger.error(f'Error rendering email template: {e}')
            # Fallback to generic template
            return render_template('emails/generic_notification.html',
                                 subject=notification.subject,
                                 message=notification.message,
                                 extra_data=self._normalize_extra_data(notification.extra_data))
    
    def _format_discord_embed(self, notification):
        """Format notification as Discord embed"""
        extra_data = self._normalize_extra_data(notification.extra_data)

        # Special handling for weekly reports: avoid HTML and present clean fields
        if notification.category == 'weekly_report' and extra_data:
            ed = extra_data
            # Parse week range for display
            try:
                ws = datetime.fromisoformat(ed.get('week_start')).date() if ed.get('week_start') else None
                we = datetime.fromisoformat(ed.get('week_end')).date() if ed.get('week_end') else None
                week_range = f"Week of {ws.strftime('%b %d')} - {we.strftime('%b %d, %Y')}" if ws and we else "Weekly Summary"
            except Exception:
                week_range = "Weekly Summary"

            fields = []
            fields.append({
                "name": "Total Pouches",
                "value": str(ed.get('total_pouches', 0)),
                "inline": True
            })
            total_nicotine = ed.get('total_nicotine')
            fields.append({
                "name": "Total Nicotine",
                "value": (
                    f"{total_nicotine:.1f} mg"
                    if total_nicotine is not None
                    else "Unavailable — strength data missing"
                ),
                "inline": True
            })
            fields.append({
                "name": "Daily Avg (Pouches)",
                "value": f"{ed.get('daily_average_pouches', 0):.1f}",
                "inline": True
            })
            daily_average_mg = ed.get('daily_average_mg')
            if daily_average_mg is not None:
                fields.append({
                    "name": "Daily Avg (Nicotine)",
                    "value": f"{daily_average_mg:.1f} mg",
                    "inline": True
                })
            fields.append({
                "name": "Goals On Track",
                "value": f"{ed.get('goals_on_track', 0)}/{ed.get('goals_count', 0)}",
                "inline": True
            })
            fields.append({
                "name": "Active Streaks",
                "value": str(ed.get('active_streaks', 0)),
                "inline": True
            })

            return {
                "title": notification.subject,
                "description": week_range,
                "color": self._get_embed_color(notification.category),
                "timestamp": datetime.utcnow().isoformat(),
                "fields": fields,
                "footer": {"text": "Nicotine Tracker"}
            }

        # Default formatting for other categories (may include simple fields)
        embed = {
            "title": notification.subject,
            "description": self._strip_html(notification.message),
            "color": self._get_embed_color(notification.category),
            "timestamp": datetime.utcnow().isoformat(),
            "footer": {
                "text": "Nicotine Tracker"
            }
        }

        if extra_data:
            fields = []
            if 'progress' in extra_data:
                fields.append({"name": "Progress", "value": f"{extra_data['progress']}%", "inline": True})
            if 'streak' in extra_data:
                fields.append({"name": "Current Streak", "value": f"{extra_data['streak']} days", "inline": True})
            if 'goal_type' in extra_data:
                fields.append({"name": "Goal Type", "value": extra_data['goal_type'].replace('_', ' ').title(), "inline": True})
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
            
            self.queue_notification(
                user_id=user_id,
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
            
            self.queue_notification(
                user_id=user_id,
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
