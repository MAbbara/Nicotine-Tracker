"""Transactional owner of resumable onboarding drafts.

One draft row per user, one commit per mutation. Failures roll back and
leave any prior draft byte-for-byte intact. Pouch ownership checks treat
missing and foreign pouches identically so the API never leaks which
condition occurred.
"""
from extensions import db
from models import OnboardingDraft, Pouch, User
from services.api_errors import ApiValidationError

_POUCH_UNAVAILABLE_MESSAGE = 'One or more selected pouches is not available.'
# SQLAlchemy Integer maps to signed INTEGER on every supported database;
# MySQL is the narrowest supported representation.
_PORTABLE_SQL_INTEGER_MAX = 2_147_483_647


class OnboardingDraftService:
    def get(self, user_id):
        """Return the user's draft, or None."""
        return OnboardingDraft.query.filter_by(user_id=user_id).one_or_none()

    def save(self, user_id, current_step, structured_payload):
        """Create or update the user's single draft in one commit.

        Locks the user row first, then any existing draft, so concurrent
        saves serialize instead of racing the unique constraint. Every
        preferred pouch id must be a global default pouch or owned by this
        user; missing and foreign ids raise the same field error.
        """
        try:
            # Lock the user row to serialize concurrent draft creation.
            user = (
                db.session.query(User)
                .filter_by(id=user_id)
                .with_for_update()
                .one_or_none()
            )
            if user is None:
                raise ApiValidationError({
                    'structured_payload': ['Your account is not available.'],
                })

            draft = (
                OnboardingDraft.query
                .filter_by(user_id=user_id)
                .with_for_update()
                .one_or_none()
            )

            self._validate_pouch_ownership(
                user_id,
                structured_payload.get('preferred_pouch_ids') or [],
            )

            if draft is None:
                draft = OnboardingDraft(user_id=user_id)
                db.session.add(draft)
            draft.current_step = current_step
            draft.structured_payload = dict(structured_payload)
            db.session.commit()
        except Exception:
            db.session.rollback()
            raise
        return draft

    def delete(self, user_id):
        """Delete the user's draft if present. Idempotent, one commit."""
        draft = OnboardingDraft.query.filter_by(user_id=user_id).one_or_none()
        if draft is not None:
            db.session.delete(draft)
        try:
            db.session.commit()
        except Exception:
            db.session.rollback()
            raise
        return draft is not None

    @staticmethod
    def _validate_pouch_ownership(user_id, pouch_ids):
        if not pouch_ids:
            return
        if any(pouch_id > _PORTABLE_SQL_INTEGER_MAX for pouch_id in pouch_ids):
            raise ApiValidationError({
                'structured_payload.preferred_pouch_ids': [
                    _POUCH_UNAVAILABLE_MESSAGE],
            })
        accessible = {
            row.id
            for row in Pouch.query.filter(
                Pouch.id.in_(pouch_ids),
                db.or_(Pouch.is_default.is_(True),
                       Pouch.created_by == user_id),
            ).all()
        }
        if any(pouch_id not in accessible for pouch_id in pouch_ids):
            raise ApiValidationError({
                'structured_payload.preferred_pouch_ids': [
                    _POUCH_UNAVAILABLE_MESSAGE],
            })


def serialize_draft(draft):
    """Canonical wire shape; never exposes user_id."""
    if draft is None:
        return None
    created = draft.created_at
    updated = draft.updated_at
    return {
        'id': draft.id,
        'current_step': draft.current_step,
        'structured_payload': draft.structured_payload,
        'created_at': created.isoformat() + '+00:00' if created else None,
        'updated_at': updated.isoformat() + '+00:00' if updated else None,
    }
