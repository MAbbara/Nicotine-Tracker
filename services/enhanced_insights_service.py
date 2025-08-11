import pandas as pd
from sqlalchemy import func, and_
from datetime import datetime, date, timedelta
from extensions import db
from models import Log, User, Pouch
from services.timezone_service import convert_utc_to_user_time
import numpy as np

def get_user_logs_df(user_id: int, user_timezone: str, days: int = 30):
    """Get user logs as DataFrame with timezone conversion"""
    cutoff_date = datetime.utcnow() - timedelta(days=days)
    
    logs = db.session.query(
        Log.log_time,
        Log.quantity,
        Log.pouch_id,
        Log.custom_brand,
        Log.custom_nicotine_mg
    ).filter(
        and_(Log.user_id == user_id, Log.log_time >= cutoff_date)
    ).order_by(Log.log_time).all()

    if not logs:
        return pd.DataFrame()

    df = pd.DataFrame(logs, columns=['utc_time', 'quantity', 'pouch_id', 'custom_brand', 'custom_nicotine_mg'])
    df['user_time'] = df['utc_time'].apply(lambda x: convert_utc_to_user_time(user_timezone, x)[0])
    
    # Add pouch information
    pouch_info = {}
    for log in logs:
        if log.pouch_id and log.pouch_id not in pouch_info:
            pouch = db.session.get(Pouch, log.pouch_id)
            if pouch:
                pouch_info[log.pouch_id] = {'brand': pouch.brand, 'nicotine_mg': pouch.nicotine_mg}
    
    df['brand'] = df.apply(lambda row: 
        pouch_info.get(row['pouch_id'], {}).get('brand', row['custom_brand']) if row['pouch_id'] 
        else row['custom_brand'], axis=1)
    df['nicotine_mg'] = df.apply(lambda row: 
        pouch_info.get(row['pouch_id'], {}).get('nicotine_mg', row['custom_nicotine_mg']) if row['pouch_id'] 
        else row['custom_nicotine_mg'], axis=1)
    
    return df

def get_enhanced_insights(user_id: int, days: int = 30):
    """Get comprehensive insights for the user"""
    user = db.session.get(User, user_id)
    if not user:
        return None

    user_timezone = user.timezone
    df = get_user_logs_df(user_id, user_timezone, days)
    
    if df.empty:
        return {
            'total_pouches': 0,
            'daily_average': 0,
            'peak_day': '--',
            'average_time_between_pouches': '--',
            'total_nicotine': 0,
            'best_day': '--',
            'consistency_score': 0,
            'trend_direction': '--',
            'consumption_by_time_of_day': {},
            'consumption_by_day_of_week': {},
            'brand_analysis': {},
            'consumption_trend': [],
            'heatmap_data': [],
            'ai_insights': []
        }

    # Basic metrics - convert numpy types to Python native types
    total_pouches = int(df['quantity'].sum())
    daily_average = float(total_pouches / days)
    total_nicotine = float((df['quantity'] * df['nicotine_mg'].fillna(0)).sum())
    
    # Daily aggregation
    df['date'] = df['user_time'].dt.date
    daily_consumption = df.groupby('date')['quantity'].sum()
    
    peak_day = int(daily_consumption.max()) if not daily_consumption.empty else 0
    best_day = int(daily_consumption.min()) if not daily_consumption.empty else 0
    
    # Consistency score (inverse of coefficient of variation)
    consistency_score = 0.0
    if len(daily_consumption) > 1 and daily_consumption.std() > 0:
        cv = daily_consumption.std() / daily_consumption.mean()
        consistency_score = float(max(0, 100 - (cv * 100)))

    # Trend analysis
    trend_direction = calculate_trend_direction(daily_consumption)
    
    # Time patterns
    consumption_by_time = get_consumption_by_time_of_day_enhanced(df)
    consumption_by_day_week = get_consumption_by_day_of_week_enhanced(df)
    
    # Brand analysis
    brand_analysis = get_brand_analysis(df)
    
    # Consumption trend data for charts
    consumption_trend = get_consumption_trend(daily_consumption)
    
    # Heatmap data
    heatmap_data = get_consumption_heatmap(df)
    
    # AI insights
    ai_insights = generate_ai_insights(df, daily_consumption, user_timezone)
    
    # Average time between pouches
    avg_time_between = get_average_time_between_pouches_enhanced(df)

    return {
        'total_pouches': total_pouches,
        'daily_average': round(daily_average, 1),
        'peak_day': peak_day,
        'average_time_between_pouches': avg_time_between,
        'total_nicotine': round(total_nicotine, 1),
        'best_day': best_day,
        'consistency_score': round(consistency_score, 1),
        'trend_direction': trend_direction,
        'consumption_by_time_of_day': consumption_by_time,
        'consumption_by_day_of_week': consumption_by_day_week,
        'brand_analysis': brand_analysis,
        'consumption_trend': consumption_trend,
        'heatmap_data': heatmap_data,
        'ai_insights': ai_insights
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

def get_consumption_by_day_of_week_enhanced(df):
    """Enhanced day of week analysis"""
    if df.empty:
        return {}

    df['day_of_week'] = df['user_time'].dt.day_name()
    consumption_by_day = df.groupby('day_of_week')['quantity'].sum().reindex([
        'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'
    ]).fillna(0).to_dict()

    return {k: int(v) if pd.notna(v) else 0 for k, v in consumption_by_day.items()}

def get_brand_analysis(df):
    """Analyze brand preferences"""
    if df.empty or 'brand' not in df.columns:
        return {}
    
    brand_consumption = df.groupby('brand')['quantity'].sum().sort_values(ascending=False)
    return {str(k): int(v) if pd.notna(v) else 0 for k, v in brand_consumption.head(5).items() if pd.notna(k)}

def get_consumption_trend(daily_consumption):
    """Get consumption trend data for charts"""
    if daily_consumption.empty:
        return []
    
    trend_data = []
    for date, value in daily_consumption.items():
        trend_data.append({
            'date': date.isoformat(),
            'value': int(value) if pd.notna(value) else 0
        })
    
    return trend_data

def get_consumption_heatmap(df):
    """Generate heatmap data (hour vs day of week)"""
    if df.empty:
        return []
    
    df['hour'] = df['user_time'].dt.hour
    df['day_of_week'] = df['user_time'].dt.day_name()
    
    heatmap = df.groupby(['day_of_week', 'hour'])['quantity'].sum().reset_index()
    
    days_order = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    heatmap_data = []
    
    for day in days_order:
        day_data = heatmap[heatmap['day_of_week'] == day]
        hourly_data = []
        for hour in range(24):
            value = day_data[day_data['hour'] == hour]['quantity'].sum()
            hourly_data.append(int(value) if pd.notna(value) else 0)
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
    
    if weekend_avg > weekday_avg * 1.2:
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
