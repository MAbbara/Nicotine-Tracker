"""Health Impact model definition.
Tracks health and financial benefits of reduced nicotine consumption.
"""
from datetime import datetime, date
from extensions import db

class HealthImpact(db.Model):
    __tablename__ = 'health_impacts'
    
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Financial tracking
    baseline_daily_cost = db.Column(db.Float, default=0.0)  # Cost per day at baseline consumption
    current_daily_cost = db.Column(db.Float, default=0.0)   # Current cost per day
    total_money_saved = db.Column(db.Float, default=0.0)    # Cumulative savings
    
    # Health milestones tracking
    quit_date = db.Column(db.Date)  # Date when user quit completely (if applicable)
    reduction_start_date = db.Column(db.Date, default=date.today)  # When reduction journey started
    
    # Health improvement flags (automatically calculated)
    circulation_improved = db.Column(db.Boolean, default=False)  # After 2-12 weeks
    taste_smell_improved = db.Column(db.Boolean, default=False)  # After 1-9 months
    lung_function_improved = db.Column(db.Boolean, default=False)  # After 1-12 months
    
    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'baseline_daily_cost': self.baseline_daily_cost,
            'current_daily_cost': self.current_daily_cost,
            'total_money_saved': self.total_money_saved,
            'quit_date': self.quit_date.isoformat() if self.quit_date else None,
            'reduction_start_date': self.reduction_start_date.isoformat() if self.reduction_start_date else None,
            'circulation_improved': self.circulation_improved,
            'taste_smell_improved': self.taste_smell_improved,
            'lung_function_improved': self.lung_function_improved,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }

    def calculate_days_since_reduction_start(self):
        """Calculate days since reduction journey started"""
        if not self.reduction_start_date:
            return 0
        return (date.today() - self.reduction_start_date).days

    def calculate_days_since_quit(self):
        """Calculate days since complete quit (if applicable)"""
        if not self.quit_date:
            return None
        return (date.today() - self.quit_date).days

    def update_health_milestones(self):
        """Update health improvement flags based on time elapsed"""
        days_since_reduction = self.calculate_days_since_reduction_start()
        days_since_quit = self.calculate_days_since_quit()
        
        # Circulation improvement (2-12 weeks after reduction starts)
        if days_since_reduction >= 14:  # 2 weeks
            self.circulation_improved = True
            
        # Taste and smell improvement (1-9 months after quitting completely)
        if days_since_quit and days_since_quit >= 30:  # 1 month
            self.taste_smell_improved = True
            
        # Lung function improvement (1-12 months after quitting completely)
        if days_since_quit and days_since_quit >= 30:  # 1 month
            self.lung_function_improved = True

    def __repr__(self):
        return f'<HealthImpact {self.user_id} - Saved: ${self.total_money_saved:.2f}>'
