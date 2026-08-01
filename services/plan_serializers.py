"""Stable wire serializers for the initial-plan API."""

from datetime import date, datetime, timezone
from decimal import Decimal, ROUND_HALF_UP

from models import PlanDay, PlanRevision, PlanStatusEvent
from services.plan_schedule import GeneratedPlanPreview, PlanGenerationInput


_CENT = Decimal('0.01')


def _decimal(value):
    if value is None:
        return None
    return format(
        Decimal(value).quantize(_CENT, rounding=ROUND_HALF_UP), '.2f'
    )


def _timestamp(value):
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    else:
        value = value.astimezone(timezone.utc)
    return value.isoformat()


def _canonical_json(value):
    if isinstance(value, Decimal):
        return _decimal(value)
    if isinstance(value, datetime):
        return _timestamp(value)
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, dict):
        return {key: _canonical_json(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_canonical_json(item) for item in value]
    return value


def _stage_payload(stage):
    return {
        'start_date': stage.start_date.isoformat(),
        'end_date': stage.end_date.isoformat(),
        'target_pouches': stage.target_pouches,
        'nicotine_ceiling_mg': _decimal(stage.nicotine_ceiling_mg),
    }


def _day_payload(day):
    return {
        'local_date': day.local_date.isoformat(),
        'target_pouches': day.target_pouches,
        'nicotine_ceiling_mg': _decimal(day.nicotine_ceiling_mg),
    }


def serialize_initial_preview(
    generation_input: PlanGenerationInput,
    baseline_source: str,
    preview: GeneratedPlanPreview,
):
    """Return the exact preview response body, including derived fields."""
    explicit_stages = (
        None if generation_input.stage_targets is None
        else [_stage_payload(stage) for stage in preview.normalized_stages]
    )
    normalized_input = {
        'mode': generation_input.mode,
        'baseline_source': baseline_source,
        'baseline_pouches': _decimal(generation_input.baseline_pouches),
        'baseline_mg': _decimal(generation_input.baseline_mg),
        'baseline_mg_per_pouch': _decimal(
            generation_input.baseline_mg_per_pouch
        ),
        'pace': generation_input.pace,
        'start_date': generation_input.start_date.isoformat(),
        'target_date': preview.days[-1].local_date.isoformat(),
        'duration_days': len(preview.days),
        'end_target_pouches': generation_input.end_target_pouches,
        'stage_targets': explicit_stages,
    }
    return {
        'preview_digest': preview.digest,
        'normalized_input': normalized_input,
        'stages': [_stage_payload(stage) for stage in preview.normalized_stages],
        'days': [_day_payload(day) for day in preview.days],
    }


def serialize_revision_preview(effective_date, preview):
    return {
        'preview_digest': preview.digest,
        'effective_date': effective_date.isoformat(),
        'stages': [_stage_payload(stage) for stage in preview.normalized_stages],
        'days': [_day_payload(day) for day in preview.days],
    }


def serialize_resume_preview(resume_date, preview):
    return {
        'preview_digest': preview.digest,
        'resume_date': resume_date.isoformat(),
        'stages': [_stage_payload(stage) for stage in preview.normalized_stages],
        'days': [_day_payload(day) for day in preview.days],
    }


def serialize_plan(plan):
    """Serialize a persisted plan and all owned child collections."""
    days = PlanDay.query.filter_by(plan_id=plan.id).order_by(
        PlanDay.local_date.asc(), PlanDay.id.asc()
    ).all()
    revisions = PlanRevision.query.filter_by(plan_id=plan.id).order_by(
        PlanRevision.created_at.asc(), PlanRevision.id.asc()
    ).all()
    events = PlanStatusEvent.query.filter_by(plan_id=plan.id).order_by(
        PlanStatusEvent.effective_at_utc.asc(),
        PlanStatusEvent.id.asc(),
    ).all()
    return {
        'id': plan.id,
        'mode': plan.mode,
        'status': plan.status,
        'start_date': plan.start_date.isoformat() if plan.start_date else None,
        'target_date': plan.target_date.isoformat() if plan.target_date else None,
        'baseline_source': plan.baseline_source,
        'baseline_pouches': _decimal(plan.baseline_pouches),
        'baseline_mg': _decimal(plan.baseline_mg),
        'baseline_mg_per_pouch': _decimal(plan.baseline_mg_per_pouch),
        'pace': plan.pace,
        'end_target_pouches': plan.end_target_pouches,
        'active_revision_id': plan.active_revision_id,
        'created_at': _timestamp(plan.created_at),
        'updated_at': _timestamp(plan.updated_at),
        'days': [
            {
                'id': row.id,
                'revision_id': row.revision_id,
                'local_date': row.local_date.isoformat(),
                'target_pouches': row.target_pouches,
                'nicotine_ceiling_mg': _decimal(row.nicotine_ceiling_mg),
                'created_at': _timestamp(row.created_at),
            }
            for row in days
        ],
        'revisions': [
            {
                'id': row.id,
                'effective_date': row.effective_date.isoformat(),
                'pace': row.pace,
                'target_date': (
                    row.target_date.isoformat() if row.target_date else None
                ),
                'end_target_pouches': row.end_target_pouches,
                'generation_inputs': _canonical_json(row.generation_inputs),
                'preview_digest': row.preview_digest,
                'reason': row.reason,
                'note': row.note,
                'created_at': _timestamp(row.created_at),
            }
            for row in revisions
        ],
        'status_events': [
            {
                'id': row.id,
                'status': row.status,
                'effective_at_utc': _timestamp(row.effective_at_utc),
                'local_date': row.local_date.isoformat(),
                'reason': row.reason,
                'created_at': _timestamp(row.created_at),
            }
            for row in events
        ],
    }
