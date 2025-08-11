"""
Unified Goal Service - Merges traditional goals with flexible/smart goals
"""
from datetime import datetime, date, timedelta
from typing import List, Dict, Optional, Union
from sqlalchemy import and_, or_
from extensions import db
from models.goal import Goal

from models.user import User

class UnifiedGoalService:
    """Service to manage both traditional and flexible goals in a unified way"""
    
    def __init__(self):
        pass
    
    def get_all_user_goals(self, user_id: int, include_inactive: bool = False) -> Dict:
        """Get all goals for a user (both traditional and flexible)"""
        # Get traditional goals
        traditional_query = Goal.query.filter_by(user_id=user_id)
        if not include_inactive:
            traditional_query = traditional_query.filter_by(is_active=True)
        traditional_goals = traditional_query.all()
        
        return {
            'traditional_goals': [goal.to_dict() for goal in traditional_goals],
            'smart_goals': [],
            'total_count': len(traditional_goals)
        }

    
    def create_unified_goal(self, user_id: int, goal_data: Dict) -> Dict:
        """Create a goal using the unified system"""
        goal_type = goal_data.get('goal_type', 'daily_pouches')
        
        return self._create_traditional_goal(user_id, goal_data)

    
    def _create_traditional_goal(self, user_id: int, goal_data: Dict) -> Dict:
        """Create a traditional goal"""
        goal = Goal(
            user_id=user_id,
            goal_type=goal_data.get('goal_type', 'daily_pouches'),
            target_value=int(goal_data.get('target_value', 0)),
            start_date=datetime.strptime(goal_data['start_date'], '%Y-%m-%d').date() if goal_data.get('start_date') else date.today(),
            end_date=datetime.strptime(goal_data['end_date'], '%Y-%m-%d').date() if goal_data.get('end_date') else None,
            enable_notifications=goal_data.get('enable_notifications', True),
            notification_threshold=float(goal_data.get('notification_threshold', 0.8))
        )
        
        db.session.add(goal)
        db.session.commit()
        
        return {
            'success': True,
            'goal_id': goal.id,
            'goal_type': 'traditional',
            'message': 'Traditional goal created successfully'
        }
    

    
    def get_goal_analytics(self, user_id: int) -> Dict:
        """Get comprehensive goal analytics"""
        all_goals = self.get_all_user_goals(user_id, include_inactive=True)
        
        # Calculate overall statistics
        total_goals = all_goals['total_count']
        active_goals = len([g for g in all_goals['traditional_goals'] if g['is_active']])
        
        return {
            'total_goals': total_goals,
            'active_goals': active_goals,
            'traditional_goals_count': len(all_goals['traditional_goals']),
            'smart_goals_count': 0
        }
