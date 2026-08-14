import pandas as pd
from datetime import datetime, timedelta
from decimal import Decimal
import pytz
from sqlalchemy import case

from extensions import db
from models import Craving, Log, PlanDay, ReductionPlan, User
from services.log_service import (
    get_historical_brand,
    get_historical_nicotine_strength,
)
from services import timezone_service as tz_service
import numpy as np

def get_user_logs_df(
        user_id: int,
        user_timezone: str,
        days: int = 30,
        end_at: datetime = None,
):
    """Get user logs as DataFrame with timezone conversion"""
    window_end = (
        tz_service.to_naive_utc(end_at)
        if end_at is not None
        else datetime.utcnow()
    )
    window_start = window_end - timedelta(days=days)

    resolved_tz = tz_service.resolve_timezone(user_timezone)
    logs = Log.query.filter(
        Log.user_id == user_id,
        Log.log_time >= window_start,
        Log.log_time < window_end,
    ).order_by(Log.log_time).all()

    if not logs:
        return pd.DataFrame()

    rows = []
    for log in logs:
        normalized_utc = tz_service.to_naive_utc(log.log_time)
        user_time = pytz.UTC.localize(normalized_utc).astimezone(resolved_tz)
        rows.append({
            'utc_time': normalized_utc,
            'quantity': log.quantity,
            'pouch_id': log.pouch_id,
            'custom_brand': log.custom_brand,
            'custom_nicotine_mg': log.custom_nicotine_mg,
            'user_time': user_time,
            'brand': get_historical_brand(log),
            'nicotine_mg': get_historical_nicotine_strength(log),
        })

    return pd.DataFrame(rows)


def _known_nicotine_total(df):
    if df.empty:
        return Decimal('0.00'), 0

    total = Decimal('0.00')
    unknown_strength_count = 0
    for row in df.itertuples(index=False):
        if pd.isna(row.nicotine_mg):
            unknown_strength_count += 1
            continue
        total += Decimal(int(row.quantity or 0)) * Decimal(str(row.nicotine_mg))
    return total.quantize(Decimal('0.01')), unknown_strength_count


def _comparison_metadata(current_df, previous_df, days):
    current_total, current_unknown = _known_nicotine_total(current_df)
    previous_total, previous_unknown = _known_nicotine_total(previous_df)
    observed_days = (
        int(current_df['user_time'].dt.date.nunique())
        if not current_df.empty
        else 0
    )
    log_count = int(len(current_df))
    comparison_available = (
        not current_df.empty
        and not previous_df.empty
        and current_unknown == 0
        and previous_unknown == 0
    )
    absolute_change = current_total - previous_total if comparison_available else None
    percent_change = None
    direction = None
    if comparison_available:
        if previous_total != 0:
            percent_change = round((absolute_change / previous_total) * 100, 1)
        if current_total < previous_total:
            direction = 'down'
        elif current_total > previous_total:
            direction = 'up'
        else:
            direction = 'steady'

    return {
        'range_days': int(days),
        'observed_days': observed_days,
        'log_count': log_count,
        'comparison': {
            'metric': 'nicotine_mg',
            'available': comparison_available,
            'current_total': float(current_total),
            'previous_total': float(previous_total),
            'absolute_change': absolute_change,
            'percent_change': percent_change,
            'direction': direction,
            'current_unknown_strength_count': current_unknown,
            'previous_unknown_strength_count': previous_unknown,
        },
        'data_sufficiency': {
            'trend': observed_days >= 3 and log_count >= 3,
            'time_pattern': log_count >= 5,
            'brand_pattern': log_count >= 3,
            'heatmap': observed_days >= 7 and log_count >= 7,
        },
    }


def _nicotine_distribution(df):
    """Aggregate known nicotine mg from immutable log snapshot columns."""
    empty_coverage = {
        'known_logs': 0,
        'unknown_logs': 0,
        'total_logs': 0,
        'known_percent': 0.0,
        'complete': True,
    }
    if df.empty:
        return {}, {}, empty_coverage

    time_labels = (
        'Night (12AM-6AM)', 'Morning (6AM-12PM)',
        'Afternoon (12PM-6PM)', 'Evening (6PM-12AM)',
    )
    by_time_raw = {label: Decimal('0.00') for label in time_labels}
    by_product_raw = {}
    known_logs = 0
    unknown_logs = 0
    for row in df.itertuples(index=False):
        quantity = int(row.quantity or 0)
        if pd.isna(row.nicotine_mg):
            unknown_logs += 1
            continue
        known_logs += 1
        strength = Decimal(str(row.nicotine_mg))
        nicotine_total = (Decimal(quantity) * strength).quantize(Decimal('0.01'))
        hour = int(row.user_time.hour)
        time_label = time_labels[min(hour // 6, 3)]
        by_time_raw[time_label] += nicotine_total
        snapshot_brand = '' if pd.isna(row.brand) else str(row.brand)
        brand = snapshot_brand if snapshot_brand.strip() else 'Unknown product'
        by_product_raw[brand] = (
            by_product_raw.get(brand, Decimal('0.00')) + nicotine_total
        )

    def sorted_values(values):
        return dict(sorted(values.items(), key=lambda item: item[1], reverse=True))

    by_time = sorted_values(by_time_raw)
    by_product = sorted_values(by_product_raw)
    total_logs = known_logs + unknown_logs
    coverage = {
        'known_logs': known_logs,
        'unknown_logs': unknown_logs,
        'total_logs': total_logs,
        'known_percent': round(known_logs / total_logs * 100, 1) if total_logs else 0.0,
        'complete': unknown_logs == 0,
    }
    return by_time, by_product, coverage


def _neutral_plan_context(plan=None, *, state="none", compared_days=0):
    return {
        'state': state,
        'adherence_available': False,
        'mode': plan.mode if plan is not None else None,
        'status': plan.status if plan is not None else None,
        'compared_days': int(compared_days),
        'days_on_or_below_target': None,
        'actual_pouches': None,
        'target_pouches': None,
        'difference_pouches': None,
        'adherence_rate': None,
    }


def _plan_context(user_id: int, df: pd.DataFrame, window_end: datetime,
                  days: int) -> dict:
    """Return plan state and adherence based only on matched logged dates."""
    plan = (
        ReductionPlan.query.filter(
            ReductionPlan.user_id == user_id,
            ReductionPlan.status.in_(("active", "paused")),
        )
        .order_by(
            case((ReductionPlan.status == "active", 0), else_=1),
            ReductionPlan.updated_at.desc(),
            ReductionPlan.id.desc(),
        )
        .first()
    )
    if plan is None:
        return _neutral_plan_context()
    if plan.status == "paused":
        return _neutral_plan_context(plan, state="paused")
    if plan.mode == "observe":
        return _neutral_plan_context(plan, state="active_observe")

    if df.empty or 'user_time' not in df or 'quantity' not in df:
        return _neutral_plan_context(plan, state="active_targeted")

    local_timezone = df['user_time'].dt.tz
    normalized_end = tz_service.to_naive_utc(window_end)
    end_utc = pytz.UTC.localize(normalized_end)
    start_utc = end_utc - timedelta(days=days)
    local_start_date = start_utc.astimezone(local_timezone).date()
    local_end_date = end_utc.astimezone(local_timezone).date()

    actual_by_date = (
        df.assign(local_date=df['user_time'].dt.date)
        .groupby('local_date')['quantity']
        .sum()
    )
    logged_dates = tuple(actual_by_date.index)
    plan_days = (
        PlanDay.query.with_entities(
            PlanDay.local_date,
            PlanDay.target_pouches,
            PlanDay.nicotine_ceiling_mg,
        )
        .filter(
            PlanDay.plan_id == plan.id,
            PlanDay.local_date.in_(logged_dates),
            PlanDay.local_date >= local_start_date,
            PlanDay.local_date <= local_end_date,
        )
        .order_by(PlanDay.local_date, PlanDay.id)
        .all()
    )
    generation_inputs = plan.active_revision.generation_inputs or {}
    nicotine_first = generation_inputs.get('target_basis') == 'nicotine_mg'
    if nicotine_first:
        nicotine_days = [
            row for row in plan_days if row.nicotine_ceiling_mg is not None
        ]
        compared_days = len(nicotine_days)
        result = _neutral_plan_context(
            plan, state="active_targeted", compared_days=compared_days,
        )
        result.update({
            'target_basis': 'nicotine_mg',
            'total_complete': True,
            'actual_mg': None,
            'target_mg': None,
            'difference_mg': None,
        })
        rows_by_date = {
            local_date: group
            for local_date, group in df.assign(
                local_date=df['user_time'].dt.date,
            ).groupby('local_date')
        }
        total_complete = all(
            not rows_by_date[plan_day.local_date]['nicotine_mg'].isna().any()
            for plan_day in nicotine_days
        )
        result['total_complete'] = total_complete
        if compared_days < 3 or not total_complete:
            return result

        actual_by_date_mg = {}
        for plan_day in nicotine_days:
            rows = rows_by_date[plan_day.local_date]
            actual_by_date_mg[plan_day.local_date] = sum(
                Decimal(str(row.quantity or 0)) * Decimal(str(row.nicotine_mg))
                for row in rows.itertuples(index=False)
            )
        actual_mg = sum(actual_by_date_mg.values(), Decimal('0.00'))
        target_mg = sum(
            (Decimal(str(row.nicotine_ceiling_mg)) for row in nicotine_days),
            Decimal('0.00'),
        )
        days_on_or_below_target = sum(
            actual_by_date_mg[row.local_date] <= Decimal(str(row.nicotine_ceiling_mg))
            for row in nicotine_days
        )
        result.update({
            'adherence_available': True,
            'days_on_or_below_target': days_on_or_below_target,
            'actual_mg': float(actual_mg),
            'target_mg': float(target_mg),
            'difference_mg': float(actual_mg - target_mg),
            'adherence_rate': round(
                (days_on_or_below_target / compared_days) * 100, 1,
            ),
        })
        return result

    plan_days = [row for row in plan_days if row.target_pouches is not None]
    compared_days = len(plan_days)
    if compared_days < 3:
        return _neutral_plan_context(
            plan, state="active_targeted", compared_days=compared_days,
        )

    actual_pouches = sum(
        int(actual_by_date.loc[local_date])
        for local_date, _target, _ceiling in plan_days
    )
    target_pouches = sum(
        int(target) for _local_date, target, _ceiling in plan_days
    )
    days_on_or_below_target = sum(
        int(actual_by_date.loc[local_date]) <= int(target)
        for local_date, target, _ceiling in plan_days
    )
    return {
        'state': 'active_targeted',
        'adherence_available': True,
        'mode': plan.mode,
        'status': plan.status,
        'compared_days': compared_days,
        'days_on_or_below_target': days_on_or_below_target,
        'actual_pouches': actual_pouches,
        'target_pouches': target_pouches,
        'difference_pouches': actual_pouches - target_pouches,
        'adherence_rate': round(
            (days_on_or_below_target / compared_days) * 100, 1,
        ),
    }


def _craving_pattern(user_id: int, window_start: datetime,
                     window_end: datetime) -> dict:
    """Return a bounded trigger/outcome pattern without private free text."""
    recognized_outcomes = (
        'resisted',
        'used_alternative',
        'used_nicotine',
    )
    outcome_counts = {outcome: 0 for outcome in recognized_outcomes}
    rows = (
        Craving.query.with_entities(
            Craving.id,
            Craving.trigger,
            Craving.outcome,
        )
        .filter(
            Craving.user_id == user_id,
            Craving.craving_time >= tz_service.to_naive_utc(window_start),
            Craving.craving_time < tz_service.to_naive_utc(window_end),
        )
        .order_by(Craving.craving_time, Craving.id)
        .all()
    )

    trigger_counts = {}
    trigger_labels = {}
    resolved_count = 0
    for _craving_id, trigger, outcome in rows:
        display_trigger = trigger.strip() if trigger else ''
        if not display_trigger or outcome not in recognized_outcomes:
            continue
        normalized_trigger = display_trigger.casefold()
        trigger_labels.setdefault(normalized_trigger, display_trigger)
        trigger_counts[normalized_trigger] = (
            trigger_counts.get(normalized_trigger, 0) + 1
        )
        outcome_counts[outcome] += 1
        resolved_count += 1

    leading_key = (
        max(trigger_counts, key=trigger_counts.get)
        if trigger_counts else None
    )
    leading_count = trigger_counts.get(leading_key, 0)
    available = resolved_count >= 3 and leading_count >= 2
    return {
        'available': available,
        'event_count': len(rows),
        'resolved_count': resolved_count,
        'leading_trigger': trigger_labels[leading_key] if available else None,
        'leading_trigger_count': leading_count if available else None,
        'outcome_counts': outcome_counts,
        'non_nicotine_rate': (
            round(
                (
                    outcome_counts['resisted']
                    + outcome_counts['used_alternative']
                ) / resolved_count * 100,
                1,
            )
            if available else None
        ),
    }

def get_enhanced_insights(user_id: int, days: int = 30):
    """Get comprehensive insights for the user"""
    user = db.session.get(User, user_id)
    if not user:
        return None

    user_timezone = user.timezone
    window_end = datetime.utcnow()
    window_start = window_end - timedelta(days=days)
    df = get_user_logs_df(user_id, user_timezone, days, end_at=window_end)
    previous_df = get_user_logs_df(
        user_id,
        user_timezone,
        days,
        end_at=window_end - timedelta(days=days),
    )
    metadata = _comparison_metadata(df, previous_df, days)
    plan_context = _plan_context(user_id, df, window_end, days)
    craving_pattern = _craving_pattern(user_id, window_start, window_end)
    metadata['data_sufficiency'].update({
        'plan_adherence': plan_context['adherence_available'],
        'craving_pattern': craving_pattern['available'],
    })
    
    if df.empty:
        return {
            'total_pouches': 0,
            'daily_average_mg': 0,
            'peak_day': '--',
            'average_time_between_pouches': '--',
            'total_nicotine': 0,
            'unknown_strength_count': 0,
            'best_day': '--',
            'consistency_score': 0,
            'trend_direction': '--',
            'consumption_by_time_of_day': {},
            'nicotine_by_day_of_week': {},
            'brand_analysis': {},
            'nicotine_by_time_of_day': {},
            'nicotine_by_product': {},
            'strength_coverage': _nicotine_distribution(df)[2],
            'nicotine_trend': [],
            'nicotine_heatmap': [],
            'ai_insights': [],
            'plan_context': plan_context,
            'craving_pattern': craving_pattern,
            **metadata,
        }

    # Basic metrics - convert numpy types to Python native types
    total_pouches = int(df['quantity'].sum())
    known_strengths = df['nicotine_mg'].notna()
    total_nicotine = float(
        sum(
            quantity * strength
            for quantity, strength in zip(
                df.loc[known_strengths, 'quantity'],
                df.loc[known_strengths, 'nicotine_mg'],
            )
        )
    )
    unknown_strength_count = int((~known_strengths).sum())
    daily_average_mg = total_nicotine / days
    
    # Daily event aggregation remains available for event-specific legacy helpers.
    df['date'] = df['user_time'].dt.date
    daily_consumption = df.groupby('date')['quantity'].sum()

    known_nicotine = _with_known_nicotine(df)
    known_nicotine['date'] = known_nicotine['user_time'].dt.date
    daily_nicotine = known_nicotine.groupby('date')['known_nicotine_mg'].sum()
    peak_day = round(float(daily_nicotine.max()), 2) if not daily_nicotine.empty else 0
    best_day = round(float(daily_nicotine.min()), 2) if not daily_nicotine.empty else 0
    
    # Consistency score (inverse of coefficient of variation)
    consistency_score = 0.0
    if len(daily_nicotine) > 1 and daily_nicotine.std() > 0:
        cv = daily_nicotine.std() / daily_nicotine.mean()
        consistency_score = float(max(0, 100 - (cv * 100)))

    # Trend analysis
    trend_direction = calculate_trend_direction(daily_nicotine)
    
    # Time patterns
    consumption_by_time = get_consumption_by_time_of_day_enhanced(df)
    nicotine_by_day_week = get_nicotine_by_day_of_week(df)
    
    # Brand analysis
    brand_analysis = get_brand_analysis(df)
    nicotine_by_time, nicotine_by_product, strength_coverage = _nicotine_distribution(df)
    
    # Consumption trend data for charts
    nicotine_trend = get_nicotine_trend(df)
    
    # Heatmap data
    nicotine_heatmap = get_nicotine_heatmap(df)
    
    # AI insights
    ai_insights = generate_ai_insights(df, daily_consumption, user_timezone)
    
    # Average time between pouches
    avg_time_between = get_average_time_between_pouches_enhanced(df)

    return {
        'total_pouches': total_pouches,
        'daily_average_mg': round(daily_average_mg, 1),
        'peak_day': peak_day,
        'average_time_between_pouches': avg_time_between,
        'total_nicotine': round(total_nicotine, 1),
        'unknown_strength_count': unknown_strength_count,
        'best_day': best_day,
        'consistency_score': round(consistency_score, 1),
        'trend_direction': trend_direction,
        'consumption_by_time_of_day': consumption_by_time,
        'nicotine_by_day_of_week': nicotine_by_day_week,
        'brand_analysis': brand_analysis,
        'nicotine_by_time_of_day': nicotine_by_time,
        'nicotine_by_product': nicotine_by_product,
        'strength_coverage': strength_coverage,
        'nicotine_trend': nicotine_trend,
        'nicotine_heatmap': nicotine_heatmap,
        'ai_insights': ai_insights,
        'plan_context': plan_context,
        'craving_pattern': craving_pattern,
        **metadata,
    }

def get_consumption_by_time_of_day_enhanced(df):
    """Enhanced time of day analysis"""
    if df.empty:
        return {}
    
    df['hour'] = df['user_time'].dt.hour
    
    # Define time of day bins
    bins = [0, 6, 12, 18, 24]
    labels = ['Night (12AM-6AM)', 'Morning (6AM-12PM)', 'Afternoon (12PM-6PM)', 'Evening (6PM-12AM)']
    df['time_of_day'] = pd.cut(df['hour'], bins=bins, labels=labels, right=False)
    
    consumption_by_time = df.groupby('time_of_day', observed=False)['quantity'].sum().to_dict()
    return {str(k): int(v) if pd.notna(v) else 0 for k, v in consumption_by_time.items() if pd.notna(k)}

def _with_known_nicotine(df):
    known = df[df['nicotine_mg'].notna()].copy()
    if known.empty:
        known['known_nicotine_mg'] = pd.Series(dtype=float)
        return known
    known['known_nicotine_mg'] = (
        known['quantity'].astype(float) * known['nicotine_mg'].astype(float)
    )
    return known


def get_nicotine_by_day_of_week(df):
    """Aggregate known nicotine exposure by local weekday."""
    if df.empty:
        return {}

    known = _with_known_nicotine(df)
    known['day_of_week'] = known['user_time'].dt.day_name()
    nicotine_by_day = known.groupby('day_of_week')['known_nicotine_mg'].sum().reindex([
        'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'
    ]).fillna(0).to_dict()

    return {k: round(float(v), 2) if pd.notna(v) else 0 for k, v in nicotine_by_day.items()}

def get_brand_analysis(df):
    """Analyze brand preferences"""
    if df.empty or 'brand' not in df.columns:
        return {}
    
    brand_consumption = df.groupby('brand')['quantity'].sum().sort_values(ascending=False)
    return {str(k): int(v) if pd.notna(v) else 0 for k, v in brand_consumption.head(5).items() if pd.notna(k)}

def get_nicotine_trend(df):
    """Aggregate known nicotine exposure by local date for charts."""
    if df.empty:
        return []

    known = _with_known_nicotine(df)
    known['date'] = known['user_time'].dt.date
    daily_nicotine = known.groupby('date')['known_nicotine_mg'].sum()
    return [
        {
            'date': date.isoformat(),
            'value': round(float(value), 2) if pd.notna(value) else 0,
        }
        for date, value in daily_nicotine.items()
    ]

def get_nicotine_heatmap(df):
    """Aggregate known nicotine exposure by local hour and weekday."""
    if df.empty:
        return []

    known = _with_known_nicotine(df)
    known['hour'] = known['user_time'].dt.hour
    known['day_of_week'] = known['user_time'].dt.day_name()
    heatmap = known.groupby(['day_of_week', 'hour'])['known_nicotine_mg'].sum().reset_index()
    
    days_order = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    heatmap_data = []
    
    for day in days_order:
        day_data = heatmap[heatmap['day_of_week'] == day]
        hourly_data = []
        for hour in range(24):
            value = day_data[day_data['hour'] == hour]['known_nicotine_mg'].sum()
            hourly_data.append(round(float(value), 2) if pd.notna(value) else 0)
        heatmap_data.append({
            'name': day,
            'data': hourly_data
        })
    
    return heatmap_data

def calculate_trend_direction(daily_consumption):
    """Calculate overall trend direction"""
    if len(daily_consumption) < 7:
        return 'Insufficient Data'
    
    # Use linear regression to determine trend
    x = np.arange(len(daily_consumption))
    y = daily_consumption.values
    
    slope = float(np.polyfit(x, y, 1)[0])
    
    if slope > 0.1:
        return '📈 Increasing'
    elif slope < -0.1:
        return '📉 Decreasing'
    else:
        return '➡️ Stable'

def get_average_time_between_pouches_enhanced(df):
    """Enhanced average time calculation"""
    if len(df) < 2:
        return 'Not enough data'

    df_sorted = df.sort_values('user_time')
    df_sorted['time_diff'] = df_sorted['user_time'].diff().dt.total_seconds()
    
    # Remove outliers (gaps > 24 hours)
    valid_diffs = df_sorted['time_diff'][(df_sorted['time_diff'] > 0) & (df_sorted['time_diff'] < 86400)]
    
    if valid_diffs.empty:
        return 'Not enough data'
    
    avg_seconds = float(valid_diffs.mean())
    hours, remainder = divmod(avg_seconds, 3600)
    minutes, _ = divmod(remainder, 60)
    
    return f"{int(hours)}h {int(minutes)}m"

def generate_ai_insights(df, daily_consumption, user_timezone):
    """Generate AI-powered insights and recommendations"""
    insights = []
    
    if df.empty:
        return insights
    
    # Peak time insight
    if not df.empty:
        peak_hour = int(df.groupby(df['user_time'].dt.hour)['quantity'].sum().idxmax())
        insights.append({
            'icon': '⏰',
            'title': 'Peak Consumption Time',
            'description': f'You consume most nicotine around {peak_hour}:00',
            'recommendation': 'Consider planning alternative activities during this time.'
        })
    
    # Weekend vs weekday pattern
    df['is_weekend'] = df['user_time'].dt.dayofweek >= 5
    weekend_avg = float(df[df['is_weekend']]['quantity'].sum()) / max(1, df[df['is_weekend']]['user_time'].dt.date.nunique())
    weekday_avg = float(df[~df['is_weekend']]['quantity'].sum()) / max(1, df[~df['is_weekend']]['user_time'].dt.date.nunique())
    
    if weekday_avg > 0 and weekend_avg > weekday_avg * 1.2:
        insights.append({
            'icon': '📅',
            'title': 'Weekend Pattern',
            'description': f'You consume {((weekend_avg/weekday_avg - 1) * 100):.0f}% more on weekends',
            'recommendation': 'Plan weekend activities to reduce consumption.'
        })
    
    # Consistency insight
    if len(daily_consumption) > 7:
        recent_week = daily_consumption.tail(7)
        previous_week = daily_consumption.tail(14).head(7)
        
        if not recent_week.empty and not previous_week.empty:
            recent_avg = float(recent_week.mean())
            previous_avg = float(previous_week.mean())
            
            if recent_avg < previous_avg * 0.9:
                insights.append({
                    'icon': '📉',
                    'title': 'Positive Trend',
                    'description': f'Your consumption decreased by {((previous_avg - recent_avg) / previous_avg * 100):.0f}% this week',
                    'recommendation': 'Great progress! Keep up the good work.'
                })
            elif recent_avg > previous_avg * 1.1:
                insights.append({
                    'icon': '📈',
                    'title': 'Increased Consumption',
                    'description': f'Your consumption increased by {((recent_avg - previous_avg) / previous_avg * 100):.0f}% this week',
                    'recommendation': 'Consider reviewing your triggers and coping strategies.'
                })
    
    # Brand diversity insight
    if 'brand' in df.columns:
        unique_brands = int(df['brand'].nunique())
        if unique_brands == 1:
            insights.append({
                'icon': '🏷️',
                'title': 'Brand Loyalty',
                'description': 'You consistently use the same brand',
                'recommendation': 'Consider gradually reducing nicotine strength within your preferred brand.'
            })
    
    return insights

# Legacy function for backward compatibility
def get_all_insights(user_id: int):
    """Legacy function - redirects to enhanced insights"""
    return get_enhanced_insights(user_id, 30)
