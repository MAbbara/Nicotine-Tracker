from types import SimpleNamespace

import pytest

VALID_WEBHOOK = (
    'https://discord.com/api/webhooks/123456789012345678/'
    'abcdefghijklmnopqrstuvwxyz_ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789'
)


def test_outbound_boundary_runs_production_discord_validation_and_transport(app):
    from tests.browser.helpers.outbound_test_boundary import install_outbound_boundary
    from services.notification_service import NotificationService
    from services import notification_service as notification_module

    class Mail:
        @staticmethod
        def send(*_args, **_kwargs):
            raise AssertionError('real mail.send must be replaced')

    original_post = notification_module.requests.post
    original_queue = NotificationService.queue_notification
    original_email = NotificationService.send_email_notification
    original_mail = Mail.send
    recorder = install_outbound_boundary(
        NotificationService,
        notification_module.requests,
        Mail,
    )
    with app.test_request_context('/'):
        success, message = NotificationService().test_discord_webhook(VALID_WEBHOOK)
        assert success is True
        assert message == 'Test message sent successfully!'
        success, message = NotificationService().test_discord_webhook(
            'http://169.254.169.254/api/webhooks/1/private-token',
        )
        assert success is False
        assert message == 'Enter a valid Discord webhook URL.'

        corrupt = SimpleNamespace(recipient='https://outside.invalid/hook')
        assert NotificationService().send_discord_notification(corrupt) is False
        valid = SimpleNamespace(
            recipient=VALID_WEBHOOK, subject='Subject', message='Body',
            category='daily_reminder', extra_data={},
        )
        assert NotificationService().send_discord_notification(valid) is True

    assert len(recorder.records) == 2
    assert all(record['kind'] == 'discord-transport' for record in recorder.records)
    assert all(record['timeout'] == (3.05, 5.0) for record in recorder.records)
    assert all(record['allow_redirects'] is False for record in recorder.records)
    assert recorder.unexpected == []

    with pytest.raises(AssertionError, match='Unexpected external HTTP POST'):
        notification_module.requests.post(
            'https://outside.invalid/hook', json={'unsafe': True},
        )
    with pytest.raises(AssertionError, match='Unexpected external email send'):
        Mail.send(object())
    assert [item['kind'] for item in recorder.unexpected] == ['http', 'email']
    notification_module.requests.post = original_post
    NotificationService.queue_notification = original_queue
    NotificationService.send_email_notification = original_email
    Mail.send = original_mail
