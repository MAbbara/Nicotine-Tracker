"""Goal-related service functions.

These helpers encapsulate operations for creating and managing goals.
"""
from datetime import date

from extensions import db

# Import the Goal model from the models package aggregator
from models import Goal

def create_goal(user_id: int,
                goal_type: str,
                target_value: int,
                start_date: date = None,
                end_date: date = None,
                enable_notifications: bool = True,
                notification_threshold: float = 0.8) -> Goal:
    """Create and persist a goal for the user."""
    goal = Goal(
        user_id=user_id,
        goal_type=goal_type,
        target_value=target_value,
        start_date=start_date or date.today(),
        end_date=end_date,
        enable_notifications=enable_notifications,
        notification_threshold=notification_threshold
    )
    db.session.add(goal)
    db.session.commit()
    return goal
