"""Log model definition.
Represents individual nicotine consumption sessions.
"""
from datetime import datetime, date
from extensions import db

class Log(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    log_date = db.Column(db.Date, default=date.today, nullable=False)  # Keep for backward compatibility, but deprecated
    log_time = db.Column(db.DateTime, nullable=False)  # Now stores complete UTC datetime
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    # Pouch information
    pouch_id = db.Column(db.Integer, db.ForeignKey('pouch.id'), nullable=True)
    custom_brand = db.Column(db.String(80))
    custom_nicotine_mg = db.Column(db.Integer)

    quantity = db.Column(db.Integer, nullable=False, default=1)
    notes = db.Column(db.Text)

    @property
    def log_datetime_utc(self) -> datetime:
        """Get the UTC datetime for this log entry."""
        return self.log_time

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
        if not user_timezone or not self.log_time:
            return self.log_time.date() if self.log_time else date.today()
        
        try:
            from services.timezone_service import convert_utc_to_user_time
            _, user_date, _ = convert_utc_to_user_time(user_timezone, self.log_time)
            return user_date
        except Exception:
            return self.log_time.date() if self.log_time else date.today()
    
    def get_user_time(self, user_timezone: str) -> datetime.time:
        """Get the log time in user's timezone."""
        if not user_timezone or not self.log_time:
            return self.log_time.time() if self.log_time else datetime.now().time()
        
        try:
            from services.timezone_service import convert_utc_to_user_time
            _, _, user_time = convert_utc_to_user_time(user_timezone, self.log_time)
            return user_time
        except Exception:
            return self.log_time.time() if self.log_time else datetime.now().time()

    def get_user_datetime(self, user_timezone: str) -> datetime:
        """Get the complete datetime in user's timezone."""
        if not user_timezone or not self.log_time:
            return self.log_time if self.log_time else datetime.now()
        
        try:
            from services.timezone_service import convert_utc_to_user_time
            user_datetime, _, _ = convert_utc_to_user_time(user_timezone, self.log_time)
            return user_datetime
        except Exception:
            return self.log_time if self.log_time else datetime.now()

    def to_dict(self, user_timezone: str = None) -> dict:
        """Convert to dictionary, optionally converting times to user timezone."""
        if user_timezone:
            user_datetime = self.get_user_datetime(user_timezone)
            log_date = user_datetime.date()
            log_time = user_datetime.time()
        else:
            log_date = self.log_time.date() if self.log_time else None
            log_time = self.log_time.time() if self.log_time else None
        
        return {
            'id': self.id,
            'user_id': self.user_id,
            'log_date': log_date.isoformat() if log_date else None,
            'log_time': log_time.isoformat() if log_time else None,
            'log_datetime_utc': self.log_time.isoformat() if self.log_time else None,
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
        log_date = self.log_time.date() if self.log_time else 'Unknown'
        return f'<Log {self.user_id} - {log_date} - {self.quantity} pouches>'
