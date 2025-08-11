"""Goal Template model definition.
Defines pre-made goal templates for different reduction strategies.
"""
from datetime import datetime
from extensions import db

class GoalTemplate(db.Model):
    __tablename__ = 'goal_templates'
    
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    description = db.Column(db.Text)
    category = db.Column(db.String(50))  # 'gradual_reduction', 'cold_turkey', 'maintenance', etc.
    is_active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Template configuration (JSON string)
    template_config = db.Column(db.Text)  # JSON with goal parameters
    
    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'description': self.description,
            'category': self.category,
            'is_active': self.is_active,
            'template_config': self.template_config,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }

    def get_config(self):
        """Parse template configuration from JSON"""
        if not self.template_config:
            return {}
        try:
            import json
            return json.loads(self.template_config)
        except (json.JSONDecodeError, TypeError):
            return {}

    def set_config(self, config_dict):
        """Set template configuration as JSON"""
        if config_dict:
            import json
            self.template_config = json.dumps(config_dict)
        else:
            self.template_config = None

    def __repr__(self):
        return f'<GoalTemplate {self.name} - {self.category}>'


class FlexibleGoal(db.Model):
    __tablename__ = 'flexible_goals'
    
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    template_id = db.Column(db.Integer, db.ForeignKey('goal_templates.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Goal identification
    name = db.Column(db.String(100), nullable=False)
    goal_type = db.Column(db.String(50), nullable=False)  # 'weekly', 'monthly', 'situational', 'gradual_reduction'
    
    # Flexible parameters
    target_value = db.Column(db.Float, nullable=False)
    current_value = db.Column(db.Float, default=0.0)
    
    # Time-based parameters
    start_date = db.Column(db.Date)
    end_date = db.Column(db.Date)
    frequency = db.Column(db.String(20))  # 'daily', 'weekly', 'monthly'
    
    # Gradual reduction parameters
    initial_target = db.Column(db.Float)  # Starting target for gradual reduction
    reduction_rate = db.Column(db.Float)  # How much to reduce each period
    reduction_frequency = db.Column(db.String(20))  # 'weekly', 'biweekly', 'monthly'
    
    # Status
    is_active = db.Column(db.Boolean, default=True)
    is_completed = db.Column(db.Boolean, default=False)
    
    # Progress tracking
    current_streak = db.Column(db.Integer, default=0)
    best_streak = db.Column(db.Integer, default=0)
    success_count = db.Column(db.Integer, default=0)
    attempt_count = db.Column(db.Integer, default=0)
    
    # Relationships
    template = db.relationship('GoalTemplate', backref='flexible_goals')

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'template_id': self.template_id,
            'name': self.name,
            'goal_type': self.goal_type,
            'target_value': self.target_value,
            'current_value': self.current_value,
            'start_date': self.start_date.isoformat() if self.start_date else None,
            'end_date': self.end_date.isoformat() if self.end_date else None,
            'frequency': self.frequency,
            'initial_target': self.initial_target,
            'reduction_rate': self.reduction_rate,
            'reduction_frequency': self.reduction_frequency,
            'is_active': self.is_active,
            'is_completed': self.is_completed,
            'current_streak': self.current_streak,
            'best_streak': self.best_streak,
            'success_count': self.success_count,
            'attempt_count': self.attempt_count,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }

    def calculate_success_rate(self):
        """Calculate success rate as percentage"""
        if self.attempt_count == 0:
            return 0.0
        return (self.success_count / self.attempt_count) * 100

    def update_target_for_gradual_reduction(self):
        """Update target value for gradual reduction goals"""
        if self.goal_type == 'gradual_reduction' and self.reduction_rate:
            # Calculate how many reduction periods have passed
            from datetime import date, timedelta
            if not self.start_date:
                return
                
            days_elapsed = (date.today() - self.start_date).days
            
            if self.reduction_frequency == 'weekly':
                periods_elapsed = days_elapsed // 7
            elif self.reduction_frequency == 'biweekly':
                periods_elapsed = days_elapsed // 14
            elif self.reduction_frequency == 'monthly':
                periods_elapsed = days_elapsed // 30
            else:
                periods_elapsed = 0
            
            if periods_elapsed > 0:
                new_target = max(0, self.initial_target - (self.reduction_rate * periods_elapsed))
                self.target_value = new_target

    def __repr__(self):
        return f'<FlexibleGoal {self.user_id} - {self.name} - {self.goal_type}>'
