from flask import Blueprint, jsonify, request
import logging
from decimal import Decimal
from routes.auth import get_current_user, login_required
from app import db
from models import Pouch, UserPreferences
from services.preference_service import PreferenceService
from services.pouch_service import get_all_pouches
from services.request_context import get_request_id
from services.api_errors import (
    ApiValidationError,
    active_plan_conflict_response,
    error_response,
    internal_error_response,
    invalid_plan_state_response,
    plan_validation_error_response,
    preview_stale_response,
    not_found_response,
    validation_error_response,
)
from services.api_schemas import (
    parse_onboarding_draft_payload,
    parse_plan_create_payload,
    parse_plan_preview_payload,
    parse_pause_payload,
    parse_resume_apply_payload,
    parse_resume_preview_payload,
    parse_revision_apply_payload,
    parse_revision_preview_payload,
)
from services.baseline_service import BaselineService
from services.onboarding_draft_service import (
    OnboardingDraftService,
    serialize_draft,
)
from services.plan_schedule import PlanValidationError
from services.plan_service import (
    ActivePlanConflictError,
    PlanNotFoundError,
    PlanStateError,
    PlanService,
    PreviewStaleError,
)
from services.plan_serializers import (
    preview_target_basis,
    serialize_initial_preview,
    serialize_plan,
    serialize_resume_preview,
    serialize_revision_preview,
)
from services.serializers import (
    InvalidLocalTimeError,
    canonical_craving_for_timezone,
    canonical_log_for_mutation,
    parse_create_craving_request,
    parse_create_log_request,
    parse_update_craving_request,
    serialize_canonical_craving,
    serialize_canonical_log,
    serialize_today_summary,
)
from services.craving_service import (
    CravingNotFoundError as CravingMutationNotFoundError,
    CravingOutcomeConflictError,
    CravingService,
    CravingValidationError,
)
from services.today_service import TodayService
from services.timezone_service import resolve_timezone, validate_timezone
from services.check_in_service import (
    CheckInPersistenceError,
    CheckInService,
    parse_check_in_payload,
    serialize_check_in,
)
from services.rate_limit_service import (
    analytics_read_limit,
    authenticated_write_limit,
    canonical_write_limit,
    destructive_limit,
    plan_mutation_limit,
    plan_preview_limit,
    quick_add_limit,
)

from services.log_service import (
    CravingLinkConflictError, CravingNotFoundError, CreateLogInput,
    LogService, LogNotFoundError, LogValidationError, create_log_entry,
    get_daily_intake_for_user, has_custom_product_input,
)
from datetime import datetime, timedelta, time, timezone



api_bp = Blueprint('api', __name__)
logger = logging.getLogger(__name__)


@api_bp.before_request
@authenticated_write_limit()
def _limit_authenticated_api_writes():
    return None


@api_bp.route('/today', methods=['GET'])
@login_required
def get_today_summary():
    try:
        summary = TodayService.get_summary(get_current_user().id)
    except Exception:
        db.session.rollback()
        logger.exception(
            'Today API composition failed (request %s)',
            get_request_id(),
        )
        return internal_error_response()
    return jsonify({'today': serialize_today_summary(summary)})


@api_bp.route('/check-ins', methods=['POST'])
@login_required
def upsert_check_in_api():
    try:
        payload = parse_check_in_payload(request.get_json(silent=True))
    except ApiValidationError as exc:
        return validation_error_response(exc)

    user = get_current_user()
    instant = datetime.now(timezone.utc)
    try:
        check_in = CheckInService.upsert_for_today(
            user.id,
            payload,
            now=instant,
        )
    except CheckInPersistenceError:
        logger.exception(
            'Check-in mutation failed before commit (request %s)',
            get_request_id(),
        )
        return internal_error_response()
    except Exception:
        db.session.rollback()
        logger.exception(
            'Check-in mutation failed before service transaction '
            '(request %s)',
            get_request_id(),
        )
        return internal_error_response()

    canonical = serialize_check_in(check_in)
    try:
        today = serialize_today_summary(
            TodayService.get_summary(user.id, now=instant)
        )
        warnings = []
    except Exception:
        logger.exception(
            'Today refresh unavailable after committed check-in mutation '
            '(request %s)',
            get_request_id(),
        )
        today = None
        warnings = [
            {'code': 'today_refresh_unavailable', 'retryable': True}
        ]
    return jsonify({
        'check_in': canonical,
        'today': today,
        'warnings': warnings,
    })


@api_bp.route('/cravings', methods=['POST'])
@canonical_write_limit()
@login_required
def create_craving_api():
    try:
        payload = parse_create_craving_request(request.get_json(silent=True))
    except InvalidLocalTimeError as exc:
        return error_response(
            422,
            'invalid_local_time',
            exc.message,
            field_errors=exc.field_errors,
        )
    except ApiValidationError as exc:
        return validation_error_response(exc)

    user = get_current_user()
    try:
        result = CravingService.create_idempotent(user.id, payload)
    except CravingValidationError as exc:
        return validation_error_response(ApiValidationError(exc.field_errors))
    except Exception:
        db.session.rollback()
        logger.exception(
            'Craving creation failed before commit (request %s)',
            get_request_id(),
        )
        return internal_error_response()

    canonical_craving = canonical_craving_for_timezone(
        result.craving, user.timezone
    )
    try:
        today = serialize_today_summary(TodayService.get_summary(user.id))
        warnings = []
    except Exception:
        db.session.rollback()
        logger.exception(
            'Today refresh unavailable after committed craving creation '
            '(request %s)',
            get_request_id(),
        )
        today = None
        warnings = [
            {'code': 'today_refresh_unavailable', 'retryable': True}
        ]
    response = {
        'craving': serialize_canonical_craving(canonical_craving),
        'today': today,
        'created': result.created,
        'warnings': warnings,
    }
    return jsonify(response), 201 if result.created else 200


@api_bp.route('/cravings/<int:craving_id>', methods=['PATCH'])
@canonical_write_limit()
@login_required
def update_craving_api(craving_id):
    try:
        patch = parse_update_craving_request(request.get_json(silent=True))
    except ApiValidationError as exc:
        return validation_error_response(exc)

    user = get_current_user()
    try:
        craving = CravingService.update_owned(user.id, craving_id, patch)
    except CravingMutationNotFoundError:
        return not_found_response()
    except CravingOutcomeConflictError:
        return error_response(
            409,
            'craving_outcome_conflict',
            'That craving already has a different outcome.',
        )
    except CravingValidationError as exc:
        return validation_error_response(ApiValidationError(exc.field_errors))
    except Exception:
        db.session.rollback()
        logger.exception(
            'Craving update failed before commit (request %s)',
            get_request_id(),
        )
        return internal_error_response()

    canonical_craving = canonical_craving_for_timezone(
        craving, user.timezone
    )
    try:
        today = serialize_today_summary(TodayService.get_summary(user.id))
        warnings = []
    except Exception:
        db.session.rollback()
        logger.exception(
            'Today refresh unavailable after committed craving update '
            '(request %s)',
            get_request_id(),
        )
        today = None
        warnings = [
            {'code': 'today_refresh_unavailable', 'retryable': True}
        ]
    return jsonify({
        'craving': serialize_canonical_craving(canonical_craving),
        'today': today,
        'warnings': warnings,
    })


@api_bp.route('/logs', methods=['POST'])
@canonical_write_limit()
@login_required
def create_log_api():
    try:
        payload = parse_create_log_request(request.get_json(silent=True))
    except InvalidLocalTimeError as exc:
        return error_response(
            422,
            'invalid_local_time',
            exc.message,
            field_errors=exc.field_errors,
        )
    except ApiValidationError as exc:
        return validation_error_response(exc)
    try:
        result = LogService.create_idempotent(get_current_user().id, payload)
    except CravingNotFoundError:
        return not_found_response()
    except CravingLinkConflictError:
        return error_response(
            409,
            'craving_link_conflict',
            'That craving is already linked to another nicotine log.',
        )
    except LogValidationError as exc:
        return validation_error_response(ApiValidationError(exc.field_errors))
    except Exception:
        db.session.rollback()
        logger.exception(
            'Log mutation failed before commit (request %s)',
            get_request_id(),
        )
        return internal_error_response()
    canonical_log = canonical_log_for_mutation(result.log, payload)
    try:
        today = serialize_today_summary(
            TodayService.get_summary(get_current_user().id)
        )
        warnings = []
    except Exception:
        db.session.rollback()
        logger.exception(
            'Today refresh unavailable after committed log mutation '
            '(request %s)',
            get_request_id(),
        )
        today = None
        warnings = [
            {'code': 'today_refresh_unavailable', 'retryable': True}
        ]
    response = {
        'log': serialize_canonical_log(canonical_log),
        'today': today,
        'created': result.created,
        'warnings': warnings,
    }
    return jsonify(response), 201 if result.created else 200


@api_bp.route('/logs/<int:log_id>', methods=['DELETE'])
@destructive_limit()
@login_required
def delete_log_api(log_id):
    try:
        LogService.delete_owned(get_current_user().id, log_id)
    except LogNotFoundError:
        return not_found_response()
    except Exception:
        db.session.rollback()
        logger.exception(
            'Log deletion failed before commit (request %s)',
            get_request_id(),
        )
        return internal_error_response()
    try:
        today = serialize_today_summary(
            TodayService.get_summary(get_current_user().id)
        )
        warnings = []
    except Exception:
        db.session.rollback()
        logger.exception(
            'Today refresh unavailable after committed log deletion '
            '(request %s)',
            get_request_id(),
        )
        today = None
        warnings = [
            {'code': 'today_refresh_unavailable', 'retryable': True}
        ]
    return jsonify({
        'deleted_log_id': log_id,
        'today': today,
        'warnings': warnings,
    })


@api_bp.route('/preferences/theme', methods=['PATCH'])
@login_required
def update_theme_preference():
    data = request.get_json(silent=True) or {}
    try:
        settings = PreferenceService().set_theme(
            get_current_user().id, data.get('theme')
        )
    except ValueError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 400
    return jsonify({'success': True, 'theme': settings.theme})


@api_bp.route('/preferences/day-boundary', methods=['PATCH'])
@login_required
def update_day_boundary_preference():
    data = request.get_json(silent=True)
    if (
        not isinstance(data, dict)
        or set(data) != {'timezone', 'daily_reset_time'}
        or not validate_timezone(data.get('timezone'))
    ):
        return error_response(
            422, 'validation_error',
            'Check the highlighted fields and try again.',
            field_errors={'timezone': ['Choose a valid time zone.']},
        )
    try:
        preferences = PreferenceService().update_day_boundary(
            get_current_user().id,
            data.get('timezone'),
            data.get('daily_reset_time'),
        )
    except (ValueError, TypeError):
        db.session.rollback()
        return error_response(
            422, 'validation_error',
            'Check the highlighted fields and try again.',
            field_errors={'daily_reset_time': ['Choose a valid time.']},
        )
    return jsonify({
        'success': True,
        'timezone': get_current_user().timezone,
        'daily_reset_time': preferences.daily_reset_time.strftime('%H:%M'),
        'pending': False,
    })

@api_bp.route('/daily_intake', methods=['GET'])
@analytics_read_limit()
@login_required
def daily_intake_data():
    today = datetime.utcnow().date()
    start_date_str = request.args.get('start_date')
    end_date_str = request.args.get('end_date')

    if start_date_str and end_date_str:
        start_date = datetime.strptime(start_date_str, '%Y-%m-%d').date()
        end_date = datetime.strptime(end_date_str, '%Y-%m-%d').date()
    else:
        start_date = today - timedelta(days=29)
        end_date = today

    current_user = get_current_user()
    reset_time = time(0, 0)
    if hasattr(current_user, 'preferences') and current_user.preferences and current_user.preferences.daily_reset_time:
        reset_time = current_user.preferences.daily_reset_time

    daily_intake = get_daily_intake_for_user(
        user_id=current_user.id,
        start_date=start_date,
        end_date=end_date,
        reset_time=reset_time
    )



    # Convert keys to strings for JSON compatibility
    daily_intake_str_keys = {d.strftime('%Y-%m-%d'): v for d, v in daily_intake.items()}
    return jsonify(daily_intake_str_keys)


def _serialize_baseline(suggestion):
    def money(value):
        return None if value is None else '{:.2f}'.format(value)

    return {
        'available': suggestion.available,
        'pouches_per_day': money(suggestion.pouches_per_day),
        'nicotine_mg_per_day': money(suggestion.nicotine_mg_per_day),
        'median_mg_per_pouch': money(suggestion.median_mg_per_pouch),
        'logged_days_used': suggestion.logged_days_used,
        'window_start': suggestion.window_start.isoformat(),
        'window_end': suggestion.window_end.isoformat(),
        'reason': suggestion.reason,
    }


@api_bp.route('/baseline-suggestion', methods=['GET'])
@analytics_read_limit()
@login_required
def baseline_suggestion():
    if request.args:
        field_errors = {
            key: ['This query parameter is not supported.']
            for key in sorted(request.args.keys())
        }
        return validation_error_response(ApiValidationError(field_errors))
    try:
        suggestion = BaselineService.suggest(get_current_user().id)
    except Exception:
        db.session.rollback()
        return internal_error_response()
    return jsonify({'baseline': _serialize_baseline(suggestion)})


@api_bp.route('/onboarding-draft', methods=['GET'])
@login_required
def get_onboarding_draft():
    try:
        draft = OnboardingDraftService().get(get_current_user().id)
    except Exception:
        db.session.rollback()
        return internal_error_response()
    return jsonify({'onboarding_draft': serialize_draft(draft)})


@api_bp.route('/plans/preview', methods=['POST'])
@plan_preview_limit()
@login_required
def preview_initial_plan():
    try:
        generation_input, baseline_source = parse_plan_preview_payload(
            request.get_json(silent=True)
        )
    except ApiValidationError as exc:
        return validation_error_response(exc)
    try:
        preview = PlanService.preview_initial(
            get_current_user().id, generation_input, baseline_source
        )
    except PlanValidationError as exc:
        db.session.rollback()
        return plan_validation_error_response(exc.field_errors)
    except Exception:
        db.session.rollback()
        return internal_error_response()
    return _plan_compatibility_response(serialize_initial_preview(
        generation_input, baseline_source, preview
    ), target_basis=generation_input.target_basis,
       successor_path='/api/plans/preview')


@api_bp.route('/plans', methods=['POST'])
@plan_mutation_limit()
@login_required
def create_initial_plan():
    try:
        (
            generation_input,
            baseline_source,
            preview_digest,
            activation,
        ) = parse_plan_create_payload(request.get_json(silent=True))
    except ApiValidationError as exc:
        return validation_error_response(exc)
    try:
        plan_payload = PlanService.create_from_preview(
            get_current_user().id,
            generation_input,
            baseline_source,
            preview_digest,
            activation,
            result_builder=serialize_plan,
        )
    except PlanValidationError as exc:
        return plan_validation_error_response(exc.field_errors)
    except PreviewStaleError:
        return preview_stale_response()
    except ActivePlanConflictError:
        return active_plan_conflict_response()
    except Exception:
        return internal_error_response()
    return _plan_compatibility_response(
        {'plan': plan_payload, 'created': True},
        status=201,
        target_basis=generation_input.target_basis,
        successor_path='/api/plans',
    )


@api_bp.route('/plans/<int:plan_id>/revisions/preview', methods=['POST'])
@plan_preview_limit()
@login_required
def preview_plan_revision(plan_id):
    try:
        effective_date, changes = parse_revision_preview_payload(
            request.get_json(silent=True)
        )
    except ApiValidationError as exc:
        return validation_error_response(exc)
    try:
        preview = PlanService.preview_revision(
            get_current_user().id, plan_id, changes, effective_date
        )
    except PlanNotFoundError:
        db.session.rollback()
        return not_found_response()
    except PlanStateError:
        db.session.rollback()
        return invalid_plan_state_response()
    except PlanValidationError as exc:
        db.session.rollback()
        return plan_validation_error_response(exc.field_errors)
    except Exception:
        db.session.rollback()
        return internal_error_response()
    return _plan_compatibility_response(
        serialize_revision_preview(effective_date, preview),
        target_basis=preview_target_basis(preview),
        successor_path=f'/api/plans/{plan_id}/revisions/preview',
    )


@api_bp.route('/plans/<int:plan_id>/revisions', methods=['POST'])
@plan_mutation_limit()
@login_required
def apply_plan_revision(plan_id):
    try:
        effective_date, changes, digest, reason, note = (
            parse_revision_apply_payload(request.get_json(silent=True))
        )
    except ApiValidationError as exc:
        return validation_error_response(exc)
    try:
        plan_payload = PlanService.apply_revision(
            get_current_user().id,
            plan_id,
            changes,
            effective_date,
            digest,
            reason,
            note=note,
            result_builder=serialize_plan,
        )
    except PlanNotFoundError:
        return not_found_response()
    except PlanStateError:
        return invalid_plan_state_response()
    except PlanValidationError as exc:
        return plan_validation_error_response(exc.field_errors)
    except PreviewStaleError:
        return preview_stale_response()
    except Exception:
        return internal_error_response()
    return _plan_compatibility_response(
        {'plan': plan_payload, 'updated': True},
        target_basis=plan_payload.get('target_basis'),
        successor_path=f'/api/plans/{plan_id}/revisions',
    )


def _plan_compatibility_response(
    payload,
    *,
    status=200,
    target_basis=None,
    successor_path,
):
    response = jsonify(payload)
    response.status_code = status
    if target_basis == 'legacy_pouches':
        response.headers['Deprecation'] = 'true'
        response.headers['Link'] = (
            f'<{successor_path}>; rel="successor-version"'
        )
    return response


@api_bp.route('/plans/<int:plan_id>/pause', methods=['POST'])
@plan_mutation_limit()
@login_required
def pause_plan(plan_id):
    try:
        raw_body = request.get_json(silent=True)
        if raw_body is None and request.data.strip():
            raise ApiValidationError({'body': ['Send valid JSON or no body.']})
        reason = parse_pause_payload(raw_body)
    except ApiValidationError as exc:
        return validation_error_response(exc)
    try:
        plan_payload = PlanService.pause(
            get_current_user().id,
            plan_id,
            reason=reason,
            result_builder=serialize_plan,
        )
    except PlanNotFoundError:
        return not_found_response()
    except PlanStateError:
        return invalid_plan_state_response()
    except Exception:
        return internal_error_response()
    return _plan_compatibility_response(
        {'plan': plan_payload, 'paused': True},
        target_basis=plan_payload.get('target_basis'),
        successor_path=f'/api/plans/{plan_id}/pause',
    )


@api_bp.route('/plans/<int:plan_id>/resume/preview', methods=['POST'])
@plan_preview_limit()
@login_required
def preview_plan_resume(plan_id):
    try:
        resume_date = parse_resume_preview_payload(
            request.get_json(silent=True)
        )
    except ApiValidationError as exc:
        return validation_error_response(exc)
    try:
        preview = PlanService.preview_resume(
            get_current_user().id, plan_id, resume_date
        )
    except PlanNotFoundError:
        db.session.rollback()
        return not_found_response()
    except PlanStateError:
        db.session.rollback()
        return invalid_plan_state_response()
    except PlanValidationError as exc:
        db.session.rollback()
        return plan_validation_error_response(exc.field_errors)
    except Exception:
        db.session.rollback()
        return internal_error_response()
    return _plan_compatibility_response(
        serialize_resume_preview(resume_date, preview),
        target_basis=preview_target_basis(preview),
        successor_path=f'/api/plans/{plan_id}/resume/preview',
    )


@api_bp.route('/plans/<int:plan_id>/resume', methods=['POST'])
@plan_mutation_limit()
@login_required
def resume_plan(plan_id):
    try:
        resume_date, digest = parse_resume_apply_payload(
            request.get_json(silent=True)
        )
    except ApiValidationError as exc:
        return validation_error_response(exc)
    try:
        plan_payload = PlanService.resume(
            get_current_user().id,
            plan_id,
            resume_date,
            digest,
            result_builder=serialize_plan,
        )
    except PlanNotFoundError:
        return not_found_response()
    except PlanStateError:
        return invalid_plan_state_response()
    except PlanValidationError as exc:
        return plan_validation_error_response(exc.field_errors)
    except PreviewStaleError:
        return preview_stale_response()
    except ActivePlanConflictError:
        return active_plan_conflict_response()
    except Exception:
        return internal_error_response()
    return _plan_compatibility_response(
        {'plan': plan_payload, 'resumed': True},
        target_basis=plan_payload.get('target_basis'),
        successor_path=f'/api/plans/{plan_id}/resume',
    )


@api_bp.route('/onboarding-draft', methods=['PUT'])
@login_required
def put_onboarding_draft():
    try:
        current_step, structured_payload = parse_onboarding_draft_payload(
            request.get_json(silent=True))
    except ApiValidationError as exc:
        return validation_error_response(exc)
    try:
        draft = OnboardingDraftService().save(
            get_current_user().id, current_step, structured_payload)
    except ApiValidationError as exc:
        return validation_error_response(exc)
    except Exception:
        return internal_error_response()
    return jsonify({
        'onboarding_draft': serialize_draft(draft),
        'saved': True,
    })


@api_bp.route('/onboarding-draft', methods=['DELETE'])
@destructive_limit()
@login_required
def delete_onboarding_draft():
    try:
        OnboardingDraftService().delete(get_current_user().id)
    except Exception:
        return internal_error_response()
    return '', 204


@api_bp.route('/update-timezone', methods=['POST'])
@login_required
def update_timezone():
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or set(data) != {'timezone'}:
        return error_response(422, 'validation_error', 'Send one valid time zone.', field_errors={'timezone': ['Choose a valid time zone.']})
    if not validate_timezone(data['timezone']):
        return error_response(
            422, 'validation_error', 'Send one valid time zone.',
            field_errors={'timezone': ['Choose a valid time zone.']},
        )
    user = get_current_user()
    preferences = UserPreferences.query.filter_by(user_id=user.id).first()
    reset = (
        preferences.daily_reset_time.strftime('%H:%M')
        if preferences is not None and preferences.daily_reset_time else '00:00'
    )
    try:
        PreferenceService().update_day_boundary(user.id, data['timezone'], reset)
    except (TypeError, ValueError):
        db.session.rollback()
        return error_response(422, 'validation_error', 'Send one valid time zone.', field_errors={'timezone': ['Choose a valid time zone.']})
    return jsonify({'success': True, 'timezone': user.timezone})


@api_bp.route('/quick_add', methods=['POST'])
@quick_add_limit()
@login_required
def quick_add():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return _deprecated_quick_add_response(
            {'success': False, 'message': 'Missing pouch_id or quantity'},
            400,
        )
    pouch_id = data.get('pouch_id')
    quantity = data.get('quantity')

    if (
        isinstance(pouch_id, bool)
        or not isinstance(pouch_id, int)
        or pouch_id <= 0
        or isinstance(quantity, bool)
        or not isinstance(quantity, int)
        or not 1 <= quantity <= 100
    ):
        return _deprecated_quick_add_response(
            {'success': False, 'message': 'Missing pouch_id or quantity'},
            400,
        )
    if has_custom_product_input(
            data.get('custom_brand'), data.get('custom_nicotine_mg')):
        return _deprecated_quick_add_response(
            {
                'success': False,
                'message': (
                    'Cannot combine an existing pouch with custom product fields'
                ),
            },
            400,
        )

    user = get_current_user()
    instant = datetime.now(timezone.utc)
    resolved_timezone = resolve_timezone(user.timezone)
    payload = CreateLogInput(
        client_event_id=None,
        pouch_id=pouch_id,
        custom_product=None,
        quantity=quantity,
        occurred_at_utc=instant,
        occurred_at_local=instant.astimezone(resolved_timezone),
        timezone=resolved_timezone.zone,
        notes=None,
        craving_id=None,
    )
    try:
        result = LogService.create_idempotent(user.id, payload)
    except LogValidationError:
        return _deprecated_quick_add_response(
            {'success': False, 'message': 'Pouch not found'},
            404,
        )
    except Exception:
        db.session.rollback()
        logger.exception(
            'Legacy quick add failed before commit (request %s)',
            get_request_id(),
        )
        response = internal_error_response()
        response.headers['Deprecation'] = 'true'
        response.headers['Link'] = '</api/logs>; rel="successor-version"'
        return response

    strength = Decimal(result.log.nicotine_mg_snapshot)
    strength_display = format(strength.normalize(), 'f')
    message = (
        f"Added {quantity} {result.log.product_brand_snapshot} "
        f"({strength_display}mg)"
    )
    return _deprecated_quick_add_response(
        {'success': True, 'message': message},
        200,
    )


def _deprecated_quick_add_response(payload, status):
    response = jsonify(payload)
    response.status_code = status
    response.headers['Deprecation'] = 'true'
    response.headers['Link'] = '</api/logs>; rel="successor-version"'
    return response


@api_bp.route('/pouches', methods=['GET'])
@login_required
def get_pouches():
    pouches = get_all_pouches(get_current_user())
    pouches_data = [p.to_dict() for p in pouches]

    return jsonify({'success': True, 'pouches': pouches_data})


@api_bp.route('/brands', methods=['GET'])
@login_required
def get_brands():
    brands_query = db.session.execute(db.select(Pouch.brand).distinct()).all()
    brands = [b[0] for b in brands_query]
    return jsonify({'success': True, 'brands': brands})


@api_bp.route('/strengths/<brand>', methods=['GET'])
@login_required
def get_strengths(brand):
    strengths_query = db.session.execute(db.select(Pouch.nicotine_mg).where(Pouch.brand == brand).distinct()).all()
    # JSON numbers, not Decimal objects: the legacy API contract returns
    # numeric strengths (e.g. 4.0), and Numeric(8,2) values must not leak
    # into the JSON serializer as strings.
    strengths = [float(s[0]) for s in strengths_query]
    return jsonify({'success': True, 'strengths': strengths})
