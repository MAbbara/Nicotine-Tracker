"""Request correlation context.

Every incoming request gets a correlation ID: an inbound ``X-Request-ID``
header is kept only when it is a canonical UUID (``str(uuid.UUID(v)) == v``),
otherwise a fresh UUIDv4 is generated. The ID lives on Flask's application
context (``flask.g``), never in module-level mutable state, so concurrent
requests and background app contexts can never leak IDs into each other.

The ID is attached to application log records via :class:`RequestContextFilter`
and echoed back to clients in the ``X-Request-ID`` response header.
Background tasks running inside their own ``app.app_context()`` get their own
lazily generated correlation IDs.
"""
import logging
import uuid

from flask import current_app, g, has_app_context, request

REQUEST_ID_HEADER = "X-Request-ID"

#: Value used on log records emitted outside any application context, where
#: no correlation ID exists (e.g. interpreter startup).
FALLBACK_REQUEST_ID = "-"


def new_request_id():
    """Return a fresh random (version 4) request ID."""
    return str(uuid.uuid4())


def is_canonical_uuid(value):
    """True only for UUIDs in canonical ``8-4-4-4-12`` lowercase string form."""
    if not isinstance(value, str) or not value:
        return False
    try:
        parsed = uuid.UUID(value)
    except (ValueError, AttributeError, TypeError):
        return False
    return str(parsed) == value


def resolve_request_id(candidate=None):
    """Keep a valid inbound ID, otherwise generate a fresh UUIDv4."""
    if is_canonical_uuid(candidate):
        return candidate
    return new_request_id()


def bind_request_id(candidate=None):
    """Resolve and store the request ID on the current app context.

    Requires an active application context (requests always have one;
    background tasks should call this inside ``app.app_context()``).
    """
    request_id = resolve_request_id(candidate)
    g.request_id = request_id
    return request_id


def get_request_id():
    """Return the current correlation ID.

    Inside an application context this lazily binds a fresh UUIDv4 on first
    use and stays stable for the rest of the context; outside any context it
    returns :data:`FALLBACK_REQUEST_ID` so logging never crashes.
    """
    if has_app_context():
        request_id = g.get("request_id", None)
        if request_id is None:
            request_id = bind_request_id()
        return request_id
    return FALLBACK_REQUEST_ID


class RequestContextFilter(logging.Filter):
    """Stamp every log record with the current correlation ID."""

    def filter(self, record):
        record.request_id = get_request_id()
        return True


def attach_request_context_filter(target):
    """Attach the filter to a logger or handler, at most once."""
    if not any(isinstance(existing, RequestContextFilter) for existing in target.filters):
        target.addFilter(RequestContextFilter())


_record_factory_installed = False


def install_record_factory():
    """Stamp every LogRecord with the correlation ID at creation time.

    Logger-attached filters never run for records that are only *propagated*
    through a logger, so named loggers (e.g. ``background_tasks``) would
    otherwise emit records without ``request_id``. A log-record factory is
    the single central hook that runs for every record in the process,
    regardless of which logger emitted it. Chains any pre-existing factory
    and installs at most once. The ID itself still lives on ``flask.g``;
    this installs no per-request mutable state.
    """
    global _record_factory_installed
    if _record_factory_installed:
        return
    previous_factory = logging.getLogRecordFactory()

    def request_context_record_factory(*args, **kwargs):
        record = previous_factory(*args, **kwargs)
        record.request_id = get_request_id()
        return record

    logging.setLogRecordFactory(request_context_record_factory)
    _record_factory_installed = True


def init_request_context(app):
    """Wire correlation IDs into a Flask app.

    - before request: resolve the inbound header into ``g.request_id``
    - after request: echo ``g.request_id`` in the response header
    - stamp all log records centrally via a log-record factory, and attach
      :class:`RequestContextFilter` to the app and root loggers

    The header name defaults to ``X-Request-ID`` and can be overridden with
    the ``REQUEST_ID_HEADER`` config key. Safe to call more than once.
    """
    install_record_factory()
    attach_request_context_filter(app.logger)
    attach_request_context_filter(logging.getLogger())

    if app.extensions.get("request_context"):
        return
    app.extensions["request_context"] = True

    @app.before_request
    def _bind_incoming_request_id():
        header_name = current_app.config.get("REQUEST_ID_HEADER", REQUEST_ID_HEADER)
        bind_request_id(request.headers.get(header_name))

    @app.after_request
    def _echo_request_id(response):
        header_name = current_app.config.get("REQUEST_ID_HEADER", REQUEST_ID_HEADER)
        response.headers[header_name] = get_request_id()
        return response
