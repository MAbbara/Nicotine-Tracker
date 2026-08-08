from datetime import datetime

import pytest

VALID_WEBHOOK = (
    'https://discord.com/api/webhooks/123456789012345678/'
    'abcdefghijklmnopqrstuvwxyz_ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789'
)


def test_outbound_boundary_records_discord_exactly_and_fails_closed():
    from tests.browser.helpers.outbound_test_boundary import install_outbound_boundary

    class NotificationService:
        pass

    class Requests:
        @staticmethod
        def post(*_args, **_kwargs):
            raise AssertionError('real requests.post must be replaced')

    class Mail:
        @staticmethod
        def send(*_args, **_kwargs):
            raise AssertionError('real mail.send must be replaced')

    recorder = install_outbound_boundary(
        NotificationService,
        Requests,
        Mail,
        now=lambda: datetime(2026, 8, 3, 12, 0, 0),
    )

    success, message = NotificationService().test_discord_webhook(
        VALID_WEBHOOK,
    )
    assert success is True
    assert message == 'Discord boundary recorded.'
    assert recorder.records == [{
        'kind': 'discord-test',
        'method': 'POST',
        'url': VALID_WEBHOOK,
        'payload': {
            'embeds': [{
                'title': '🧪 Webhook Test',
                'description': (
                    'This is a test message from Nicotine Tracker to verify '
                    'your Discord webhook is working correctly.'
                ),
                'color': 0x10B981,
                'timestamp': '2026-08-03T12:00:00',
                'footer': {'text': 'Nicotine Tracker - Test Message'},
            }],
        },
    }]

    with pytest.raises(AssertionError, match='Unexpected external HTTP POST'):
        Requests.post('https://outside.invalid/hook', json={'unsafe': True})
    with pytest.raises(AssertionError, match='Unexpected external email send'):
        Mail.send(object())
    assert recorder.unexpected == [
        {
            'kind': 'http', 'method': 'POST',
            'url': 'https://outside.invalid/hook',
            'payload': {'unsafe': True},
        },
        {'kind': 'email', 'method': 'SEND'},
    ]
