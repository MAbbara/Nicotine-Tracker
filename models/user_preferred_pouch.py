"""Ranked exact-pouch preferences for the coaching shell."""

from datetime import datetime

from extensions import db


class UserPreferredPouch(db.Model):
    __tablename__ = 'user_preferred_pouch'
    __table_args__ = (
        db.UniqueConstraint('user_id', 'pouch_id', name='uq_preferred_user_pouch'),
        db.UniqueConstraint('user_id', 'rank', name='uq_preferred_user_rank'),
        db.CheckConstraint('rank >= 0', name='ck_preferred_rank_nonnegative'),
    )

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(
        db.Integer, db.ForeignKey('user.id', ondelete='CASCADE'), nullable=False,
    )
    pouch_id = db.Column(
        db.Integer, db.ForeignKey('pouch.id', ondelete='CASCADE'), nullable=False,
    )
    rank = db.Column(db.Integer, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    user = db.relationship(
        'User',
        backref=db.backref(
            'preferred_pouch_links',
            cascade='all, delete-orphan',
            order_by='UserPreferredPouch.rank',
        ),
    )
    pouch = db.relationship('Pouch')

    def __repr__(self):
        return f'<UserPreferredPouch user={self.user_id} pouch={self.pouch_id} rank={self.rank}>'
