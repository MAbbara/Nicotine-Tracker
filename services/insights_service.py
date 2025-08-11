import pandas as pd
from sqlalchemy import func
from extensions import db
from models import Log, User
from services.timezone_service import convert_utc_to_user_time

def get_user_logs_df(user_id: int, user_timezone: str):
    logs = db.session.query(
        Log.log_time,
        Log.quantity
    ).filter_by(user_id=user_id).order_by(Log.log_time).all()

    if not logs:
        return pd.DataFrame()

    df = pd.DataFrame(logs, columns=['utc_time', 'quantity'])
    df['user_time'] = df['utc_time'].apply(lambda x: convert_utc_to_user_time(user_timezone, x)[0])
    
    return df

def get_consumption_by_time_of_day(user_id: int, user_timezone: str):
    df = get_user_logs_df(user_id, user_timezone)
    if df.empty:
        return {}
    
    df['hour'] = df['user_time'].dt.hour
    
    # Define time of day bins
    bins = [0, 6, 12, 18, 24]
    labels = ['Night', 'Morning', 'Afternoon', 'Evening']
    df['time_of_day'] = pd.cut(df['hour'], bins=bins, labels=labels, right=False)
    
    # Sum consumption for each time of day
    consumption_by_time = df.groupby('time_of_day')['quantity'].sum().to_dict()

    return consumption_by_time

def get_consumption_by_day_of_week(user_id: int, user_timezone: str):
    df = get_user_logs_df(user_id, user_timezone)
    if df.empty:
        return {}

    df['day_of_week'] = df['user_time'].dt.day_name()
    consumption_by_day = df.groupby('day_of_week')['quantity'].sum().reindex([
        'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'
    ]).fillna(0).to_dict()

    return consumption_by_day

def get_average_time_between_pouches(user_id: int, user_timezone: str):
    df = get_user_logs_df(user_id, user_timezone)
    if len(df) < 2:
        return None

    df['time_diff'] = df['user_time'].diff().dt.total_seconds()
    
    # Calculate the weighted average of time differences
    # The time difference is weighted by the quantity of the next log
    weighted_avg_diff = (df['time_diff'] * df['quantity'].shift(-1)).sum() / (df['quantity'].sum() - df['quantity'].iloc[0])
    
    if pd.isna(weighted_avg_diff):
        return None

    # Format into a human-readable string
    hours, remainder = divmod(weighted_avg_diff, 3600)
    minutes, _ = divmod(remainder, 60)
    
    return f"{int(hours)}h {int(minutes)}m"

def get_all_insights(user_id: int):
    user = User.query.get(user_id)
    if not user:
        return None
    
    user_timezone = user.timezone
    
    insights = {

        'consumption_by_time_of_day': get_consumption_by_time_of_day(user_id, user_timezone),
        'consumption_by_day_of_week': get_consumption_by_day_of_week(user_id, user_timezone),
        'average_time_between_pouches': get_average_time_between_pouches(user_id, user_timezone)
    }
    
    return insights
