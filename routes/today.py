"""Authenticated server-rendered Today destination."""

from flask import Blueprint, current_app, render_template

from routes.auth import get_current_user, login_required
from services.request_context import get_request_id
from services.today_service import TodayService


today_bp = Blueprint("today", __name__)


@today_bp.route("")
@today_bp.route("/")
@login_required
def index():
    user = get_current_user()
    settings = user.settings
    try:
        summary = TodayService.get_summary(user.id)
    except Exception:
        request_id = get_request_id()
        current_app.logger.exception(
            "Today summary unavailable (request %s)", request_id
        )
        return render_template(
            "pages/today/index.html",
            user=user,
            settings=settings,
            summary=None,
            today_unavailable=True,
            request_id=request_id,
        )
    return render_template(
        "pages/today/index.html",
        user=user,
        settings=settings,
        summary=summary,
        today_unavailable=False,
    )
