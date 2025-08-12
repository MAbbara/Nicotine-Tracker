from abc import ABC, abstractmethod
from flask import current_app
import requests
from extensions import mail
from flask_mail import Message

class NotificationChannel(ABC):
    @abstractmethod
    def send(self, notification):
        pass

class EmailChannel(NotificationChannel):
    def send(self, notification):
        try:
            if current_app.config.get('FLASK_ENV') == 'development' or current_app.debug:
                current_app.logger.info(f'Development mode: Skipping email notification to {notification.recipient}')
                return True

            msg = Message(
                subject=notification.subject,
                sender=current_app.config['MAIL_DEFAULT_SENDER'],
                recipients=[notification.recipient]
            )
            msg.html = notification.message
            mail.send(msg)
            return True
        except Exception as e:
            current_app.logger.error(f"Failed to send email: {e}")
            return False

class DiscordChannel(NotificationChannel):
    def send(self, notification):
        try:
            webhook_url = notification.recipient
            embed = {
                "title": notification.subject,
                "description": notification.message,
                "color": 0x3b82f6
            }
            payload = {"embeds": [embed]}
            response = requests.post(webhook_url, json=payload, timeout=10)
            response.raise_for_status()
            return True
        except Exception as e:
            current_app.logger.error(f"Failed to send Discord notification: {e}")
            return False

class NotificationDispatcher:
    def __init__(self):
        self.channels = {
            'email': EmailChannel(),
            'discord': DiscordChannel()
        }

    def dispatch(self, notification):
        channel_preference = notification.notification_channel

        if channel_preference == 'both':
            results = {}
            for channel_name, channel in self.channels.items():
                results[channel_name] = channel.send(notification)
            return all(results.values())
        
        channel = self.channels.get(channel_preference)
        if channel:
            return channel.send(notification)
        
        return False
