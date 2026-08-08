"""Journey destinations, including plan history and plan onboarding."""

from datetime import timedelta, time
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from flask import (
    Blueprint,
    abort,
    current_app,
    flash,
    redirect,
    render_template,
    request,
    url_for,
)

from extensions import db
from models import (
    Goal,
    PlanDay,
    PlanRevision,
    PlanStatusEvent,
    Pouch,
    ReductionPlan,
)
from routes.auth import get_current_user, login_required
from services.api_errors import ApiValidationError
from services.api_schemas import (
    parse_onboarding_draft_payload,
    parse_plan_create_payload,
    parse_plan_preview_payload,
    parse_resume_apply_payload,
    parse_resume_preview_payload,
    parse_revision_apply_payload,
    parse_revision_preview_payload,
)
from services.baseline_service import BaselineService
from services.legacy_goal_service import LegacyGoalService
from services.journey_progress_service import JourneyProgressService
from services.onboarding_draft_service import OnboardingDraftService
from services.plan_schedule import PlanValidationError
from services.plan_serializers import (
    serialize_initial_preview,
    serialize_resume_preview,
    serialize_revision_preview,
)
from services.plan_service import (
    ActivePlanConflictError,
    PlanNotFoundError,
    PlanService,
    PlanStateError,
    PreviewStaleError,
)
from services.today_service import TodayService
from services.timezone_service import get_current_user_day, resolve_timezone
from services.rate_limit_service import (
    authenticated_write_limit,
    plan_mutation_limit,
)


journey_bp = Blueprint('journey', __name__)


@journey_bp.before_request
@authenticated_write_limit()
@plan_mutation_limit(exempt_when=lambda: (
    request.method != 'POST' or not request.path.startswith('/journey/plans/')
))
def _limit_journey_plan_writes():
    return None

_DURATION_BY_PACE = {'gentle': 77, 'steady': 49, 'focused': 28}
_LIST_FIELDS = ('difficult_times', 'common_triggers', 'preferred_pouch_ids')
_DIFFICULT_TIME_LABELS = {
    'morning': 'Morning',
    'after_meals': 'After meals',
    'work_breaks': 'Work breaks',
    'afternoon': 'Afternoon',
    'evening': 'Evening',
    'late_night': 'Late night',
}
_TRIGGER_LABELS = {
    'stress': 'Stress',
    'boredom': 'Boredom',
    'focus': 'Focus',
    'social': 'Social situations',
    'routine': 'Routine',
    'after_meals': 'After meals',
}
_REMINDER_LABELS = {
    'none': 'No reminder',
    'morning': 'Morning · 08:00',
    'afternoon': 'Afternoon · 14:00',
    'evening': 'Evening · 19:00',
}
_CENT = Decimal('0.01')
_BASELINE_LABELS = {
    'manual': 'Manual baseline',
    'recent_logs': 'Recent-log baseline',
    'observe': 'Observed baseline',
    'legacy_goal': 'Legacy Goal baseline',
}
_PROGRESS_STATUS_LABELS = {
    'below_ceiling': 'Below today’s ceiling',
    'at_ceiling': "At today's ceiling",
    'above_ceiling': "Above today's ceiling",
    'no_ceiling': 'No ceiling scheduled today',
    'nicotine_total_incomplete': 'Nicotine total incomplete',
}


def _decimal_display(value):
    if value is None:
        return None
    return format(
        Decimal(value).quantize(_CENT, rounding=ROUND_HALF_UP), '.2f'
    )


def _plan_days(plan_id):
    return PlanDay.query.filter_by(plan_id=plan_id).order_by(
        PlanDay.local_date.asc(), PlanDay.id.asc()
    ).all()


def _schedule_stages(days):
    """Group only truly contiguous persisted rows with identical values."""
    stages = []
    for row in days:
        previous = stages[-1] if stages else None
        if (
            previous is not None
            and row.local_date == previous['end_date'] + timedelta(days=1)
            and row.revision_id == previous['revision_id']
            and row.target_pouches == previous['target_pouches']
            and row.nicotine_ceiling_mg == previous['nicotine_ceiling_value']
        ):
            previous['end_date'] = row.local_date
            previous['days'].append(row)
            continue
        stages.append({
            'start_date': row.local_date,
            'end_date': row.local_date,
            'revision_id': row.revision_id,
            'target_pouches': row.target_pouches,
            'nicotine_ceiling_value': row.nicotine_ceiling_mg,
            'nicotine_ceiling_mg': _decimal_display(row.nicotine_ceiling_mg),
            'days': [row],
        })
    return stages


def _status_history(plan_id):
    events = PlanStatusEvent.query.filter_by(plan_id=plan_id).order_by(
        PlanStatusEvent.effective_at_utc.asc(), PlanStatusEvent.id.asc()
    ).all()
    intervals = []
    for index, event in enumerate(events):
        if event.status not in {'active', 'paused'}:
            continue
        following = events[index + 1] if index + 1 < len(events) else None
        intervals.append({
            'status': event.status,
            'start': event.effective_at_utc,
            'end': following.effective_at_utc if following else None,
            'event_id': event.id,
        })
    return events, intervals


def _plan_presentation(plan, today):
    days = _plan_days(plan.id)
    stages = _schedule_stages(days)
    current_day = next(
        (row for row in days if row.local_date == today), None
    )
    current_stage = next((stage for stage in stages if (
        stage['start_date'] <= today <= stage['end_date']
    )), None)
    next_days = [row for row in days if row.local_date >= today][:7]
    revisions = PlanRevision.query.filter_by(plan_id=plan.id).order_by(
        PlanRevision.effective_date.asc(), PlanRevision.id.asc()
    ).all()
    events, intervals = _status_history(plan.id)
    milestones = []
    for index, stage in enumerate(stages[1:], start=1):
        previous_stage = stages[index - 1]
        if (
            stage['nicotine_ceiling_value']
            == previous_stage['nicotine_ceiling_value']
        ):
            milestone_label = (
                'Scheduled ceiling continues without a target'
                if stage['nicotine_ceiling_value'] is None
                else 'Scheduled ceiling continues at {} mg'.format(
                    stage['nicotine_ceiling_mg']
                )
            )
        else:
            milestone_label = (
                'Observation continues without a target'
                if stage['nicotine_ceiling_value'] is None
                else 'Nicotine ceiling changes to {} mg'.format(
                    stage['nicotine_ceiling_mg'],
                )
            )
        milestones.append({
            'date': stage['start_date'],
            'label': milestone_label,
            'revision_id': stage['revision_id'],
        })
    if plan.target_date is not None:
        milestones.append({
            'date': plan.target_date,
            'label': (
                'Scheduled observation ends'
                if plan.mode == 'observe'
                else 'Scheduled plan target date'
            ),
            'revision_id': plan.active_revision_id,
        })
    proposal = (
        plan.status == 'draft'
        and plan.baseline_source == 'observe'
        and not revisions
    )
    return {
        'row': plan,
        'baseline_source_label': _BASELINE_LABELS.get(
            plan.baseline_source, 'Unknown baseline source'
        ),
        'baseline_pouches': _decimal_display(plan.baseline_pouches),
        'baseline_mg': _decimal_display(plan.baseline_mg),
        'baseline_mg_per_pouch': _decimal_display(
            plan.baseline_mg_per_pouch
        ),
        'days': days,
        'stages': stages,
        'current_day': current_day,
        'current_stage': current_stage,
        'next_days': next_days,
        'revisions': revisions,
        'events': events,
        'intervals': intervals,
        'milestones': milestones,
        'is_observe_proposal': proposal,
    }


def _primary_plan(user_id):
    active = ReductionPlan.query.filter_by(
        user_id=user_id, status='active'
    ).order_by(ReductionPlan.updated_at.desc(), ReductionPlan.id.desc()).first()
    if active is not None:
        return active
    paused = ReductionPlan.query.filter_by(
        user_id=user_id, status='paused'
    ).order_by(ReductionPlan.updated_at.desc(), ReductionPlan.id.desc()).first()
    if paused is not None:
        return paused
    return ReductionPlan.query.filter(
        ReductionPlan.user_id == user_id,
        ReductionPlan.status == 'draft',
        ReductionPlan.baseline_source != 'legacy_goal',
        ReductionPlan.migration_fingerprint.is_(None),
    ).order_by(ReductionPlan.updated_at.desc(), ReductionPlan.id.desc()).first()


def _owned_plan(user_id, plan_id):
    plan = ReductionPlan.query.filter_by(id=plan_id, user_id=user_id).first()
    if plan is None:
        abort(404)
    return plan


def _field_errors(errors):
    return {
        key: value if isinstance(value, list) else [value]
        for key, value in errors.items()
    }


def _journey_context(user, *, editor=None):
    today_summary = TodayService.get_summary(user.id)
    today = today_summary.local_date
    progress = JourneyProgressService.from_summary(today_summary)
    primary = _primary_plan(user.id)
    historical_rows = ReductionPlan.query.filter(
        ReductionPlan.user_id == user.id,
        ReductionPlan.status.in_(('completed', 'archived')),
    ).order_by(ReductionPlan.updated_at.desc(), ReductionPlan.id.desc()).all()
    legacy_review = LegacyGoalService.get_draft_candidates(user.id)
    legacy_goals = Goal.query.filter_by(user_id=user.id).order_by(
        Goal.updated_at.desc(), Goal.id.desc()
    ).all()
    return {
        'user': user,
        'today': today,
        'progress': progress,
        'progress_status_label': _PROGRESS_STATUS_LABELS[progress.status],
        'plan': (
            _plan_presentation(primary, today) if primary is not None else None
        ),
        'historical_plans': [
            _plan_presentation(row, today) for row in historical_rows
        ],
        'legacy_review': legacy_review,
        'legacy_goals': legacy_goals,
        'editor': editor or {},
    }


def _render_journey(user, *, editor=None, status=200):
    return render_template(
        'pages/journey/index.html', **_journey_context(user, editor=editor)
    ), status


def _accessible_pouches(user_id):
    return Pouch.query.filter(
        db.or_(Pouch.is_default.is_(True), Pouch.created_by == user_id)
    ).order_by(Pouch.brand.asc(), Pouch.nicotine_mg.asc(), Pouch.id.asc()).all()


def _today_for(user):
    reset_time = (
        user.preferences.daily_reset_time
        if user.preferences and user.preferences.daily_reset_time
        else time.min
    )
    return get_current_user_day(resolve_timezone(user.timezone).zone, reset_time)


def _initial_values(user, draft):
    values = {
        'intention': '',
        'baseline_source': '',
        'baseline_mg': '',
        'baseline_mg_per_pouch': '',
        'pace': '',
        'end_target_mg': '',
        'target_date': '',
        'start_date': _today_for(user).isoformat(),
        'difficult_times': [],
        'common_triggers': [],
        'preferred_pouch_ids': [],
        'reminder_window': 'none',
        'preview_digest': '',
    }
    if draft is not None:
        values.update(draft.structured_payload or {})
    for key in _LIST_FIELDS:
        values[key] = list(values.get(key) or [])
    values['preferred_pouch_ids'] = [
        str(value) for value in values['preferred_pouch_ids']
    ]
    return values


def _submitted_values():
    values = {
        key: request.form.get(key, '')
        for key in (
            'intention', 'baseline_source', 'baseline_mg',
            'baseline_mg_per_pouch', 'pace', 'end_target_mg',
            'target_date', 'start_date', 'reminder_window',
            'preview_digest',
        )
    }
    for key in _LIST_FIELDS:
        values[key] = request.form.getlist(key)
    return values


def _int_or_raw(value):
    try:
        if not value or any(character not in '0123456789' for character in value):
            return value
        return int(value)
    except (TypeError, ValueError):
        return value


def _preferred_ids_or_raw(values):
    return [_int_or_raw(value) for value in values]


def _draft_candidate(values, suggestion):
    intention = values.get('intention', '')
    structured = {
        'intention': intention,
        'target_basis': (
            'observe' if intention == 'observe' else 'nicotine_mg'
        ),
        'start_date': values.get('start_date', ''),
        'difficult_times': list(values.get('difficult_times') or []),
        'common_triggers': list(values.get('common_triggers') or []),
        'preferred_pouch_ids': _preferred_ids_or_raw(
            values.get('preferred_pouch_ids') or []
        ),
        'reminder_window': values.get('reminder_window', ''),
    }
    if intention == 'observe':
        structured.update({
            'baseline_source': 'observe',
            'duration_days': 7,
        })
        return structured

    source = values.get('baseline_source', '')
    structured['baseline_source'] = source
    if source == 'recent_logs':
        if not suggestion.available:
            raise ApiValidationError({
                'baseline_source': [
                    'A complete recent-log baseline is not available yet. '
                    'Enter it manually or observe for seven days.'
                ],
            })
        structured.update({
            'baseline_pouches': format(suggestion.pouches_per_day, '.2f'),
            'baseline_mg': format(suggestion.nicotine_mg_per_day, '.2f'),
            'baseline_mg_per_pouch': format(
                suggestion.median_mg_per_pouch, '.2f'
            ),
        })
    else:
        structured.update({
            'baseline_mg': values.get('baseline_mg', ''),
        })
        if values.get('baseline_mg_per_pouch'):
            structured['baseline_mg_per_pouch'] = values[
                'baseline_mg_per_pouch'
            ]

    structured['pace'] = values.get('pace', '')
    if structured['pace'] in _DURATION_BY_PACE:
        structured['duration_days'] = _DURATION_BY_PACE[structured['pace']]
    if intention == 'quit_by_date':
        structured['target_date'] = values.get('target_date', '')
        structured['end_target_mg'] = '0.00'
    else:
        structured['end_target_mg'] = values.get('end_target_mg', '')
    return structured


def _normalize_draft(values, suggestion):
    candidate = _draft_candidate(values, suggestion)
    _, normalized = parse_onboarding_draft_payload({
        'current_step': 'review',
        'structured_payload': candidate,
    })
    if normalized.get('intention') == 'reduce':
        baseline = normalized.get('baseline_mg')
        end_target = normalized.get('end_target_mg')
        if baseline is not None and end_target is not None:
            if Decimal(end_target) >= Decimal(baseline):
                raise ApiValidationError({
                    'end_target_mg': [
                        'Choose an end target below your starting daily nicotine.'
                    ],
                })
    return normalized


def _plan_payload(structured):
    mode = structured['intention']
    observe = mode == 'observe'
    return {
        'mode': mode,
        'target_basis': structured['target_basis'],
        'baseline_source': structured['baseline_source'],
        'baseline_pouches': None if observe else structured.get('baseline_pouches'),
        'baseline_mg': None if observe else structured.get('baseline_mg'),
        'baseline_mg_per_pouch': (
            None if observe else structured.get('baseline_mg_per_pouch')
        ),
        'pace': None if observe else structured.get('pace'),
        'start_date': structured['start_date'],
        'target_date': structured.get('target_date'),
        'duration_days': (
            7 if observe else (
                None if mode == 'quit_by_date'
                else structured.get('duration_days')
            )
        ),
        'end_target_mg': None if observe else structured.get('end_target_mg'),
        'stage_targets': None,
    }


def _normalize_field_errors(field_errors):
    normalized = {}
    for path, messages in field_errors.items():
        key = path.removeprefix('structured_payload.')
        value = messages if isinstance(messages, list) else [messages]
        normalized.setdefault(key, []).extend(value)
    return normalized


def _render_onboarding(
    user,
    values,
    suggestion,
    pouches,
    *,
    preview=None,
    field_errors=None,
    status_message='',
    error_message='',
    status=200,
):
    return render_template(
        'pages/journey/onboarding.html',
        user=user,
        values=values,
        baseline=suggestion,
        pouches=pouches,
        pouch_by_id={str(pouch.id): pouch for pouch in pouches},
        preview=preview,
        field_errors=field_errors or {},
        status_message=status_message,
        error_message=error_message,
        difficult_time_labels=_DIFFICULT_TIME_LABELS,
        trigger_labels=_TRIGGER_LABELS,
        reminder_labels=_REMINDER_LABELS,
    ), status


@journey_bp.route('/')
@login_required
def index():
    user = get_current_user()
    return _render_journey(user)


def _lifecycle_action(plan_id, method, success_message):
    user = get_current_user()
    _owned_plan(user.id, plan_id)
    try:
        method(user.id, plan_id)
    except PlanNotFoundError:
        abort(404)
    except PlanStateError:
        db.session.rollback()
        flash(
            'That plan action is not available in its current state.',
            'info',
        )
    except Exception:
        db.session.rollback()
        flash(
            'We could not update that plan right now. Your history is unchanged.',
            'error',
        )
    else:
        flash(success_message, 'success')
    return redirect(url_for('journey.index'))


@journey_bp.route('/plans/<int:plan_id>/pause', methods=['POST'])
@login_required
def pause_plan(plan_id):
    return _lifecycle_action(
        plan_id,
        PlanService.pause,
        'Plan paused. Your history is unchanged.',
    )


@journey_bp.route('/plans/<int:plan_id>/complete', methods=['POST'])
@login_required
def complete_plan(plan_id):
    return _lifecycle_action(
        plan_id, PlanService.complete, 'Plan marked complete.'
    )


@journey_bp.route('/plans/<int:plan_id>/archive', methods=['POST'])
@login_required
def archive_plan(plan_id):
    return _lifecycle_action(
        plan_id,
        PlanService.archive,
        'Plan archived. Your history is still available.',
    )


@journey_bp.route('/plans/<int:plan_id>/finish-observe', methods=['POST'])
@login_required
def finish_observe_plan(plan_id):
    user = get_current_user()
    _owned_plan(user.id, plan_id)
    proposals_before = {
        row.id for row in ReductionPlan.query.filter_by(
            user_id=user.id, status='draft', baseline_source='observe'
        ).all()
    }
    try:
        PlanService.finish_observe(user.id, plan_id)
    except PlanNotFoundError:
        abort(404)
    except PlanStateError:
        db.session.rollback()
        flash(
            'That Observe action is not available yet. Keep tracking and '
            'review it after the scheduled period.',
            'info',
        )
    except Exception:
        db.session.rollback()
        flash(
            'We could not finish Observe right now. Your history is unchanged.',
            'error',
        )
    else:
        proposal = ReductionPlan.query.filter(
            ReductionPlan.user_id == user.id,
            ReductionPlan.status == 'draft',
            ReductionPlan.baseline_source == 'observe',
            ReductionPlan.id.notin_(proposals_before),
        ).first()
        if proposal is None:
            flash(
                'Observe is complete. There is not enough complete strength '
                'evidence yet, so enter a baseline manually when you are ready.',
                'info',
            )
        else:
            flash(
                'Observe is complete. A proposed baseline is ready for pace '
                'and target review; nothing was activated.',
                'success',
            )
    return redirect(url_for('journey.index'))


def _resume_values():
    return {
        'resume_date': request.form.get('resume_date', ''),
        'preview_digest': request.form.get('preview_digest', ''),
    }


def _resume_editor(plan, values, *, preview=None, field_errors=None,
                   message='', error_message=''):
    return {
        'kind': 'resume',
        'plan_id': plan.id,
        'values': values,
        'preview': preview,
        'field_errors': field_errors or {},
        'message': message,
        'error_message': error_message,
    }


@journey_bp.route('/plans/<int:plan_id>/resume', methods=['POST'])
@login_required
def resume_plan(plan_id):
    user = get_current_user()
    plan = _owned_plan(user.id, plan_id)
    values = _resume_values()
    confirm = request.form.get('form_action') == 'confirm'
    try:
        if confirm:
            resume_date, digest = parse_resume_apply_payload({
                'resume_date': values['resume_date'],
                'preview_digest': values['preview_digest'],
            })
            PlanService.resume(user.id, plan.id, resume_date, digest)
            flash('Plan resumed. Review the updated future schedule.', 'success')
            return redirect(url_for('journey.index'))
        resume_date = parse_resume_preview_payload({
            'resume_date': values['resume_date']
        })
        preview = PlanService.preview_resume(user.id, plan.id, resume_date)
        return _render_journey(user, editor=_resume_editor(
            plan,
            values,
            preview=serialize_resume_preview(resume_date, preview),
            message=(
                'Review every future day. Previewing has not changed the plan.'
            ),
        ))
    except ApiValidationError as exc:
        db.session.rollback()
        return _render_journey(user, editor=_resume_editor(
            plan, values, field_errors=_field_errors(exc.field_errors),
            error_message='Check the resume date and try again.',
        ), status=422)
    except PlanNotFoundError:
        abort(404)
    except PlanStateError:
        db.session.rollback()
        flash(
            'That plan action is not available in its current state.', 'info'
        )
        return redirect(url_for('journey.index'))
    except PlanValidationError as exc:
        db.session.rollback()
        return _render_journey(user, editor=_resume_editor(
            plan, values, field_errors=_field_errors(exc.field_errors),
            error_message='Check the resume date and try again.',
        ), status=422)
    except PreviewStaleError:
        db.session.rollback()
        try:
            resume_date = parse_resume_preview_payload({
                'resume_date': values['resume_date']
            })
            preview = PlanService.preview_resume(user.id, plan.id, resume_date)
        except PlanValidationError:
            resume_date = _today_for(user) + timedelta(days=1)
            values['resume_date'] = resume_date.isoformat()
            preview = PlanService.preview_resume(user.id, plan.id, resume_date)
        return _render_journey(user, editor=_resume_editor(
            plan,
            values,
            preview=serialize_resume_preview(resume_date, preview),
            error_message=(
                'The schedule changed. This is a fresh preview; review it '
                'before confirming again.'
            ),
        ), status=409)
    except ActivePlanConflictError:
        db.session.rollback()
        flash(
            'Another plan is active. Pause or complete it before resuming this one.',
            'info',
        )
        return redirect(url_for('journey.index'))
    except Exception:
        db.session.rollback()
        current_app.logger.exception('Journey resume preview/apply failed')
        return _render_journey(user, editor=_resume_editor(
            plan, values,
            error_message=(
                'We could not prepare that schedule. No plan history changed.'
            ),
        ), status=500)


def _revision_values():
    return {
        'effective_date': request.form.get('effective_date', ''),
        'pace': request.form.get('pace', ''),
        'duration_days': request.form.get('duration_days', ''),
        'end_target_mg': request.form.get('end_target_mg', ''),
        'preview_digest': request.form.get('preview_digest', ''),
    }


def _revision_changes(values):
    changes = {}
    if values['pace']:
        changes['pace'] = values['pace']
    if values['duration_days']:
        changes['duration_days'] = _int_or_raw(values['duration_days'])
    if values['end_target_mg'] or changes:
        changes['end_target_mg'] = values['end_target_mg']
    if changes:
        changes['target_basis'] = 'nicotine_mg'
    return changes


def _revision_editor(plan, values, *, preview=None, field_errors=None,
                     message='', error_message=''):
    return {
        'kind': 'revision',
        'plan_id': plan.id,
        'values': values,
        'preview': preview,
        'field_errors': field_errors or {},
        'message': message,
        'error_message': error_message,
    }


@journey_bp.route('/plans/<int:plan_id>/revision', methods=['POST'])
@login_required
def revise_plan(plan_id):
    user = get_current_user()
    plan = _owned_plan(user.id, plan_id)
    values = _revision_values()
    changes = _revision_changes(values)
    confirm = request.form.get('form_action') == 'confirm'
    try:
        if confirm:
            effective, parsed_changes, digest, reason, note = (
                parse_revision_apply_payload({
                    'effective_date': values['effective_date'],
                    'changes': changes,
                    'preview_digest': values['preview_digest'],
                    'reason': 'user_edit',
                    'note': None,
                })
            )
            PlanService.apply_revision(
                user.id, plan.id, parsed_changes, effective, digest, reason,
                note=note,
            )
            flash(
                'Plan revised. Past and already-started days are unchanged.',
                'success',
            )
            return redirect(url_for('journey.index'))
        effective, parsed_changes = parse_revision_preview_payload({
            'effective_date': values['effective_date'],
            'changes': changes,
        })
        preview = PlanService.preview_revision(
            user.id, plan.id, parsed_changes, effective
        )
        return _render_journey(user, editor=_revision_editor(
            plan,
            values,
            preview=serialize_revision_preview(effective, preview),
            message=(
                'Review every future difference. Previewing has not changed '
                'the plan.'
            ),
        ))
    except ApiValidationError as exc:
        db.session.rollback()
        return _render_journey(user, editor=_revision_editor(
            plan, values, field_errors=_field_errors(exc.field_errors),
            error_message='Check the revision fields and try again.',
        ), status=422)
    except PlanNotFoundError:
        abort(404)
    except PlanStateError:
        db.session.rollback()
        flash(
            'That plan action is not available in its current state.', 'info'
        )
        return redirect(url_for('journey.index'))
    except PlanValidationError as exc:
        db.session.rollback()
        return _render_journey(user, editor=_revision_editor(
            plan, values, field_errors=_field_errors(exc.field_errors),
            error_message='Check the revision fields and try again.',
        ), status=422)
    except PreviewStaleError:
        db.session.rollback()
        effective, parsed_changes = parse_revision_preview_payload({
            'effective_date': values['effective_date'],
            'changes': changes,
        })
        try:
            preview = PlanService.preview_revision(
                user.id, plan.id, parsed_changes, effective
            )
        except PlanValidationError:
            effective = _today_for(user) + timedelta(days=1)
            values['effective_date'] = effective.isoformat()
            preview = PlanService.preview_revision(
                user.id, plan.id, parsed_changes, effective
            )
        return _render_journey(user, editor=_revision_editor(
            plan,
            values,
            preview=serialize_revision_preview(effective, preview),
            error_message=(
                'The effective schedule changed. This is a fresh preview; '
                'review it before confirming again.'
            ),
        ), status=409)
    except Exception:
        db.session.rollback()
        current_app.logger.exception('Journey revision preview/apply failed')
        return _render_journey(user, editor=_revision_editor(
            plan, values,
            error_message=(
                'We could not prepare that revision. No plan history changed.'
            ),
        ), status=500)


@journey_bp.route('/onboarding', methods=['GET', 'POST'])
@login_required
def onboarding():
    user = get_current_user()
    suggestion = BaselineService.suggest(user.id)
    pouches = _accessible_pouches(user.id)
    draft_service = OnboardingDraftService()
    draft = draft_service.get(user.id)
    if request.method == 'GET':
        return _render_onboarding(
            user, _initial_values(user, draft), suggestion, pouches
        )

    values = _submitted_values()
    try:
        structured = _normalize_draft(values, suggestion)
        draft_service.save(user.id, 'review', structured)
        plan_body = _plan_payload(structured)
        generation_input, baseline_source = parse_plan_preview_payload(plan_body)
        if request.form.get('form_action') != 'confirm':
            generated = PlanService.preview_initial(
                user.id, generation_input, baseline_source
            )
            preview = serialize_initial_preview(
                generation_input, baseline_source, generated
            )
            return _render_onboarding(
                user, values, suggestion, pouches,
                preview=preview,
                status_message=(
                    'Your preview is ready. Review every assumption before '
                    'you activate it.'
                ),
            )

        create_body = dict(plan_body)
        create_body.update({
            'preview_digest': values.get('preview_digest', ''),
            'activation': 'activate',
        })
        (
            create_input,
            create_source,
            preview_digest,
            activation,
        ) = parse_plan_create_payload(create_body)
        PlanService.create_from_preview(
            user.id,
            create_input,
            create_source,
            preview_digest,
            activation,
        )
        flash('Your plan is active. Today is the next useful step.', 'success')
        return redirect(url_for('today.index'))
    except ApiValidationError as exc:
        db.session.rollback()
        return _render_onboarding(
            user, values, suggestion, pouches,
            field_errors=_normalize_field_errors(exc.field_errors),
            error_message='Check the highlighted answers and try again.',
            status=422,
        )
    except PlanValidationError as exc:
        db.session.rollback()
        return _render_onboarding(
            user, values, suggestion, pouches,
            field_errors=_normalize_field_errors(exc.field_errors),
            error_message='Check the highlighted answers and try again.',
            status=422,
        )
    except PreviewStaleError:
        db.session.rollback()
        generated = PlanService.preview_initial(
            user.id, generation_input, baseline_source
        )
        preview = serialize_initial_preview(
            generation_input, baseline_source, generated
        )
        return _render_onboarding(
            user, values, suggestion, pouches,
            preview=preview,
            error_message=(
                'Your answers changed since this preview. We made a fresh '
                'preview; review it before confirming again.'
            ),
            status=409,
        )
    except ActivePlanConflictError:
        db.session.rollback()
        generated = PlanService.preview_initial(
            user.id, generation_input, baseline_source
        )
        preview = serialize_initial_preview(
            generation_input, baseline_source, generated
        )
        return _render_onboarding(
            user, values, suggestion, pouches,
            preview=preview,
            error_message=(
                'You already have an active plan. Review it from Journey '
                'before starting another.'
            ),
            status=409,
        )
    except Exception:
        db.session.rollback()
        return _render_onboarding(
            user, values, suggestion, pouches,
            error_message=(
                'We could not finish that request. Your answers are still '
                'here; try again.'
            ),
            status=500,
        )
