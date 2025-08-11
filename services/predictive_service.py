import pandas as pd
from services.insights_service import get_user_logs_df

def predict_next_craving(user_id: int, user_timezone: str):
    """
    Predicts the time of the next craving based on historical log data.
    
    This is a simple prediction model and can be replaced with a more
    sophisticated machine learning model in the future.
    """
    df = get_user_logs_df(user_id, user_timezone)
    if len(df) < 2:
        return None

    # Calculate the average time difference between logs
    avg_time_diff = df['user_time'].diff().mean()

    if pd.isna(avg_time_diff):
        return None

    # Predict the next craving time by adding the average difference to the last log time
    last_log_time = df['user_time'].iloc[-1]
    predicted_time = last_log_time + avg_time_diff
    
    return predicted_time.strftime('%Y-%m-%d %H:%M:%S')
