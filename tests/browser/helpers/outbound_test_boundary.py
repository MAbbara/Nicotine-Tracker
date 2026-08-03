"""Fail-closed outbound doubles for the deterministic Playwright server only."""

from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class OutboundRecorder:
    records: list = field(default_factory=list)
    unexpected: list = field(default_factory=list)


def install_outbound_boundary(notification_service_cls, requests_module, mail, *, now=None):
    """Replace every notification transport while retaining literal boundary data."""
    recorder = OutboundRecorder()
    clock = now or datetime.utcnow

    def fail_http_post(url, *args, **kwargs):
        payload = kwargs.get('json')
        recorder.unexpected.append({
            'kind': 'http',
            'method': 'POST',
            'url': url,
            'payload': payload,
        })
        raise AssertionError(f'Unexpected external HTTP POST: {url}')

    def fail_email_send(*_args, **_kwargs):
        recorder.unexpected.append({'kind': 'email', 'method': 'SEND'})
        raise AssertionError('Unexpected external email send')

    def record_queue(
        _service, *, user_id, category, subject, message, priority=0,
        scheduled_for=None, extra_data=None,
    ):
        recorder.records.append({
            'kind': 'notification-queue',
            'user_id': user_id,
            'category': category,
            'subject': subject,
            'message': message,
            'priority': priority,
            'scheduled_for': scheduled_for.isoformat() if scheduled_for else None,
            'extra_data': extra_data or {},
        })
        return True

    def record_discord_test(_service, webhook_url):
        payload = {
            'embeds': [{
                'title': '🧪 Webhook Test',
                'description': (
                    'This is a test message from Nicotine Tracker to verify '
                    'your Discord webhook is working correctly.'
                ),
                'color': 0x10B981,
                'timestamp': clock().isoformat(),
                'footer': {'text': 'Nicotine Tracker - Test Message'},
            }],
        }
        recorder.records.append({
            'kind': 'discord-test',
            'method': 'POST',
            'url': webhook_url,
            'payload': payload,
        })
        return True, 'Discord boundary recorded.'

    def record_email(_service, notification):
        recorder.records.append({
            'kind': 'email-send',
            'method': 'SEND',
            'recipient': notification.recipient,
            'subject': notification.subject,
            'message': notification.message,
        })
        return True

    def record_discord(_service, notification):
        payload = {'embeds': [_service._format_discord_embed(notification)]}
        recorder.records.append({
            'kind': 'discord-send',
            'method': 'POST',
            'url': notification.recipient,
            'payload': payload,
        })
        return True

    requests_module.post = fail_http_post
    mail.send = fail_email_send
    notification_service_cls.queue_notification = record_queue
    notification_service_cls.test_discord_webhook = record_discord_test
    notification_service_cls.send_email_notification = record_email
    notification_service_cls.send_discord_notification = record_discord
    return recorder
