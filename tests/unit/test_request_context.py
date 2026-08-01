"""Unit tests for services.request_context (Task 3)."""
import logging
import uuid
from uuid import UUID

import pytest

from services import request_context as rc


def make_record():
    return logging.LogRecord("unit", logging.INFO, __file__, 10, "msg", (), None)


class TestIsCanonicalUuid:
    def test_accepts_canonical_v4(self):
        assert rc.is_canonical_uuid(str(uuid.uuid4())) is True

    def test_accepts_canonical_v1(self):
        assert rc.is_canonical_uuid(str(uuid.uuid1())) is True

    @pytest.mark.parametrize(
        "value",
        [
            "",
            "not-a-uuid",
            "12345",
            str(uuid.uuid4()).upper(),
            "{%s}" % uuid.uuid4(),
            uuid.uuid4().hex,  # hex without dashes is parseable but not canonical
            None,
            123,
            b"6f1c2f4e-9e2b-4c0a-8b3d-1f2a3b4c5d6e",
        ],
    )
    def test_rejects_non_canonical(self, value):
        assert rc.is_canonical_uuid(value) is False


class TestResolveRequestId:
    def test_valid_candidate_returned_unchanged(self):
        candidate = str(uuid.uuid4())
        assert rc.resolve_request_id(candidate) == candidate

    def test_invalid_candidate_replaced_with_v4(self):
        resolved = rc.resolve_request_id("junk")
        assert resolved != "junk"
        assert UUID(resolved).version == 4

    def test_missing_candidate_generates_v4(self):
        assert UUID(rc.resolve_request_id(None)).version == 4

    def test_generated_ids_are_unique(self):
        assert rc.resolve_request_id(None) != rc.resolve_request_id(None)


class TestBindAndGet:
    def test_get_without_app_context_returns_fallback(self):
        assert rc.get_request_id() == rc.FALLBACK_REQUEST_ID

    def test_bind_generates_v4_when_missing(self, app):
        with app.app_context():
            request_id = rc.bind_request_id()
            assert UUID(request_id).version == 4
            assert rc.get_request_id() == request_id

    def test_bind_preserves_valid_candidate(self, app):
        candidate = str(uuid.uuid4())
        with app.app_context():
            assert rc.bind_request_id(candidate) == candidate
            assert rc.get_request_id() == candidate

    def test_bind_replaces_invalid_candidate(self, app):
        with app.app_context():
            request_id = rc.bind_request_id("junk")
            assert request_id != "junk"
            assert UUID(request_id).version == 4

    def test_get_lazy_binds_stable_id_within_context(self, app):
        with app.app_context():
            first = rc.get_request_id()
            assert UUID(first).version == 4
            assert rc.get_request_id() == first

    def test_background_contexts_generate_own_ids(self, app):
        """Two independent (background) app contexts never share an ID."""
        with app.app_context():
            first = rc.get_request_id()
        with app.app_context():
            second = rc.get_request_id()
        assert first != second


class TestRequestContextFilter:
    def test_filter_adds_bound_request_id(self, app):
        record = make_record()
        with app.app_context():
            bound = rc.bind_request_id()
            assert rc.RequestContextFilter().filter(record) is True
            assert record.request_id == bound

    def test_filter_uses_fallback_outside_context(self):
        record = make_record()
        assert rc.RequestContextFilter().filter(record) is True
        assert record.request_id == rc.FALLBACK_REQUEST_ID

    def test_records_passing_filter_carry_request_id(self, app, caplog):
        logger = logging.getLogger("tests.unit.request_context.filter")
        rc.attach_request_context_filter(logger)
        try:
            with caplog.at_level(logging.INFO, logger=logger.name):
                with app.app_context():
                    bound = rc.bind_request_id()
                    logger.info("hello from filter test")
        finally:
            logger.filters = [
                f for f in logger.filters
                if not isinstance(f, rc.RequestContextFilter)
            ]
        assert any(
            getattr(record, "request_id", None) == bound
            for record in caplog.records
        )


class TestAttachFilter:
    def test_attach_is_idempotent(self):
        logger = logging.getLogger("tests.unit.request_context.attach")
        try:
            rc.attach_request_context_filter(logger)
            rc.attach_request_context_filter(logger)
            ours = [
                f for f in logger.filters
                if isinstance(f, rc.RequestContextFilter)
            ]
            assert len(ours) == 1
        finally:
            logger.filters = [
                f for f in logger.filters
                if not isinstance(f, rc.RequestContextFilter)
            ]


class TestInitRequestContext:
    def test_init_attaches_single_filter_to_app_logger(self, app):
        # create_app already initialised once; repeated calls must not stack.
        rc.init_request_context(app)
        rc.init_request_context(app)
        ours = [
            f for f in app.logger.filters
            if isinstance(f, rc.RequestContextFilter)
        ]
        assert len(ours) == 1


class TestRecordFactory:
    """Central stamping: every record in the process gets a request_id at
    creation time, so named loggers whose records are only *propagated* to
    the root logger are covered as well."""

    def test_records_created_inside_context_carry_request_id(self, app):
        with app.app_context():
            bound = rc.bind_request_id()
            record = logging.getLogRecordFactory()(
                "unit.factory", logging.INFO, __file__, 1, "msg", (), None
            )
            assert record.request_id == bound

    def test_records_created_outside_context_use_fallback(self):
        # No app fixture: the conftest one yields inside a live app context,
        # which would mask the fallback path. Install explicitly instead.
        rc.install_record_factory()
        assert not rc.has_app_context()
        record = logging.getLogRecordFactory()(
            "unit.factory", logging.INFO, __file__, 1, "msg", (), None
        )
        assert record.request_id == rc.FALLBACK_REQUEST_ID
