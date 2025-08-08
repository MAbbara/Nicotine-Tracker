"""User Settings model definition.
Handles user interface and display preferences.
"""
from datetime import datetime
from extensions import db

class UserSettings(db.Model):
    __tablename__ = 'user_settings'
    
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False, unique=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    
    # UI Display preferences
    default_view = db.Column(db.String(20), default='dashboard', nullable=False)  # dashboard, logs, goals
    chart_theme = db.Column(db.String(20), default='light', nullable=False)  # light, dark, auto
    logs_per_page = db.Column(db.Integer, default=20, nullable=False)
    date_format = db.Column(db.String(20), default='YYYY-MM-DD', nullable=False)
    time_format = db.Column(db.String(10), default='24h', nullable=False)  # 24h, 12h
    
    # Dashboard preferences
    show_weekly_summary = db.Column(db.Boolean, default=True, nullable=False)
    show_monthly_summary = db.Column(db.Boolean, default=True, nullable=False)
    show_goal_progress = db.Column(db.Boolean, default=True, nullable=False)
    show_recent_logs = db.Column(db.Boolean, default=True, nullable=False)
    
    # Chart preferences
    default_chart_period = db.Column(db.String(20), default='week', nullable=False)  # day, week, month, year
    chart_animation = db.Column(db.Boolean, default=True, nullable=False)
    show_trend_lines = db.Column(db.Boolean, default=True, nullable=False)
    
    # Data display preferences
    show_nicotine_content = db.Column(db.Boolean, default=True, nullable=False)
    show_brand_info = db.Column(db.Boolean, default=True, nullable=False)
    compact_view = db.Column(db.Boolean, default=False, nullable=False)
    
    # Privacy preferences
    hide_sensitive_data = db.Column(db.Boolean, default=False, nullable=False)
    anonymous_mode = db.Column(db.Boolean, default=False, nullable=False)
    
    # Relationships
    user = db.relationship('User', backref=db.backref('settings', uselist=False, cascade='all, delete-orphan'))
    
    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'default_view': self.default_view,
            'chart_theme': self.chart_theme,
            'logs_per_page': self.logs_per_page,
            'date_format': self.date_format,
            'time_format': self.time_format,
            'show_weekly_summary': self.show_weekly_summary,
            'show_monthly_summary': self.show_monthly_summary,
            'show_goal_progress': self.show_goal_progress,
            'show_recent_logs': self.show_recent_logs,
            'default_chart_period': self.default_chart_period,
            'chart_animation': self.chart_animation,
            'show_trend_lines': self.show_trend_lines,
            'show_nicotine_content': self.show_nicotine_content,
            'show_brand_info': self.show_brand_info,
            'compact_view': self.compact_view,
            'hide_sensitive_data': self.hide_sensitive_data,
            'anonymous_mode': self.anonymous_mode,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }
    
    def __repr__(self):
        return f'<UserSettings {self.user_id}>'
