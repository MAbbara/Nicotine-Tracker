import socket
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

import pytest


def test_app_factory_uses_isolated_test_database(app):
    assert app.config["TESTING"] is True
    assert app.config["SQLALCHEMY_DATABASE_URI"] == "sqlite:///:memory:"


def test_css_is_built_from_tailwind_source():
    package = Path("package.json").read_text()
    assert '"build:css"' in package
    assert Path("static/css/tailwind.css").exists()


def test_logged_in_client_uses_real_session_auth(logged_in_client):
    """A session-authenticated client must reach login-protected pages."""
    response = logged_in_client.get("/dashboard/")
    assert response.status_code == 200


class TestLiveServerContract:
    def test_live_server_serves_the_app_over_http(self, live_server):
        with urllib.request.urlopen(f"{live_server}/auth/login", timeout=5) as response:
            assert response.status == 200
            assert b"email" in response.read().lower()

    def test_live_server_does_not_claim_fixed_dev_port(self, live_server):
        # A fixed port collides with a developer's running server; the OS assigns one.
        assert urlsplit(live_server).port != 5000


def test_live_server_context_manager_releases_process_and_port():
    from tests.conftest import managed_live_server

    with managed_live_server() as base_url:
        with urllib.request.urlopen(f"{base_url}/auth/login", timeout=5) as response:
            assert response.status == 200

    with pytest.raises(urllib.error.URLError):
        urllib.request.urlopen(f"{base_url}/auth/login", timeout=2)


# ---------------------------------------------------------------------------
# Port ownership: the child must bind its own OS-assigned port.
#
# The first two tests simulate a stale/repeated parent-side port prediction by
# monkeypatching the old predictor. Once the fixture lets each child bind
# 127.0.0.1:0 itself, the predictor no longer exists and ``raising=False``
# turns the patch into a no-op, so the same tests keep exercising the real
# contract: distinct, working ports regardless of what a parent would predict.
# ---------------------------------------------------------------------------


def test_nested_managed_live_servers_use_distinct_working_ports(monkeypatch):
    """Simultaneous servers must never be handed the same port."""
    from tests import conftest

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        repeated_port = probe.getsockname()[1]
    monkeypatch.setattr(
        conftest, "_find_free_loopback_port", lambda: repeated_port, raising=False
    )

    with conftest.managed_live_server() as outer_url:
        with conftest.managed_live_server() as inner_url:
            outer_port = urlsplit(outer_url).port
            inner_port = urlsplit(inner_url).port
            assert outer_port != inner_port
            for base_url in (outer_url, inner_url):
                with urllib.request.urlopen(f"{base_url}/auth/login", timeout=5) as response:
                    assert response.status == 200


def test_occupied_parent_predicted_port_is_ignored(monkeypatch):
    """The child asks the OS for its port, so an occupied prediction is harmless."""
    from tests import conftest

    blocker = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    blocker.bind(("127.0.0.1", 0))
    blocker.listen()
    occupied_port = blocker.getsockname()[1]
    monkeypatch.setattr(
        conftest, "_find_free_loopback_port", lambda: occupied_port, raising=False
    )
    try:
        with conftest.managed_live_server() as base_url:
            assert urlsplit(base_url).port != occupied_port
            with urllib.request.urlopen(f"{base_url}/auth/login", timeout=5) as response:
                assert response.status == 200
    finally:
        blocker.close()


def test_failed_spawn_leaves_injected_temp_parent_empty(tmp_path):
    """A popen_factory that raises must not leak the fixture's temp files."""
    from tests.conftest import managed_live_server

    def failing_popen_factory(*args, **kwargs):
        raise OSError("spawn refused by injected factory")

    with pytest.raises(OSError, match="spawn refused"):
        with managed_live_server(
            popen_factory=failing_popen_factory, temp_parent=str(tmp_path)
        ):
            pass
    assert list(tmp_path.iterdir()) == []
