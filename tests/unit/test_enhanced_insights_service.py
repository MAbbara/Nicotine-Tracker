"""Unit contracts for honest Insights comparison windows and sufficiency."""

from datetime import datetime, timedelta, timezone

from models import Log
from services import enhanced_insights_service as insights_service
from services import log_service


LEGACY_KEYS = {
    "total_pouches",
    "daily_average",
    "peak_day",
    "average_time_between_pouches",
    "total_nicotine",
    "unknown_strength_count",
    "best_day",
    "consistency_score",
    "trend_direction",
    "consumption_by_time_of_day",
    "consumption_by_day_of_week",
    "brand_analysis",
    "consumption_trend",
    "heatmap_data",
    "ai_insights",
}


def _freeze_utcnow(monkeypatch, value):
    class FrozenDateTime(datetime):
        @classmethod
        def utcnow(cls):
            return value

    monkeypatch.setattr(insights_service, "datetime", FrozenDateTime)


def _add_log(db_session, user, pouch, *, at, quantity):
    log = Log(user_id=user.id, log_time=at, quantity=quantity)
    log_service.assign_log_product(log, pouch_id=pouch.id)
    db_session.add(log)
    return log


def test_equal_adjacent_windows_produce_exact_comparison_and_sufficiency(
        db_session, test_user, test_pouch, monkeypatch):
    boundary = datetime(2026, 8, 1, 0, 0)
    _freeze_utcnow(monkeypatch, boundary)
    current_start = boundary - timedelta(days=7)
    previous_start = current_start - timedelta(days=7)
    for offset in range(7):
        _add_log(
            db_session,
            test_user,
            test_pouch,
            at=current_start + timedelta(days=offset, hours=12),
            quantity=3,
        )
        _add_log(
            db_session,
            test_user,
            test_pouch,
            at=previous_start + timedelta(days=offset, hours=12),
            quantity=4,
        )
    db_session.commit()

    result = insights_service.get_enhanced_insights(test_user.id, 7)

    assert LEGACY_KEYS <= result.keys()
    assert result["range_days"] == 7
    assert result["observed_days"] == 7
    assert result["log_count"] == 7
    assert result["comparison"] == {
        "available": True,
        "current_total": 21,
        "previous_total": 28,
        "absolute_change": -7,
        "percent_change": -25.0,
        "direction": "down",
    }
    assert result["data_sufficiency"] == {
        "trend": True,
        "time_pattern": True,
        "brand_pattern": True,
        "heatmap": True,
    }


def test_previous_zero_is_available_without_infinite_percent(
        db_session, test_user, test_pouch, monkeypatch):
    boundary = datetime(2026, 8, 1, 0, 0)
    _freeze_utcnow(monkeypatch, boundary)
    _add_log(
        db_session,
        test_user,
        test_pouch,
        at=boundary - timedelta(days=1),
        quantity=2,
    )
    _add_log(
        db_session,
        test_user,
        test_pouch,
        at=boundary - timedelta(days=8),
        quantity=0,
    )
    db_session.commit()

    comparison = insights_service.get_enhanced_insights(test_user.id, 7)["comparison"]

    assert comparison == {
        "available": True,
        "current_total": 2,
        "previous_total": 0,
        "absolute_change": 2,
        "percent_change": None,
        "direction": "up",
    }


def test_sparse_and_empty_current_ranges_never_invent_a_trend(
        db_session, test_user, test_pouch, monkeypatch):
    boundary = datetime(2026, 8, 1, 0, 0)
    _freeze_utcnow(monkeypatch, boundary)
    for days_ago in (1, 2):
        _add_log(
            db_session,
            test_user,
            test_pouch,
            at=boundary - timedelta(days=days_ago),
            quantity=1,
        )
    _add_log(
        db_session,
        test_user,
        test_pouch,
        at=boundary - timedelta(days=8),
        quantity=3,
    )
    db_session.commit()

    sparse = insights_service.get_enhanced_insights(test_user.id, 7)
    assert sparse["observed_days"] == 2
    assert sparse["log_count"] == 2
    assert sparse["data_sufficiency"] == {
        "trend": False,
        "time_pattern": False,
        "brand_pattern": False,
        "heatmap": False,
    }

    empty_boundary = boundary + timedelta(days=7)
    _freeze_utcnow(monkeypatch, empty_boundary)
    empty = insights_service.get_enhanced_insights(test_user.id, 7)
    assert LEGACY_KEYS <= empty.keys()
    assert empty["range_days"] == 7
    assert empty["observed_days"] == 0
    assert empty["log_count"] == 0
    assert empty["comparison"]["available"] is False
    assert empty["comparison"]["current_total"] == 0
    assert empty["comparison"]["previous_total"] == 2
    assert empty["data_sufficiency"] == {
        "trend": False,
        "time_pattern": False,
        "brand_pattern": False,
        "heatmap": False,
    }


def test_log_retrieval_uses_half_open_utc_bounds_and_user_timezone(
        db_session, test_user, test_pouch):
    end_at = datetime(2026, 8, 1, 0, 0, tzinfo=timezone.utc)
    start = end_at.replace(tzinfo=None) - timedelta(days=1)
    included_start = _add_log(
        db_session, test_user, test_pouch, at=start, quantity=2,
    )
    included_end = _add_log(
        db_session, test_user, test_pouch,
        at=end_at.replace(tzinfo=None) - timedelta(microseconds=1), quantity=3,
    )
    _add_log(
        db_session, test_user, test_pouch,
        at=start - timedelta(microseconds=1), quantity=5,
    )
    _add_log(
        db_session, test_user, test_pouch,
        at=end_at.replace(tzinfo=None), quantity=7,
    )
    db_session.commit()

    frame = insights_service.get_user_logs_df(
        test_user.id, "Asia/Riyadh", days=1, end_at=end_at,
    )

    assert frame["quantity"].tolist() == [included_start.quantity, included_end.quantity]
    assert frame["utc_time"].min() == start
    assert frame["utc_time"].max() < end_at.replace(tzinfo=None)
    assert all(value.utcoffset() == timedelta(hours=3) for value in frame["user_time"])


def test_exact_shared_boundary_belongs_only_to_current_window(
        db_session, test_user, test_pouch, monkeypatch):
    boundary = datetime(2026, 8, 1, 0, 0)
    current_start = boundary - timedelta(days=7)
    _freeze_utcnow(monkeypatch, boundary)
    _add_log(db_session, test_user, test_pouch, at=current_start, quantity=5)
    _add_log(
        db_session,
        test_user,
        test_pouch,
        at=current_start - timedelta(microseconds=1),
        quantity=2,
    )
    db_session.commit()

    comparison = insights_service.get_enhanced_insights(test_user.id, 7)["comparison"]

    assert comparison["current_total"] == 5
    assert comparison["previous_total"] == 2
    assert comparison["absolute_change"] == 3
