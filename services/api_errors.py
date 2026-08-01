"""Shared JSON error contract for API-scoped failures.

Every new API endpoint failure and every app-level API 401/404/500/CSRF
failure returns exactly one envelope shape:

    {"error": {"code", "message", "field_errors", "retryable"}}

No stack traces, SQL, file paths, exception text, user identifiers, or
object-existence oracles ever appear. Request correlation stays in the
existing response header, not in the JSON body.
"""
from flask import jsonify


class ApiValidationError(Exception):
    """Validation failure carrying per-field recovery messages.

    ``field_errors`` maps stable field paths (for example
    ``structured_payload.stage_targets[0].end_date``) to a list of
    human-readable messages.
    """

    def __init__(self, field_errors, message='Check the highlighted fields and try again.'):
        super().__init__(message)
        self.field_errors = dict(field_errors)
        self.message = message


def error_response(status, code, message, *, field_errors=None,
                   retryable=False):
    """Build the canonical error envelope response."""
    payload = {
        'error': {
            'code': code,
            'message': message,
            'field_errors': dict(field_errors or {}),
            'retryable': bool(retryable),
        }
    }
    response = jsonify(payload)
    response.status_code = status
    return response


def authentication_required_response():
    return error_response(
        401, 'authentication_required',
        'Log in to continue.',
    )


def not_found_response():
    return error_response(
        404, 'not_found',
        'That resource does not exist.',
    )


def csrf_failed_response():
    return error_response(
        400, 'csrf_failed',
        'This request could not be verified. Refresh and try again.',
    )


def validation_error_response(exc):
    return error_response(
        422, 'validation_error',
        exc.message,
        field_errors=exc.field_errors,
    )


def plan_validation_error_response(field_errors):
    """Map domain schedule errors into the shared validation envelope."""
    normalized = {
        path: value if isinstance(value, list) else [value]
        for path, value in field_errors.items()
    }
    return error_response(
        422, 'validation_error',
        'Check the highlighted fields and try again.',
        field_errors=normalized,
    )


def preview_stale_response():
    return error_response(
        409, 'preview_stale',
        'This preview is stale. Refresh it and review the plan before creating it.',
    )


def active_plan_conflict_response():
    return error_response(
        409, 'active_plan_conflict',
        'An active plan already exists. Review it before creating another.',
    )


def invalid_plan_state_response():
    return error_response(
        409, 'invalid_plan_state',
        'That plan is not in a state that supports this action.',
    )


def internal_error_response():
    return error_response(
        500, 'internal_error',
        'Something went wrong on our end. Please try again later.',
        retryable=True,
    )
