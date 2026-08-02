"""Canonical reset-aware evidence evaluation for legacy Goals.

This module is presentation-independent so web routes, Settings maintenance,
scheduled jobs, and weekly reports all use the same period and evidence rules.
"""

from datetime import datetime, time, timedelta

import pytz

from models import DailyCheckIn
from services.log_service import (
    group_logs_by_effective_day,
    logs_for_user_interval,
    summarize_logs,
)
from services.timezone_service import get_user_day_window, resolve_timezone


HISTORY_LIVE = 'live'
HISTORY_UI = 'ui'
HISTORY_FULL = 'full'
_HISTORY_MODES = {HISTORY_LIVE, HISTORY_UI, HISTORY_FULL}


def user_reset_time(user):
    preferences = user.preferences
    if preferences and preferences.daily_reset_time:
        return preferences.daily_reset_time
    return time.min


def effective_day_for_user(user, now_utc=None, resolved_timezone=None):
    """Return the active reset-aware account day from one UTC instant."""
    resolved_timezone = resolved_timezone or resolve_timezone(user.timezone)
    instant = now_utc or datetime.now(pytz.UTC)
    if instant.tzinfo is None:
        instant = pytz.UTC.localize(instant)
    else:
        instant = instant.astimezone(pytz.UTC)
    candidate = instant.astimezone(resolved_timezone).date()
    candidate_window = get_user_day_window(
        resolved_timezone.zone, candidate, user_reset_time(user)
    )
    if instant < candidate_window.start_utc:
        candidate -= timedelta(days=1)
    return candidate


def latest_completed_week(effective_day):
    """Return the Monday of the latest wholly completed account week."""
    return effective_day - timedelta(days=effective_day.weekday() + 7)


def _full_history_floor(user, goal, resolved_timezone, fallback_start):
    created_at = user.created_at or goal.created_at
    if created_at is None:
        return fallback_start
    return effective_day_for_user(
        user,
        now_utc=created_at,
        resolved_timezone=resolved_timezone,
    )


def _daily_history_dates(
        goal, effective_day, *, full_history, history_floor=None):
    end_date = min(
        effective_day - timedelta(days=1), goal.end_date or effective_day
    )
    fallback_start = end_date - timedelta(days=29)
    if full_history:
        start_date = goal.start_date or history_floor or fallback_start
    else:
        start_date = max(fallback_start, goal.start_date or fallback_start)
    if end_date < start_date:
        return []
    return [
        start_date + timedelta(days=offset)
        for offset in range((end_date - start_date).days + 1)
    ]


def _weekly_history_dates(
        goal, effective_day, *, full_history, history_floor=None):
    horizon_end = min(
        effective_day - timedelta(days=1), goal.end_date or effective_day
    )
    fallback_start = horizon_end - timedelta(days=29)
    if full_history:
        horizon_start = goal.start_date or history_floor or fallback_start
    else:
        horizon_start = max(
            fallback_start, goal.start_date or fallback_start
        )
    first_week = horizon_start + timedelta(
        days=(-horizon_start.weekday()) % 7
    )
    last_week = latest_completed_week(effective_day)
    dates = []
    week = first_week
    while week <= last_week:
        week_end = week + timedelta(days=6)
        if week_end <= horizon_end:
            dates.append(week)
        week += timedelta(days=7)
    return dates


def _periods_for_goals(
        user, goals, effective_day, resolved_timezone, history_mode):
    if history_mode not in _HISTORY_MODES:
        raise ValueError(f'unsupported goal history mode: {history_mode}')
    periods = {}
    for goal in goals:
        history_floor = None
        if history_mode == HISTORY_FULL and goal.start_date is None:
            history_floor = _full_history_floor(
                user,
                goal,
                resolved_timezone,
                effective_day - timedelta(days=30),
            )
        if goal.goal_type == 'weekly_reduction':
            if history_mode == HISTORY_LIVE:
                candidates = [latest_completed_week(effective_day)]
            else:
                candidates = _weekly_history_dates(
                    goal,
                    effective_day,
                    full_history=history_mode == HISTORY_FULL,
                    history_floor=history_floor,
                )
            periods[goal.id] = [
                week for week in candidates
                if (goal.start_date is None or week >= goal.start_date)
                and (
                    goal.end_date is None
                    or week + timedelta(days=6) <= goal.end_date
                )
            ]
        elif history_mode == HISTORY_LIVE:
            periods[goal.id] = [effective_day]
        else:
            periods[goal.id] = _daily_history_dates(
                goal,
                effective_day,
                full_history=history_mode == HISTORY_FULL,
                history_floor=history_floor,
            )
    return periods


def _load_evidence(
        user, periods_by_goal, goals, resolved_timezone, effective_day):
    reset_time = user_reset_time(user)
    evidence_dates = []
    goals_by_id = {goal.id: goal for goal in goals}
    for goal_id, periods in periods_by_goal.items():
        goal = goals_by_id[goal_id]
        for period in periods:
            if goal.goal_type == 'weekly_reduction':
                evidence_dates.extend((
                    period - timedelta(days=7),
                    period + timedelta(days=6),
                ))
            else:
                evidence_dates.append(period)
    if not evidence_dates:
        evidence_dates = [effective_day]
    start_date = min(evidence_dates)
    end_date = max(evidence_dates)
    start_window = get_user_day_window(
        resolved_timezone.zone, start_date, reset_time
    )
    end_window = get_user_day_window(
        resolved_timezone.zone, end_date, reset_time
    )
    logs = logs_for_user_interval(
        user.id, start_window.start_utc, end_window.end_utc
    )
    grouped_logs = group_logs_by_effective_day(
        logs, resolved_timezone, reset_time
    )
    check_in_dates = {
        row.local_date
        for row in DailyCheckIn.query.with_entities(
            DailyCheckIn.local_date
        ).filter(
            DailyCheckIn.user_id == user.id,
            DailyCheckIn.local_date >= start_date,
            DailyCheckIn.local_date <= end_date,
        ).all()
    }
    return grouped_logs, check_in_dates


def progress_from_evidence(
        goal, target_date, grouped_logs, check_in_dates, *, provisional=False):
    target = goal.target_value
    unknown_strength_count = 0
    reason = None
    if goal.goal_type in ('daily_pouches', 'daily_mg'):
        logs = grouped_logs.get(target_date, ())
        observed = bool(logs) or (
            not provisional and target_date in check_in_dates
        )
        if not observed:
            return _unavailable(goal, provisional, 'no_evidence')
        summary = summarize_logs(logs)
        unknown_strength_count = summary['unknown_strength_count']
        if goal.goal_type == 'daily_mg' and unknown_strength_count:
            return _unavailable(
                goal,
                provisional,
                'unknown_strength',
                unknown_strength_count=unknown_strength_count,
            )
        current = (
            float(summary['total_mg'])
            if goal.goal_type == 'daily_mg'
            else summary['total_pouches']
        )
        achieved = None if provisional else current <= target
        percentage = current / target * 100 if target > 0 else 0
    elif goal.goal_type == 'weekly_reduction':
        baseline_dates = [
            target_date + timedelta(days=offset) for offset in range(-7, 0)
        ]
        comparison_dates = [
            target_date + timedelta(days=offset) for offset in range(7)
        ]
        previous_pouches = sum(
            log.quantity or 0
            for day in baseline_dates
            for log in grouped_logs.get(day, ())
        )
        if previous_pouches <= 0:
            return _unavailable(goal, False, 'missing_baseline')
        comparison_observed = any(
            grouped_logs.get(day) or day in check_in_dates
            for day in comparison_dates
        )
        if not comparison_observed:
            return _unavailable(goal, False, 'no_evidence')
        current_pouches = sum(
            log.quantity or 0
            for day in comparison_dates
            for log in grouped_logs.get(day, ())
        )
        current = (
            (previous_pouches - current_pouches) / previous_pouches * 100
        )
        achieved = current >= target
        percentage = current / target * 100 if target > 0 else 0
    else:
        return _unavailable(goal, provisional, 'unsupported')
    return {
        'achieved': achieved,
        'available': True,
        'provisional': provisional,
        'reason': reason,
        'current': round(current, 1),
        'target': target,
        'percentage': min(percentage, 999),
        'unknown_strength_count': unknown_strength_count,
    }


def _unavailable(
        goal, provisional, reason, *, unknown_strength_count=0):
    return {
        'achieved': None,
        'available': False,
        'provisional': provisional,
        'reason': reason,
        'current': None,
        'target': goal.target_value,
        'percentage': 0,
        'unknown_strength_count': unknown_strength_count,
    }


def batch_goal_progress(
        user, goals, effective_day, resolved_timezone=None, *,
        history_mode=HISTORY_LIVE):
    """Evaluate all supplied goals with one log and one check-in query."""
    goals = list(goals)
    resolved_timezone = resolved_timezone or resolve_timezone(user.timezone)
    periods_by_goal = _periods_for_goals(
        user, goals, effective_day, resolved_timezone, history_mode
    )
    grouped_logs, check_in_dates = _load_evidence(
        user, periods_by_goal, goals, resolved_timezone, effective_day
    )
    results = {}
    for goal in goals:
        results[goal.id] = [
            progress_from_evidence(
                goal,
                period,
                grouped_logs,
                check_in_dates,
                provisional=(
                    history_mode == HISTORY_LIVE
                    and goal.goal_type != 'weekly_reduction'
                ),
            ) | {'date': period}
            for period in periods_by_goal[goal.id]
        ]
    return results


def evaluate_goal_period(
        user, goal, target_date, resolved_timezone=None, *, provisional=False):
    """Evaluate one explicit canonical period without presentation coercion."""
    resolved_timezone = resolved_timezone or resolve_timezone(user.timezone)
    period_date = (
        target_date - timedelta(days=target_date.weekday())
        if goal.goal_type == 'weekly_reduction' else target_date
    )
    periods = {goal.id: [period_date]}
    grouped_logs, check_in_dates = _load_evidence(
        user, periods, [goal], resolved_timezone, period_date
    )
    return progress_from_evidence(
        goal,
        period_date,
        grouped_logs,
        check_in_dates,
        provisional=provisional,
    )


def goal_threshold_notice(goal, progress):
    """Return one constructive threshold notice or ``None``."""
    if not progress['available']:
        return None
    threshold = goal.notification_threshold * 100
    if progress['percentage'] < threshold:
        return None
    if goal.goal_type == 'weekly_reduction':
        return {
            'type': 'success',
            'goal_id': goal.id,
            'message': (
                f'The latest completed week reached a '
                f'{progress["current"]:.0f}% reduction against your '
                f'{progress["target"]:.0f}% guide.'
            ),
        }
    label = (
        'nicotine ceiling' if goal.goal_type == 'daily_mg'
        else 'pouch ceiling'
    )
    return {
        'type': 'warning',
        'goal_id': goal.id,
        'message': (
            f'Today is at {progress["percentage"]:.0f}% of your '
            f'{label} ({progress["current"]}/{progress["target"]}).'
        ),
    }
