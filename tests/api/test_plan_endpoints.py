"""Contracts for the shared API error envelope and baseline-suggestion read.

Task 5A slice: envelope, API-scoped 401/404/CSRF behavior, and
GET /api/baseline-suggestion serialization.
"""
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import json
import sqlite3

import pytest

from extensions import db
from models import (
    Log, OnboardingDraft, PlanDay, PlanRevision, PlanStatusEvent,
    ReductionPlan, User,
)
from services import log_service
from services.plan_schedule import PlanGenerationInput, PlanScheduleGenerator
from services.plan_service import PlanService
from sqlalchemy.exc import OperationalError


def _plan_payload(**overrides):
    payload = {
        'mode': 'reduce',
        'baseline_source': 'manual',
        'baseline_pouches': '8',
        'baseline_mg': '48',
        'baseline_mg_per_pouch': '6',
        'pace': 'steady',
        'start_date': '2099-01-01',
        'target_date': None,
        'duration_days': None,
        'end_target_pouches': 2,
        'stage_targets': None,
    }
    payload.update(overrides)
    return payload


def _create_payload(**overrides):
    payload = _plan_payload(preview_digest='0' * 64, activation='draft')
    payload.update(overrides)
    return payload


def _assert_error_envelope(response, status, code, retryable=False):
    assert response.status_code == status
    payload = response.get_json()
    assert set(payload.keys()) == {'error'}
    error = payload['error']
    assert set(error.keys()) == {'code', 'message', 'field_errors', 'retryable'}
    assert error['code'] == code
    assert isinstance(error['message'], str) and error['message']
    assert isinstance(error['field_errors'], dict)
    assert error['retryable'] is retryable
    return error


def _seed_complete_days(db_session, user, pouch, days, quantity=10):
    """Create one complete logged day per offset ending yesterday (UTC)."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    for offset in range(1, days + 1):
        day = (now - timedelta(days=offset)).replace(hour=12, minute=0,
                                                     second=0, microsecond=0)
        log = Log(user_id=user.id, quantity=quantity, log_time=day)
        log_service.assign_log_product(log, pouch_id=pouch.id)
        db_session.add(log)
    db_session.commit()


class TestApiErrorEnvelope:
    def test_unauthenticated_api_request_returns_401_envelope(self, client):
        response = client.get('/api/baseline-suggestion')
        error = _assert_error_envelope(
            response, 401, 'authentication_required'
        )
        assert 'log' in error['message'].lower() or 'sign' in error['message'].lower()
        # No oracle keys from the legacy shape may leak through.
        assert 'success' not in response.get_json()
        assert 'request_id' not in response.get_json()['error']

    def test_stale_api_session_returns_401_envelope(self, client):
        with client.session_transaction() as session:
            session['user_id'] = 999999
        response = client.get('/api/baseline-suggestion')
        _assert_error_envelope(
            response, 401, 'authentication_required'
        )

    def test_stale_html_session_still_redirects_to_login(self, client):
        with client.session_transaction() as session:
            session['user_id'] = 999999
        response = client.get('/log/add')
        assert response.status_code == 302
        assert '/auth/login' in response.headers['Location']

    def test_unauthenticated_html_route_still_redirects(self, client):
        response = client.get('/log/add')
        assert response.status_code == 302
        assert '/auth/login' in response.headers['Location']

    def test_api_404_uses_envelope(self, logged_in_client):
        response = logged_in_client.get('/api/no-such-resource')
        _assert_error_envelope(response, 404, 'not_found')

    def test_html_404_still_renders_page(self, logged_in_client):
        response = logged_in_client.get('/no-such-page')
        assert response.status_code == 404
        assert response.content_type.startswith('text/html')

    def test_api_500_uses_envelope_and_is_retryable(
            self, logged_in_client, monkeypatch):
        from services import baseline_service

        def boom(user_id):
            raise RuntimeError('synthetic failure with /path/secret and SQL')

        monkeypatch.setattr(
            baseline_service.BaselineService, 'suggest', staticmethod(boom)
        )
        response = logged_in_client.get('/api/baseline-suggestion')
        error = _assert_error_envelope(
            response, 500, 'internal_error', retryable=True
        )
        for forbidden in ('/path/secret', 'SQL', 'synthetic', 'Traceback'):
            assert forbidden not in error['message']


class TestBaselineSuggestion:
    def test_available_baseline_serializes_fixed_decimals(
            self, logged_in_client, db_session, test_user, test_pouch):
        _seed_complete_days(db_session, test_user, test_pouch, days=5,
                            quantity=10)
        response = logged_in_client.get('/api/baseline-suggestion')
        assert response.status_code == 200
        payload = response.get_json()
        assert set(payload.keys()) == {'baseline'}
        baseline = payload['baseline']
        assert baseline['available'] is True
        assert baseline['pouches_per_day'] == '10.00'
        assert baseline['nicotine_mg_per_day'] == '40.00'
        assert baseline['median_mg_per_pouch'] == '4.00'
        assert baseline['logged_days_used'] == 5
        assert baseline['reason'] is None
        # Window: 14 completed local days ending yesterday.
        today = datetime.now(timezone.utc).date()
        assert baseline['window_end'] == (today - timedelta(days=1)).isoformat()
        assert baseline['window_start'] == (today - timedelta(days=14)).isoformat()

    def test_unavailable_baseline_reports_stable_reason(
            self, logged_in_client, db_session, test_user, test_pouch):
        _seed_complete_days(db_session, test_user, test_pouch, days=1)
        response = logged_in_client.get('/api/baseline-suggestion')
        assert response.status_code == 200
        baseline = response.get_json()['baseline']
        assert baseline['available'] is False
        assert baseline['reason'] == 'insufficient_data'
        assert baseline['pouches_per_day'] is None
        assert baseline['nicotine_mg_per_day'] is None
        assert baseline['median_mg_per_pouch'] is None

    def test_unknown_strength_reason_when_snapshot_missing(
            self, logged_in_client, db_session, test_user):
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        for offset in range(1, 5):
            day = (now - timedelta(days=offset)).replace(
                hour=12, minute=0, second=0, microsecond=0)
            db_session.add(Log(user_id=test_user.id, quantity=5,
                               log_time=day))
        db_session.commit()
        response = logged_in_client.get('/api/baseline-suggestion')
        baseline = response.get_json()['baseline']
        assert baseline['available'] is False
        assert baseline['reason'] == 'unknown_strength'

    def test_unknown_query_parameter_rejected(self, logged_in_client):
        response = logged_in_client.get('/api/baseline-suggestion?days=30')
        error = _assert_error_envelope(response, 422, 'validation_error')
        assert 'days' in error['field_errors']

    def test_baseline_is_read_only(
            self, logged_in_client, db_session, test_user, test_pouch):
        _seed_complete_days(db_session, test_user, test_pouch, days=5)
        before = Log.query.filter_by(user_id=test_user.id).count()
        response = logged_in_client.get('/api/baseline-suggestion')
        assert response.status_code == 200
        assert Log.query.filter_by(user_id=test_user.id).count() == before

    def test_other_users_logs_never_influence_baseline(
            self, logged_in_client, db_session, test_user):
        other = User(email='other@example.com', email_verified=True,
                     timezone='UTC')
        other.set_password('password123')
        db_session.add(other)
        db_session.commit()
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        for offset in range(1, 8):
            day = (now - timedelta(days=offset)).replace(
                hour=12, minute=0, second=0, microsecond=0)
            db_session.add(Log(user_id=other.id, quantity=20, log_time=day,
                               nicotine_mg_snapshot=Decimal('6.00'),
                               product_brand_snapshot='Other'))
        db_session.commit()
        response = logged_in_client.get('/api/baseline-suggestion')
        baseline = response.get_json()['baseline']
        assert baseline['available'] is False
        assert baseline['reason'] == 'insufficient_data'
        assert baseline['logged_days_used'] == 0


class TestInitialPlanPreviewAndCreate:
    def test_preview_reduce_is_canonical_and_read_only(
            self, logged_in_client, db_session, test_user):
        before = {
            'plans': ReductionPlan.query.count(),
            'revisions': PlanRevision.query.count(),
            'days': PlanDay.query.count(),
            'events': PlanStatusEvent.query.count(),
            'drafts': OnboardingDraft.query.count(),
        }
        response = logged_in_client.post(
            '/api/plans/preview', json=_plan_payload())
        assert response.status_code == 200
        payload = response.get_json()
        assert set(payload) == {'preview_digest', 'normalized_input', 'stages', 'days'}
        assert len(payload['preview_digest']) == 64
        assert payload['normalized_input'] == {
            'mode': 'reduce',
            'baseline_source': 'manual',
            'baseline_pouches': '8.00',
            'baseline_mg': '48.00',
            'baseline_mg_per_pouch': '6.00',
            'pace': 'steady',
            'start_date': '2099-01-01',
            'target_date': '2099-02-18',
            'duration_days': 49,
            'end_target_pouches': 2,
            'stage_targets': None,
        }
        assert len(payload['stages']) == 7
        assert len(payload['days']) == 49
        assert payload['days'][0] == {
            'local_date': '2099-01-01',
            'target_pouches': 8,
            'nicotine_ceiling_mg': '48.00',
        }
        assert payload['days'][-1]['local_date'] == '2099-02-18'
        assert {
            'plans': ReductionPlan.query.count(),
            'revisions': PlanRevision.query.count(),
            'days': PlanDay.query.count(),
            'events': PlanStatusEvent.query.count(),
            'drafts': OnboardingDraft.query.count(),
        } == before

    def test_preview_observe_has_null_targets_and_derived_window(
            self, logged_in_client):
        body = {
            'mode': 'observe',
            'baseline_source': 'observe',
            'baseline_pouches': None,
            'baseline_mg': None,
            'baseline_mg_per_pouch': None,
            'pace': None,
            'start_date': '2099-01-01',
            'target_date': None,
            'duration_days': None,
            'end_target_pouches': None,
            'stage_targets': None,
        }
        response = logged_in_client.post('/api/plans/preview', json=body)
        assert response.status_code == 200
        payload = response.get_json()
        assert payload['normalized_input']['duration_days'] == 7
        assert payload['normalized_input']['target_date'] == '2099-01-07'
        assert payload['stages'] == []
        assert len(payload['days']) == 7
        assert all(day['target_pouches'] is None for day in payload['days'])
        assert all(day['nicotine_ceiling_mg'] is None for day in payload['days'])

    def test_preview_quit_by_date_is_canonical(self, logged_in_client):
        response = logged_in_client.post('/api/plans/preview', json=_plan_payload(
            mode='quit_by_date',
            pace='focused',
            target_date='2099-01-28',
            duration_days=28,
            end_target_pouches=0,
        ))
        assert response.status_code == 200
        payload = response.get_json()
        assert payload['normalized_input']['mode'] == 'quit_by_date'
        assert payload['normalized_input']['target_date'] == '2099-01-28'
        assert payload['normalized_input']['duration_days'] == 28
        assert payload['days'][-1]['target_pouches'] == 0

    def test_preview_explicit_stages_normalizes_and_preserves_stage_input(
            self, logged_in_client):
        response = logged_in_client.post('/api/plans/preview', json=_plan_payload(
            baseline_pouches='8.00',
            baseline_mg='48.00',
            baseline_mg_per_pouch='6.00',
            pace='focused',
            start_date='2099-01-01',
            target_date='2099-01-21',
            duration_days=21,
            end_target_pouches=0,
            stage_targets=[
                {'start_date': '2099-01-01', 'end_date': '2099-01-14',
                 'target_pouches': 8, 'nicotine_ceiling_mg': '48'},
                {'start_date': '2099-01-15', 'end_date': '2099-01-21',
                 'target_pouches': 0, 'nicotine_ceiling_mg': '0.00'},
            ],
        ))
        assert response.status_code == 200
        payload = response.get_json()
        assert payload['normalized_input']['duration_days'] == 21
        assert payload['normalized_input']['stage_targets'][1] == {
            'start_date': '2099-01-15', 'end_date': '2099-01-21',
            'target_pouches': 0, 'nicotine_ceiling_mg': '0.00',
        }
        assert payload['stages'] == payload['normalized_input']['stage_targets']
        assert payload['days'][-1]['target_pouches'] == 0

    def test_preview_rejects_unknown_missing_and_type_errors(
            self, logged_in_client):
        invalid = _plan_payload(extra='nope')
        response = logged_in_client.post('/api/plans/preview', json=invalid)
        error = _assert_error_envelope(response, 422, 'validation_error')
        assert 'extra' in error['field_errors']

        missing = _plan_payload()
        del missing['baseline_mg']
        response = logged_in_client.post('/api/plans/preview', json=missing)
        error = _assert_error_envelope(response, 422, 'validation_error')
        assert 'baseline_mg' in error['field_errors']

        bad = _plan_payload(
            baseline_pouches=8,
            duration_days=True,
            baseline_mg='NaN',
        )
        response = logged_in_client.post('/api/plans/preview', json=bad)
        error = _assert_error_envelope(response, 422, 'validation_error')
        assert {'baseline_pouches', 'duration_days', 'baseline_mg'} <= set(
            error['field_errors'])

    def test_preview_rejects_observe_date_overflow_without_writes(
            self, logged_in_client):
        before = {
            'plans': ReductionPlan.query.count(),
            'revisions': PlanRevision.query.count(),
            'days': PlanDay.query.count(),
            'events': PlanStatusEvent.query.count(),
        }
        body = {
            'mode': 'observe',
            'baseline_source': 'observe',
            'baseline_pouches': None,
            'baseline_mg': None,
            'baseline_mg_per_pouch': None,
            'pace': None,
            'start_date': '9999-12-31',
            'target_date': None,
            'duration_days': None,
            'end_target_pouches': None,
            'stage_targets': None,
        }
        response = logged_in_client.post('/api/plans/preview', json=body)
        error = _assert_error_envelope(response, 422, 'validation_error')
        assert 'start_date' in error['field_errors']

        body['target_date'] = '9999-12-31'
        response = logged_in_client.post('/api/plans/preview', json=body)
        error = _assert_error_envelope(response, 422, 'validation_error')
        assert 'start_date' in error['field_errors']
        assert {
            'plans': ReductionPlan.query.count(),
            'revisions': PlanRevision.query.count(),
            'days': PlanDay.query.count(),
            'events': PlanStatusEvent.query.count(),
        } == before

    def test_preview_rejects_targeted_date_overflow(self, logged_in_client):
        response = logged_in_client.post('/api/plans/preview', json=_plan_payload(
            start_date='9999-12-31', duration_days=49,
        ))
        error = _assert_error_envelope(response, 422, 'validation_error')
        assert 'start_date' in error['field_errors']

    def test_preview_rejects_generated_ceiling_above_storage_bound(
            self, logged_in_client):
        response = logged_in_client.post('/api/plans/preview', json=_plan_payload(
            baseline_pouches='2.00',
            baseline_mg='999999.99',
            baseline_mg_per_pouch='999999.99',
            end_target_pouches=1,
        ))
        error = _assert_error_envelope(response, 422, 'validation_error')
        assert 'baseline_mg_per_pouch' in error['field_errors']

    def test_preview_internal_failure_is_read_only(
            self, logged_in_client, monkeypatch):
        from routes import api as api_routes

        before = {
            'plans': ReductionPlan.query.count(),
            'revisions': PlanRevision.query.count(),
            'days': PlanDay.query.count(),
            'events': PlanStatusEvent.query.count(),
            'drafts': OnboardingDraft.query.count(),
        }

        def fail_preview(*args, **kwargs):
            raise RuntimeError('synthetic preview failure')

        monkeypatch.setattr(
            api_routes.PlanService, 'preview_initial',
            staticmethod(fail_preview),
        )
        response = logged_in_client.post(
            '/api/plans/preview', json=_plan_payload())
        _assert_error_envelope(
            response, 500, 'internal_error', retryable=True
        )
        assert {
            'plans': ReductionPlan.query.count(),
            'revisions': PlanRevision.query.count(),
            'days': PlanDay.query.count(),
            'events': PlanStatusEvent.query.count(),
            'drafts': OnboardingDraft.query.count(),
        } == before

    def test_create_draft_returns_canonical_plan_and_deletes_own_draft(
            self, logged_in_client, db_session, test_user):
        preview = logged_in_client.post(
            '/api/plans/preview', json=_plan_payload()).get_json()
        db_session.add(OnboardingDraft(
            user_id=test_user.id,
            current_step='review',
            structured_payload={'intention': 'reduce'},
        ))
        other = User(email='other-plan@example.com', email_verified=True,
                     timezone='UTC')
        other.set_password('password123')
        db_session.add(other)
        db_session.flush()
        db_session.add(OnboardingDraft(
            user_id=other.id,
            current_step='review',
            structured_payload={'intention': 'observe'},
        ))
        db_session.commit()
        response = logged_in_client.post('/api/plans', json=_create_payload(
            preview_digest=preview['preview_digest']))
        assert response.status_code == 201
        payload = response.get_json()
        assert set(payload) == {'plan', 'created'}
        assert payload['created'] is True
        plan = payload['plan']
        assert set(plan) == {
            'id', 'mode', 'status', 'start_date', 'target_date',
            'baseline_source', 'baseline_pouches', 'baseline_mg',
            'baseline_mg_per_pouch', 'pace', 'end_target_pouches',
            'active_revision_id', 'created_at', 'updated_at', 'days',
            'revisions', 'status_events',
        }
        assert plan['status'] == 'draft'
        assert plan['baseline_pouches'] == '8.00'
        assert plan['days'][0]['nicotine_ceiling_mg'] == '48.00'
        assert plan['revisions'][0]['generation_inputs']['duration_days'] == 49
        assert plan['status_events'] == []
        assert OnboardingDraft.query.filter_by(user_id=test_user.id).count() == 0
        assert OnboardingDraft.query.filter_by(user_id=other.id).count() == 1

    def test_create_serialization_failure_is_atomic(
            self, logged_in_client, db_session, test_user, monkeypatch):
        from routes import api as api_routes

        preview = logged_in_client.post(
            '/api/plans/preview', json=_plan_payload()).get_json()
        other = User(email='other-atomic@example.com', email_verified=True,
                     timezone='UTC')
        other.set_password('password123')
        db_session.add(other)
        db_session.flush()
        db_session.add_all([
            OnboardingDraft(
                user_id=test_user.id,
                current_step='review',
                structured_payload={'intention': 'reduce'},
            ),
            OnboardingDraft(
                user_id=other.id,
                current_step='review',
                structured_payload={'intention': 'observe'},
            ),
        ])
        db_session.commit()

        rollback_calls = []
        original_rollback = db.session.rollback

        def tracked_rollback():
            rollback_calls.append(True)
            return original_rollback()

        def failed_serializer(plan):
            assert PlanDay.query.filter_by(plan_id=plan.id).count() > 0
            raise RuntimeError('synthetic serialization failure')

        monkeypatch.setattr(db.session, 'rollback', tracked_rollback)
        monkeypatch.setattr(api_routes, 'serialize_plan', failed_serializer)

        response = logged_in_client.post('/api/plans', json=_create_payload(
            preview_digest=preview['preview_digest']))
        _assert_error_envelope(
            response, 500, 'internal_error', retryable=True
        )
        assert rollback_calls == [True]
        assert ReductionPlan.query.filter_by(user_id=test_user.id).count() == 0
        assert PlanRevision.query.count() == 0
        assert PlanDay.query.count() == 0
        assert PlanStatusEvent.query.count() == 0
        assert OnboardingDraft.query.filter_by(user_id=test_user.id).count() == 1
        assert OnboardingDraft.query.filter_by(user_id=other.id).count() == 1

    def test_create_activate_and_conflict_or_stale_are_atomic(
            self, logged_in_client, db_session, test_user):
        preview = logged_in_client.post(
            '/api/plans/preview', json=_plan_payload()).get_json()
        db_session.add(OnboardingDraft(
            user_id=test_user.id,
            current_step='review',
            structured_payload={'intention': 'reduce'},
        ))
        db_session.commit()
        stale = logged_in_client.post('/api/plans', json=_create_payload(
            preview_digest='f' * 64, activation='activate'))
        _assert_error_envelope(stale, 409, 'preview_stale')
        assert ReductionPlan.query.filter_by(user_id=test_user.id).count() == 0
        assert OnboardingDraft.query.filter_by(user_id=test_user.id).count() == 1

        created = logged_in_client.post('/api/plans', json=_create_payload(
            preview_digest=preview['preview_digest'], activation='activate'))
        assert created.status_code == 201
        assert created.get_json()['plan']['status'] == 'active'
        assert len(created.get_json()['plan']['status_events']) == 1
        assert OnboardingDraft.query.filter_by(user_id=test_user.id).count() == 0

        conflict = logged_in_client.post('/api/plans', json=_create_payload(
            preview_digest=preview['preview_digest'], activation='activate'))
        _assert_error_envelope(conflict, 409, 'active_plan_conflict')
        assert ReductionPlan.query.filter_by(user_id=test_user.id).count() == 1


def _active_plan_for_lifecycle(db_session, test_user):
    generation_input = PlanGenerationInput(
        mode='reduce',
        start_date=date(2099, 1, 1),
        baseline_pouches=Decimal('8.00'),
        baseline_mg=Decimal('48.00'),
        baseline_mg_per_pouch=Decimal('6.00'),
        pace='steady',
        end_target_pouches=2,
    )
    preview = PlanScheduleGenerator.generate(generation_input)
    return PlanService.create_from_preview(
        test_user.id, generation_input, 'manual', preview.digest, 'activate'
    )


def _lifecycle_graph(user_id):
    plans = ReductionPlan.query.filter_by(user_id=user_id).order_by(
        ReductionPlan.id).all()
    plan_ids = [plan.id for plan in plans]
    revisions = PlanRevision.query.filter(
        PlanRevision.plan_id.in_(plan_ids)
    ).order_by(PlanRevision.id).all() if plan_ids else []
    days = PlanDay.query.filter(
        PlanDay.plan_id.in_(plan_ids)
    ).order_by(PlanDay.id).all() if plan_ids else []
    events = PlanStatusEvent.query.filter(
        PlanStatusEvent.plan_id.in_(plan_ids)
    ).order_by(PlanStatusEvent.id).all() if plan_ids else []
    drafts = OnboardingDraft.query.filter_by(user_id=user_id).order_by(
        OnboardingDraft.id).all()
    def canonical_json(value):
        if value is None:
            return None
        return json.dumps(value, ensure_ascii=False, sort_keys=True,
                          separators=(',', ':'))

    def iso(value):
        return None if value is None else value.isoformat()

    def decimal(value):
        return None if value is None else str(value)

    return {
        'plans': [(
            plan.id, plan.user_id, plan.mode, plan.status,
            iso(plan.start_date), iso(plan.target_date),
            decimal(plan.baseline_pouches), decimal(plan.baseline_mg),
            decimal(plan.baseline_mg_per_pouch), plan.baseline_source,
            plan.pace, plan.end_target_pouches, plan.active_revision_id,
            plan.active_slot, plan.migration_fingerprint,
            canonical_json(plan.legacy_goal_ids), iso(plan.created_at),
            iso(plan.updated_at),
        ) for plan in plans],
        'revisions': [(
            row.id, row.plan_id, iso(row.effective_date), row.pace,
            iso(row.target_date), row.end_target_pouches,
            canonical_json(row.generation_inputs), row.preview_digest,
            row.reason, row.note, iso(row.created_at),
        ) for row in revisions],
        'days': [(
            row.id, row.plan_id, row.revision_id, iso(row.local_date),
            row.target_pouches, decimal(row.nicotine_ceiling_mg),
            iso(row.created_at),
        ) for row in days],
        'events': [(
            row.id, row.plan_id, row.status, iso(row.effective_at_utc),
            iso(row.local_date), row.reason, iso(row.created_at),
        ) for row in events],
        'drafts': [(
            row.id, row.user_id, row.current_step,
            canonical_json(row.structured_payload), iso(row.created_at),
            iso(row.updated_at),
        ) for row in drafts],
    }


class TestPlanLifecycleApi:
    @pytest.mark.parametrize('body,path', [
        ({'effective_date': '2099-01-15'}, 'changes'),
        ({'effective_date': '2099-01-15', 'changes': None}, 'changes'),
        ({'effective_date': '2099-01-15', 'changes': {}}, 'changes'),
        ({'effective_date': '2099-01-15', 'changes': []}, 'changes'),
        ({'effective_date': '2099-01-15', 'changes': 'pace'}, 'changes'),
        ({'effective_date': '2099-01-15', 'unexpected': 1,
          'changes': {'pace': 'gentle'}}, 'unexpected'),
        ({'effective_date': None, 'changes': {'pace': 'gentle'}},
         'effective_date'),
        ({'effective_date': '2099-01-15', 'changes': {'pace': True}},
         'changes.pace'),
        ({'effective_date': '2099-01-15',
          'changes': {'duration_days': None}}, 'changes.duration_days'),
        ({'effective_date': '2099-01-15',
          'changes': {'duration_days': True}}, 'changes.duration_days'),
        ({'effective_date': '2099-01-15',
          'changes': {'duration_days': 0}}, 'changes.duration_days'),
        ({'effective_date': '2099-01-15',
          'changes': {'duration_days': 366}}, 'changes.duration_days'),
        ({'effective_date': '2099-01-15',
          'changes': {'end_target_pouches': None}},
         'changes.end_target_pouches'),
        ({'effective_date': '2099-01-15',
          'changes': {'end_target_pouches': True}},
         'changes.end_target_pouches'),
        ({'effective_date': '2099-01-15',
          'changes': {'end_target_pouches': -1}},
         'changes.end_target_pouches'),
        ({'effective_date': '2099-01-15',
          'changes': {'end_target_pouches': 1001}},
         'changes.end_target_pouches'),
        ({'effective_date': '2099-01-15', 'changes': {'notes': 'free text'}},
         'changes.notes'),
        ({'effective_date': '2099-01-15', 'changes': {
            'stage_targets': [{'start_date': '2099-01-01',
                               'end_date': '2099-01-02', 'target_pouches': 8,
                               'nicotine_ceiling_mg': '48', 'label': 'x'}],
        }}, 'changes.stage_targets[0].label'),
    ])
    def test_revision_preview_nested_rejection_matrix(
            self, logged_in_client, body, path):
        response = logged_in_client.post(
            '/api/plans/1/revisions/preview', json=body)
        error = _assert_error_envelope(response, 422, 'validation_error')
        assert path in error['field_errors']

    @pytest.mark.parametrize('body,path', [
        ({'effective_date': '2099-01-15', 'changes': {'pace': 'gentle'},
          'preview_digest': 'A' * 64, 'reason': 'user_edit', 'note': None},
         'preview_digest'),
        ({'effective_date': '2099-01-15', 'changes': {'pace': 'gentle'},
          'preview_digest': '0' * 64, 'reason': 'nope', 'note': None},
         'reason'),
        ({'effective_date': '2099-01-15', 'changes': {'pace': 'gentle'},
          'preview_digest': '0' * 64, 'reason': 'user_edit', 'note': 3},
         'note'),
        ({'effective_date': '2099-01-15', 'changes': {'pace': 'gentle'},
          'preview_digest': '0' * 64, 'reason': 'user_edit',
          'note': 'x' * 2001}, 'note'),
    ])
    def test_revision_apply_rejection_matrix(
            self, logged_in_client, body, path):
        response = logged_in_client.post('/api/plans/1/revisions', json=body)
        error = _assert_error_envelope(response, 422, 'validation_error')
        assert path in error['field_errors']

    @pytest.mark.parametrize('path,body,field', [
        ('/api/plans/1/pause', {'unknown': 1}, 'unknown'),
        ('/api/plans/1/pause', {'reason': False}, 'reason'),
        ('/api/plans/1/pause', {'reason': 'x' * 256}, 'reason'),
        ('/api/plans/1/resume/preview', {'resume_date': None}, 'resume_date'),
        ('/api/plans/1/resume/preview', {'resume_date': True}, 'resume_date'),
        ('/api/plans/1/resume/preview', {
            'resume_date': '2099-03-01', 'unknown': 1,
        }, 'unknown'),
        ('/api/plans/1/resume', {
            'resume_date': '2099-03-01', 'preview_digest': 'Z' * 64,
        }, 'preview_digest'),
        ('/api/plans/1/resume', {
            'resume_date': '2099-03-01', 'preview_digest': '0' * 64,
            'unknown': 1,
        }, 'unknown'),
    ])
    def test_pause_resume_rejection_matrix(
            self, logged_in_client, path, body, field):
        response = logged_in_client.post(path, json=body)
        error = _assert_error_envelope(response, 422, 'validation_error')
        assert field in error['field_errors']

    def test_revision_preview_and_apply_canonical_response(
            self, logged_in_client, db_session, test_user):
        plan = _active_plan_for_lifecycle(db_session, test_user)
        before = {
            'revisions': PlanRevision.query.count(),
            'days': PlanDay.query.count(),
            'events': PlanStatusEvent.query.count(),
        }
        preview_response = logged_in_client.post(
            f'/api/plans/{plan.id}/revisions/preview', json={
                'effective_date': '2099-01-15',
                'changes': {
                    'pace': 'gentle',
                    'duration_days': 70,
                    'end_target_pouches': 1,
                },
            })
        assert preview_response.status_code == 200
        preview = preview_response.get_json()
        assert set(preview) == {
            'preview_digest', 'effective_date', 'stages', 'days'
        }
        assert preview['effective_date'] == '2099-01-15'
        assert len(preview['days']) == 70
        assert {
            'revisions': PlanRevision.query.count(),
            'days': PlanDay.query.count(),
            'events': PlanStatusEvent.query.count(),
        } == before

        apply_response = logged_in_client.post(
            f'/api/plans/{plan.id}/revisions', json={
                'effective_date': '2099-01-15',
                'changes': {
                    'pace': 'gentle',
                    'duration_days': 70,
                    'end_target_pouches': 1,
                },
                'preview_digest': preview['preview_digest'],
                'reason': 'user_edit',
                'note': '  Adjusting the pace  ',
            })
        assert apply_response.status_code == 200
        body = apply_response.get_json()
        assert set(body) == {'plan', 'updated'}
        assert body['updated'] is True
        assert body['plan']['target_date'] == '2099-03-25'
        assert body['plan']['revisions'][-1]['note'] == 'Adjusting the pace'

    @pytest.mark.parametrize('changes', [
        {'pace': 'focused', 'stage_targets': None},
        {
            'pace': 'focused',
            'end_target_pouches': 0,
            'stage_targets': [
                {
                    'start_date': '2099-01-15',
                    'end_date': '2099-01-20',
                    'target_pouches': 7,
                    'nicotine_ceiling_mg': '42.00',
                },
                {
                    'start_date': '2099-01-21',
                    'end_date': '2099-02-18',
                    'target_pouches': 0,
                    'nicotine_ceiling_mg': '0.00',
                },
            ],
        },
    ])
    def test_revision_stage_targets_null_and_zero_are_valid(
            self, logged_in_client, db_session, test_user, changes):
        plan = _active_plan_for_lifecycle(db_session, test_user)
        response = logged_in_client.post(
            f'/api/plans/{plan.id}/revisions/preview', json={
                'effective_date': '2099-01-15',
                'changes': changes,
            })
        assert response.status_code == 200
        payload = response.get_json()
        assert set(payload) == {
            'preview_digest', 'effective_date', 'stages', 'days'
        }
        assert payload['effective_date'] == '2099-01-15'
        if changes.get('stage_targets') is not None:
            assert payload['stages'][-1]['target_pouches'] == 0
            assert payload['stages'][-1]['nicotine_ceiling_mg'] == '0.00'
            assert payload['days'][-1]['target_pouches'] == 0
            assert payload['days'][-1]['nicotine_ceiling_mg'] == '0.00'

    def test_revision_parser_rejects_unknown_fields(self, logged_in_client):
        response = logged_in_client.post(
            '/api/plans/1/revisions/preview', json={
                'effective_date': '2099-01-15',
                'changes': {'notes': 'free text'},
            })
        error = _assert_error_envelope(response, 422, 'validation_error')
        assert 'changes.notes' in error['field_errors']

    def test_pause_and_resume_round_trip(self, logged_in_client,
                                         db_session, test_user):
        plan = _active_plan_for_lifecycle(db_session, test_user)
        paused = logged_in_client.post(
            f'/api/plans/{plan.id}/pause', json={'reason': '  break  '})
        assert paused.status_code == 200
        pause_body = paused.get_json()
        assert pause_body['paused'] is True
        assert pause_body['plan']['status'] == 'paused'
        assert pause_body['plan']['status_events'][-1]['reason'] == 'break'

        preview_response = logged_in_client.post(
            f'/api/plans/{plan.id}/resume/preview', json={
                'resume_date': '2099-03-01',
            })
        assert preview_response.status_code == 200
        preview = preview_response.get_json()
        assert preview['resume_date'] == '2099-03-01'
        assert preview['days']

        resumed = logged_in_client.post(
            f'/api/plans/{plan.id}/resume', json={
                'resume_date': '2099-03-01',
                'preview_digest': preview['preview_digest'],
            })
        assert resumed.status_code == 200
        resumed_body = resumed.get_json()
        assert resumed_body['resumed'] is True
        assert resumed_body['plan']['status'] == 'active'

    def test_resume_preview_date_overflow_is_validation_error(
            self, logged_in_client, db_session, test_user):
        plan = _active_plan_for_lifecycle(db_session, test_user)
        logged_in_client.post(f'/api/plans/{plan.id}/pause')
        response = logged_in_client.post(
            f'/api/plans/{plan.id}/resume/preview', json={
                'resume_date': '9999-12-31',
            })
        error = _assert_error_envelope(response, 422, 'validation_error')
        assert 'resume_date' in error['field_errors']

    def test_pause_serializer_failure_rolls_back_once(
            self, logged_in_client, db_session, test_user, monkeypatch):
        from routes import api as api_routes

        plan = _active_plan_for_lifecycle(db_session, test_user)
        before = _lifecycle_graph(test_user.id)
        rollback_calls = []
        original_rollback = db.session.rollback

        def tracked_rollback():
            rollback_calls.append(True)
            return original_rollback()

        def fail_serializer(plan):
            raise RuntimeError('synthetic pause serializer failure')

        monkeypatch.setattr(db.session, 'rollback', tracked_rollback)
        monkeypatch.setattr(api_routes, 'serialize_plan', fail_serializer)
        response = logged_in_client.post(f'/api/plans/{plan.id}/pause')
        _assert_error_envelope(response, 500, 'internal_error', retryable=True)
        assert rollback_calls == [True]
        assert _lifecycle_graph(test_user.id) == before
        db_session.refresh(plan)
        assert plan.status == 'active'
        assert PlanStatusEvent.query.filter_by(
            plan_id=plan.id, status='paused').count() == 0

    def test_missing_and_foreign_plans_have_identical_404s(
            self, logged_in_client, db_session, test_user):
        own = _active_plan_for_lifecycle(db_session, test_user)
        PlanService.pause(test_user.id, own.id)
        other = User(email='lifecycle-foreign@example.com',
                     email_verified=True, timezone='UTC')
        other.set_password('password123')
        db_session.add(other)
        db_session.commit()
        foreign = _active_plan_for_lifecycle(db_session, other)
        PlanService.pause(other.id, foreign.id)
        endpoints = [
            (f'/api/plans/{{}}/revisions/preview', {
                'effective_date': '2099-01-15',
                'changes': {'pace': 'focused'},
            }),
            (f'/api/plans/{{}}/revisions', {
                'effective_date': '2099-01-15',
                'changes': {'pace': 'gentle'}, 'preview_digest': '0' * 64,
                'reason': 'user_edit', 'note': None,
            }),
            (f'/api/plans/{{}}/pause', None),
            (f'/api/plans/{{}}/resume/preview', {'resume_date': '2099-03-01'}),
            (f'/api/plans/{{}}/resume', {
                'resume_date': '2099-03-01', 'preview_digest': '0' * 64,
            }),
        ]
        for path, body in endpoints:
            requester_before = _lifecycle_graph(test_user.id)
            foreign_before = _lifecycle_graph(other.id)
            missing = logged_in_client.post(path.format(999999), json=body)
            foreign_response = logged_in_client.post(
                path.format(foreign.id), json=body)
            _assert_error_envelope(missing, 404, 'not_found')
            _assert_error_envelope(foreign_response, 404, 'not_found')
            assert missing.get_json() == foreign_response.get_json()
            assert _lifecycle_graph(test_user.id) == requester_before
            assert _lifecycle_graph(other.id) == foreign_before

    def test_wrong_state_returns_invalid_plan_state_for_lifecycle_actions(
            self, logged_in_client, db_session, test_user):
        generation_input = PlanGenerationInput(
            mode='reduce', start_date=date(2099, 1, 1),
            baseline_pouches=Decimal('8.00'), baseline_mg=Decimal('48.00'),
            baseline_mg_per_pouch=Decimal('6.00'), pace='steady',
            end_target_pouches=2,
        )
        preview = PlanScheduleGenerator.generate(generation_input)
        draft = PlanService.create_from_preview(
            test_user.id, generation_input, 'manual', preview.digest, 'draft'
        )
        bodies = [
            (f'/api/plans/{draft.id}/revisions/preview', {
                'effective_date': '2099-01-15', 'changes': {'pace': 'gentle'},
            }),
            (f'/api/plans/{draft.id}/revisions', {
                'effective_date': '2099-01-15', 'changes': {'pace': 'gentle'},
                'preview_digest': '0' * 64, 'reason': 'user_edit', 'note': None,
            }),
            (f'/api/plans/{draft.id}/pause', None),
            (f'/api/plans/{draft.id}/resume/preview', {
                'resume_date': '2099-03-01',
            }),
            (f'/api/plans/{draft.id}/resume', {
                'resume_date': '2099-03-01', 'preview_digest': '0' * 64,
            }),
        ]
        for path, body in bodies:
            response = logged_in_client.post(path, json=body)
            _assert_error_envelope(response, 409, 'invalid_plan_state')

    def test_stale_revision_preserves_complete_graph(
            self, logged_in_client, db_session, test_user):
        plan = _active_plan_for_lifecycle(db_session, test_user)
        preview = logged_in_client.post(
            f'/api/plans/{plan.id}/revisions/preview', json={
                'effective_date': '2099-01-15',
                'changes': {'pace': 'focused'},
            }).get_json()
        before = _lifecycle_graph(test_user.id)
        response = logged_in_client.post(
            f'/api/plans/{plan.id}/revisions', json={
                'effective_date': '2099-01-15',
                'changes': {'pace': 'focused'},
                'preview_digest': 'f' * 64,
                'reason': 'user_edit',
                'note': None,
            })
        _assert_error_envelope(response, 409, 'preview_stale')
        assert preview['preview_digest'] != 'f' * 64
        assert _lifecycle_graph(test_user.id) == before

    def test_stale_resume_preserves_complete_graph(
            self, logged_in_client, db_session, test_user):
        plan = _active_plan_for_lifecycle(db_session, test_user)
        PlanService.pause(test_user.id, plan.id, reason='break')
        preview_response = logged_in_client.post(
            f'/api/plans/{plan.id}/resume/preview', json={
                'resume_date': '2099-03-01',
            })
        assert preview_response.status_code == 200
        before = _lifecycle_graph(test_user.id)
        response = logged_in_client.post(
            f'/api/plans/{plan.id}/resume', json={
                'resume_date': '2099-03-01',
                'preview_digest': 'f' * 64,
            })
        _assert_error_envelope(response, 409, 'preview_stale')
        assert _lifecycle_graph(test_user.id) == before

    def test_resume_active_plan_conflict_preserves_complete_graph(
            self, logged_in_client, db_session, test_user):
        paused = _active_plan_for_lifecycle(db_session, test_user)
        PlanService.pause(test_user.id, paused.id, reason='break')
        active = _active_plan_for_lifecycle(db_session, test_user)
        preview_response = logged_in_client.post(
            f'/api/plans/{paused.id}/resume/preview', json={
                'resume_date': '2099-03-01',
            })
        assert preview_response.status_code == 200
        digest = preview_response.get_json()['preview_digest']
        before = _lifecycle_graph(test_user.id)
        response = logged_in_client.post(
            f'/api/plans/{paused.id}/resume', json={
                'resume_date': '2099-03-01',
                'preview_digest': digest,
            })
        _assert_error_envelope(response, 409, 'active_plan_conflict')
        db_session.refresh(active)
        assert active.status == 'active'
        assert _lifecycle_graph(test_user.id) == before

    @pytest.mark.parametrize('endpoint,body,method_name', [
        (
            '/api/plans/{}/revisions/preview',
            {'effective_date': '2099-01-15',
             'changes': {'pace': 'gentle'}},
            'preview_revision',
        ),
        (
            '/api/plans/{}/resume/preview',
            {'resume_date': '2099-03-01'},
            'preview_resume',
        ),
    ])
    def test_internal_preview_failure_is_read_only(
            self, logged_in_client, db_session, test_user, monkeypatch,
            endpoint, body, method_name):
        from routes import api as api_routes

        plan = _active_plan_for_lifecycle(db_session, test_user)
        if method_name == 'preview_resume':
            PlanService.pause(test_user.id, plan.id, reason='break')
        before = _lifecycle_graph(test_user.id)

        def fail_preview(*args, **kwargs):
            raise RuntimeError('synthetic preview failure')

        monkeypatch.setattr(
            api_routes.PlanService, method_name, staticmethod(fail_preview))
        response = logged_in_client.post(
            endpoint.format(plan.id), json=body)
        _assert_error_envelope(response, 500, 'internal_error', retryable=True)
        assert _lifecycle_graph(test_user.id) == before

    @pytest.mark.parametrize('action', ['revision', 'resume'])
    def test_lifecycle_serializer_failure_rolls_back_once_and_preserves_graph(
            self, logged_in_client, db_session, test_user, monkeypatch,
            action):
        from routes import api as api_routes

        plan = _active_plan_for_lifecycle(db_session, test_user)
        if action == 'resume':
            PlanService.pause(test_user.id, plan.id, reason='break')
            preview_response = logged_in_client.post(
                f'/api/plans/{plan.id}/resume/preview', json={
                    'resume_date': '2099-03-01',
                })
            digest = preview_response.get_json()['preview_digest']
            body = {
                'resume_date': '2099-03-01',
                'preview_digest': digest,
            }
            endpoint = f'/api/plans/{plan.id}/resume'
        else:
            preview_response = logged_in_client.post(
                f'/api/plans/{plan.id}/revisions/preview', json={
                    'effective_date': '2099-01-15',
                    'changes': {'pace': 'focused'},
                })
            digest = preview_response.get_json()['preview_digest']
            body = {
                'effective_date': '2099-01-15',
                'changes': {'pace': 'focused'},
                'preview_digest': digest,
                'reason': 'user_edit',
                'note': None,
            }
            endpoint = f'/api/plans/{plan.id}/revisions'
        before = _lifecycle_graph(test_user.id)
        rollback_calls = []
        original_rollback = db.session.rollback

        def tracked_rollback():
            rollback_calls.append(True)
            return original_rollback()

        def fail_serializer(_plan):
            raise RuntimeError('synthetic lifecycle serializer failure')

        monkeypatch.setattr(db.session, 'rollback', tracked_rollback)
        monkeypatch.setattr(api_routes, 'serialize_plan', fail_serializer)
        response = logged_in_client.post(endpoint, json=body)
        _assert_error_envelope(response, 500, 'internal_error', retryable=True)
        assert rollback_calls == [True]
        assert _lifecycle_graph(test_user.id) == before

    def test_resume_contention_retry_reaches_builder_and_commits_once(
            self, db_session, test_user, monkeypatch):
        import services.plan_service as plan_service

        plan = _active_plan_for_lifecycle(db_session, test_user)
        PlanService.pause(test_user.id, plan.id, reason='break')
        preview = PlanService.preview_resume(
            test_user.id, plan.id, date(2099, 3, 1))
        builder_calls = []
        commit_calls = []
        original_commit = db.session.commit

        def commit_with_one_contention():
            commit_calls.append(True)
            if len(commit_calls) == 1:
                raise OperationalError(
                    'UPDATE reduction_plan', {},
                    sqlite3.OperationalError('database is locked'))
            return original_commit()

        def build_result(current_plan):
            builder_calls.append(current_plan.id)
            return {'id': current_plan.id, 'status': current_plan.status}

        monkeypatch.setattr(db.session, 'commit', commit_with_one_contention)
        monkeypatch.setattr(
            plan_service, '_activation_conflict_is_confirmed',
            lambda *args, **kwargs: False)
        result = PlanService.resume(
            test_user.id, plan.id, date(2099, 3, 1), preview.digest,
            result_builder=build_result)
        assert result == {'id': plan.id, 'status': 'active'}
        assert len(commit_calls) == 2
        assert builder_calls == [plan.id, plan.id]
        db_session.refresh(plan)
        assert plan.status == 'active'
