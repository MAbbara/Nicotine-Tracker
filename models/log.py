"""Log model definition.
Represents individual nicotine consumption sessions.
"""
from datetime import datetime, date
from extensions import db

class Log(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    log_date = db.Column(db.Date, default=date.today, nullable=False)
    log_time = db.Column(db.Time)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    # Pouch information
    pouch_id = db.Column(db.Integer, db.ForeignKey('pouch.id'), nullable=True)
    custom_brand = db.Column(db.String(80))
    custom_nicotine_mg = db.Column(db.Integer)

    quantity = db.Column(db.Integer, nullable=False, default=1)
    notes = db.Column(db.Text)

    def get_nicotine_content(self) -> int:
        if self.pouch:
            return self.pouch.nicotine_mg
        return self.custom_nicotine_mg or 0

    def get_total_nicotine(self) -> int:
        return self.quantity * self.get_nicotine_content()

    def get_brand_name(self) -> str:
        if self.pouch:
            return self.pouch.brand
        return self.custom_brand or 'Unknown'

    def get_user_date(self, user_timezone: str) -> date:
        """Get the log date in user's timezone."""
        if not user_timezone or not self.log_date or not self.log_time:
            return self.log_date
        
        try:
            from services.timezone_service import convert_utc_to_user_time
            utc_datetime = datetime.combine(self.log_date, self.log_time)
            _, user_date, _ = convert_utc_to_user_time(user_timezone, utc_datetime)
            return user_date
        except Exception:
            return self.log_date
    
    def get_user_time(self, user_timezone: str) -> datetime.time:
        """Get the log time in user's timezone."""
        if not user_timezone or not self.log_date or not self.log_time:
            return self.log_time
        
        try:
            from services.timezone_service import convert_utc_to_user_time
            utc_datetime = datetime.combine(self.log_date, self.log_time)
            _, _, user_time = convert_utc_to_user_time(user_timezone, utc_datetime)
            return user_time
        except Exception:
            return self.log_time

    def to_dict(self) -> dict:
        return {
            'id': self.id,
            'user_id': self.user_id,
            'log_date': self.log_date.isoformat() if self.log_date else None,
            'log_time': self.log_time.isoformat() if self.log_time else None,
            'quantity': self.quantity,
            'notes': self.notes,
            'pouch': self.pouch.to_dict() if self.pouch else None,
            'custom_brand': self.custom_brand,
            'custom_nicotine_mg': self.custom_nicotine_mg,
            'total_nicotine': self.get_total_nicotine(),
            'brand_name': self.get_brand_name(),
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }

    def __repr__(self) -> str:
        return f'<Log {self.user_id} - {self.log_date} - {self.quantity} pouches>'
