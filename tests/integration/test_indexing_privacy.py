from bs4 import BeautifulSoup

from services.password_reset_service import PasswordResetService


def _metadata(response):
    assert response.status_code == 200
    return BeautifulSoup(response.data, "html.parser")


def _assert_noindex(response):
    document = _metadata(response)
    robots = document.find_all("meta", attrs={"name": "robots"})
    assert len(robots) == 1
    assert robots[0].get("content") == "noindex, nofollow"
    return document


def test_public_landing_remains_indexable(client):
    document = _metadata(client.get("/"))

    assert document.find("meta", attrs={"name": "robots"}) is None


def test_auth_page_is_not_indexable(client):
    _assert_noindex(client.get("/auth/login"))


def test_authenticated_page_is_not_indexable(logged_in_client):
    _assert_noindex(logged_in_client.get("/today/"))


def test_valid_reset_token_is_not_indexable_and_sends_no_referrer(
    app, client, test_user,
):
    with app.app_context():
        token = PasswordResetService().create_reset_token(test_user.id).token

    document = _assert_noindex(client.get(f"/auth/reset_password/{token}"))
    referrer = document.find_all("meta", attrs={"name": "referrer"})
    assert len(referrer) == 1
    assert referrer[0].get("content") == "no-referrer"
