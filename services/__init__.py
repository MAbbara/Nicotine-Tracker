"""Business logic service layer.

This package groups higher-level operations that coordinate multiple models or
perform complex queries. Keeping business logic out of route handlers makes
your codebase easier to test and maintain.
"""

from services.user_service import (
    create_user, 
    get_user_daily_intake, 
    get_user_current_time_info,
    convert_user_datetime_to_timezone,
    format_user_time_for_display,
    get_user_date_boundaries_utc
)  # noqa: F401
from services.log_service import add_log_entry, add_bulk_logs  # noqa: F401
from services.goal_service import create_goal  # noqa: F401
from services.craving_service import (
    create_craving,
    get_comprehensive_craving_analytics
)  # noqa: F401
from services.flexible_goal_service import (
    create_flexible_goal,
    get_goal_recommendations
)  # noqa: F401
from services.predictive_service import (
    predict_craving_risk,
    get_risk_alerts,
    analyze_user_patterns
)
from services.unified_goal_service import UnifiedGoalService

__all__ = [
    "create_user", 
    "get_user_daily_intake", 
    "get_user_current_time_info",
    "convert_user_datetime_to_timezone",
    "format_user_time_for_display",
    "get_user_date_boundaries_utc",
    "add_log_entry", 
    "add_bulk_logs", 
    "create_goal",
    "create_craving",
    "get_comprehensive_craving_analytics",
    "create_flexible_goal",
    "get_goal_recommendations",
    "predict_craving_risk",
    "get_risk_alerts",
    "analyze_user_patterns",
    "UnifiedGoalService",
]
