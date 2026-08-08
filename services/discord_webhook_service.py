"""Canonical validation and bounded transport for Discord webhooks."""
from dataclasses import dataclass
import logging
import re
from urllib.parse import urlsplit

import requests


LOGGER = logging.getLogger(__name__)
WEBHOOK_RE = re.compile(r"^/api/webhooks/([0-9]{1,32})/([A-Za-z0-9._-]{20,200})$")


class DiscordWebhookError(ValueError):
    pass


@dataclass(frozen=True)
class CanonicalDiscordWebhook:
    url: str
    webhook_id: str
    token: str


def parse_discord_webhook(value) -> CanonicalDiscordWebhook:
    if not isinstance(value, str) or not value or len(value) > 255:
        raise DiscordWebhookError("Enter a valid Discord webhook URL.")
    if value != value.strip():
        raise DiscordWebhookError("Enter a valid Discord webhook URL.")
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError as error:
        raise DiscordWebhookError("Enter a valid Discord webhook URL.") from error
    # netloc spelling is deliberately strict so stored values have one form.
    if parsed.scheme != "https" or parsed.netloc not in {"discord.com", "discord.com:443"}:
        raise DiscordWebhookError("Enter a valid Discord webhook URL.")
    if parsed.hostname != "discord.com" or port not in {None, 443}:
        raise DiscordWebhookError("Enter a valid Discord webhook URL.")
    if parsed.username is not None or parsed.password is not None:
        raise DiscordWebhookError("Enter a valid Discord webhook URL.")
    if parsed.query or parsed.fragment:
        raise DiscordWebhookError("Enter a valid Discord webhook URL.")
    match = WEBHOOK_RE.fullmatch(parsed.path)
    if not match:
        raise DiscordWebhookError("Enter a valid Discord webhook URL.")
    webhook_id, token = match.groups()
    url = f"https://discord.com/api/webhooks/{webhook_id}/{token}"
    return CanonicalDiscordWebhook(url=url, webhook_id=webhook_id, token=token)


def safe_discord_post(webhook, payload, *, post=None) -> bool:
    """Send only a previously parsed webhook, with bounded no-redirect IO."""
    if not isinstance(webhook, CanonicalDiscordWebhook):
        raise DiscordWebhookError("Webhook must be parsed immediately before send.")
    post = post or requests.post
    try:
        response = post(
            webhook.url,
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=(3.05, 5.0),
            allow_redirects=False,
        )
    except requests.RequestException as error:
        LOGGER.warning("Discord delivery failed (%s).", type(error).__name__)
        return False
    if response.status_code == 204:
        return True
    LOGGER.warning("Discord delivery returned HTTP %s.", response.status_code)
    return False
