import logging

import pytest
from types import SimpleNamespace

from services.discord_webhook_service import (
    DiscordWebhookError,
    parse_discord_webhook,
    safe_discord_post,
)


VALID = (
    "https://discord.com/api/webhooks/123456789012345678/"
    "abcdefghijklmnopqrstuvwxyz_ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789"
)


@pytest.mark.parametrize("value", [
    "http://discord.com/api/webhooks/123/token-token-token-token",
    "https://Discord.com/api/webhooks/123/token-token-token-token",
    "https://discord.com:444/api/webhooks/123/token-token-token-token",
    "https://user@discord.com/api/webhooks/123/token-token-token-token",
    "https://discord.com/api/webhooks/not-numeric/token-token-token-token",
    "https://discord.com/api/webhooks/123/short",
    "https://discord.com/api/webhooks/123/token-token-token-token?wait=true",
    "https://discord.com/api/webhooks/123/token-token-token-token#fragment",
    "https://discordapp.com/api/webhooks/123/token-token-token-token",
    "https://127.0.0.1/api/webhooks/123/token-token-token-token",
    "https://169.254.169.254/api/webhooks/123/token-token-token-token",
    "https://discord.com/api/webhooks/123/token-token-token-token/extra",
    "https://discord.com/other/123/token-token-token-token",
    "x" * 256,
])
def test_parser_rejects_noncanonical_or_unsafe_webhooks(value):
    with pytest.raises(DiscordWebhookError):
        parse_discord_webhook(value)


def test_safe_post_is_bounded_no_redirect_and_never_logs_secret(caplog):
    webhook = parse_discord_webhook(VALID)

    class Response:
        status_code = 204

    calls = []
    def post(*args, **kwargs):
        calls.append((args, kwargs))
        return Response()

    caplog.set_level(logging.DEBUG)
    assert safe_discord_post(webhook, {"content": "private body"}, post=post)
    assert calls == [((VALID,), {
        "json": {"content": "private body"},
        "headers": {"Content-Type": "application/json"},
        "timeout": (3.05, 5.0),
        "allow_redirects": False,
    })]
    assert webhook.token not in caplog.text
    assert "private body" not in caplog.text


def test_safe_post_rejects_redirect_without_logging_response_body(caplog):
    webhook = parse_discord_webhook(VALID)

    class Response:
        status_code = 302
        text = "secret response body"

    caplog.set_level(logging.DEBUG)
    assert not safe_discord_post(webhook, {"content": "private body"}, post=lambda *a, **k: Response())
    assert "secret response body" not in caplog.text
    assert webhook.token not in caplog.text


def test_notification_worker_revalidates_corrupt_stored_recipient_before_transport(
        app, monkeypatch, caplog):
    from services.notification_service import NotificationService
    called = False
    def transport(*_args, **_kwargs):
        nonlocal called
        called = True
        return True
    monkeypatch.setattr('services.notification_service.safe_discord_post', transport)
    notification = SimpleNamespace(
        recipient='http://169.254.169.254/api/webhooks/1/private-token',
        category='weekly_report', subject='private', message='private body',
        extra_data={},
    )
    with app.app_context():
        assert NotificationService().send_discord_notification(notification) is False
    assert called is False
    assert 'private-token' not in caplog.text
    assert 'private body' not in caplog.text
