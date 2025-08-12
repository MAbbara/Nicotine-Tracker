"""Goal-related service functions.

These helpers encapsulate operations for creating and managing goals.
"""
from datetime import date
from typing import Dict, Iterable, Optional


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


def get_active_goals(user_id: int) -> Iterable[Goal]:
    """Retrieve all active goals for a given user."""
    return Goal.query.filter_by(user_id=user_id, is_active=True).all()


def get_all_goals(user_id: int) -> Iterable[Goal]:
    """Retrieve all goals for a given user, including inactive ones."""
    return Goal.query.filter_by(user_id=user_id).all()


def get_goal_analytics(user_id: int) -> Dict:
    """Get comprehensive goal analytics."""
    all_goals_list = get_all_goals(user_id)
    active_goals_list = [g for g in all_goals_list if g.is_active]

    return {
        "total_goals": len(all_goals_list),
        "active_goals": len(active_goals_list),
    }


def deactivate_goal(goal_id: int) -> Optional[Goal]:

    """Deactivate a specific goal."""
    goal = db.session.get(Goal, goal_id)
    if goal:
        goal.is_active = False
        db.session.commit()
    return goal
