"""
Health Impact Service
"""
from models.health_impact import HealthImpact
from extensions import db

class HealthImpactService:
    def __init__(self):
        pass

    def add_health_impact(self, user_id, data):
        impact = HealthImpact(
            user_id=user_id,
            blood_pressure=data.get('blood_pressure'),
            heart_rate=data.get('heart_rate'),
            gum_health=data.get('gum_health'),
            anxiety_level=data.get('anxiety_level'),
            focus_level=data.get('focus_level'),
            mood=data.get('mood'),
            notes=data.get('notes')
        )
        db.session.add(impact)
        db.session.commit()
        return impact

    def get_health_impacts(self, user_id):
        return HealthImpact.query.filter_by(user_id=user_id).order_by(HealthImpact.created_at.desc()).all()

    def get_health_impact(self, impact_id):
        return HealthImpact.query.get(impact_id)
