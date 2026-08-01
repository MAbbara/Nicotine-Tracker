"""Log model definition.
Represents individual nicotine consumption sessions.
"""
from datetime import datetime, date
from decimal import Decimal
from typing import Optional

from extensions import db

class Log(db.Model):
    __table_args__ = (
        db.UniqueConstraint(
            'user_id', 'client_event_id', name='uq_log_user_client_event_id'
        ),
    )

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    client_event_id = db.Column(db.String(64), nullable=True)
    log_date = db.Column(db.Date, default=date.today, nullable=False)  # Keep for backward compatibility, but deprecated
    log_time = db.Column(db.DateTime, nullable=False)  # Now stores complete UTC datetime
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    # Pouch information
    pouch_id = db.Column(db.Integer, db.ForeignKey('pouch.id', ondelete='SET NULL'), nullable=True)
    custom_brand = db.Column(db.String(80))
    custom_nicotine_mg = db.Column(db.Numeric(8, 2))

    # Immutable product history: captured at log creation so catalog
    # edits/deletes never rewrite the past. NULL means unknown (never zero).
    product_brand_snapshot = db.Column(db.String(80))
    nicotine_mg_snapshot = db.Column(db.Numeric(8, 2))

    quantity = db.Column(db.Integer, nullable=False, default=1)
    notes = db.Column(db.Text)

    @property
    def log_datetime_utc(self) -> datetime:
        """Get the UTC datetime for this log entry."""
        return self.log_time

    def get_nicotine_content(self) -> Optional[Decimal]:
        """Nicotine content per pouch in mg, or None when unknown.

        Prefers the immutable snapshot; falls back to the referenced pouch and
        then to the custom value for rows predating snapshots. Unknown is
        None, which stays distinguishable from a real zero.
        """
        if self.nicotine_mg_snapshot is not None:
            return self.nicotine_mg_snapshot
        if self.pouch is not None and self.pouch.nicotine_mg is not None:
            return Decimal(str(self.pouch.nicotine_mg))
        if self.custom_nicotine_mg is not None:
            return self.custom_nicotine_mg
        return None

    def get_total_nicotine(self) -> Optional[Decimal]:
        """Total nicotine for this entry with decimal precision preserved."""
        content = self.get_nicotine_content()
        if content is None:
            return None
        return Decimal(self.quantity) * content

    def get_brand_name(self) -> Optional[str]:
        """Brand name, preferring the snapshot, or ``None`` if unknown."""
        if self.product_brand_snapshot:
            return self.product_brand_snapshot
        if self.pouch:
            return self.pouch.brand
        return self.custom_brand or None

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
        
        total_nicotine = self.get_total_nicotine()
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
            'custom_nicotine_mg': float(self.custom_nicotine_mg) if self.custom_nicotine_mg is not None else None,
            'total_nicotine': float(total_nicotine) if total_nicotine is not None else None,
            'brand_name': self.get_brand_name(),
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }

    def __repr__(self) -> str:
        log_date = self.log_time.date() if self.log_time else 'Unknown'
        return f'<Log {self.user_id} - {log_date} - {self.quantity} pouches>'
