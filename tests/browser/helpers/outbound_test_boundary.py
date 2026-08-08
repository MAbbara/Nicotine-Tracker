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
    def record_discord_post(url, *args, **kwargs):
        payload = kwargs.get('json')
        expected = (
            isinstance(url, str)
            and url.startswith('https://discord.com/api/webhooks/')
            and not args
            and kwargs.get('headers') == {'Content-Type': 'application/json'}
            and kwargs.get('timeout') == (3.05, 5.0)
            and kwargs.get('allow_redirects') is False
        )
        record = {
            'kind': 'http',
            'method': 'POST',
            'url': url,
            'payload': payload,
            'headers': kwargs.get('headers'),
            'timeout': kwargs.get('timeout'),
            'allow_redirects': kwargs.get('allow_redirects'),
        }
        if not expected:
            recorder.unexpected.append(record)
            raise AssertionError(f'Unexpected external HTTP POST: {url}')
        recorder.records.append({**record, 'kind': 'discord-transport'})

        class Response:
            status_code = 204
        return Response()

    def fail_email_send(*_args, **_kwargs):
        recorder.unexpected.append({'kind': 'email', 'method': 'SEND'})
        raise AssertionError('Unexpected external email send')

    def record_queue(
        _service, *, user_id, category, subject, message, priority=0,
        scheduled_for=None, extra_data=None, commit=True,
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

    def record_email(_service, notification):
        recorder.records.append({
            'kind': 'email-send',
            'method': 'SEND',
            'recipient': notification.recipient,
            'subject': notification.subject,
            'message': notification.message,
        })
        return True

    requests_module.post = record_discord_post
    mail.send = fail_email_send
    notification_service_cls.queue_notification = record_queue
    notification_service_cls.send_email_notification = record_email
    return recorder
