"""Contracts for resumable onboarding-draft CRUD.

Task 5A slices: parser happy path/normalization, rejection matrix,
GET/PUT/DELETE round-trips, pouch ownership indistinguishability, and
rollback preservation.
"""
import pytest

from extensions import db
from models import OnboardingDraft, Pouch, User


def _assert_error_envelope(response, status, code, retryable=False):
    assert response.status_code == status
    payload = response.get_json()
    assert set(payload.keys()) == {'error'}
    error = payload['error']
    assert set(error.keys()) == {'code', 'message', 'field_errors', 'retryable'}
    assert error['code'] == code
    assert error['retryable'] is retryable
    return error


def _valid_payload(**overrides):
    payload = {
        'intention': 'reduce',
        'baseline_source': 'recent_logs',
        'baseline_pouches': '10',
        'baseline_mg': '60.5',
        'baseline_mg_per_pouch': '6',
        'pace': 'steady',
        'start_date': '2026-08-01',
        'target_date': '2026-10-01',
        'duration_days': 61,
        'end_target_pouches': 2,
        'stage_targets': [
            {'start_date': '2026-08-01', 'end_date': '2026-08-31',
             'target_pouches': 6, 'nicotine_ceiling_mg': '36.5'},
        ],
        'difficult_times': ['morning', 'evening'],
        'common_triggers': ['stress', 'social'],
        'reminder_window': 'morning',
    }
    payload.update(overrides)
    return payload


def _put(client, payload=None, current_step='baseline', **outer_overrides):
    body = {'current_step': current_step,
            'structured_payload': _valid_payload() if payload is None else payload}
    body.update(outer_overrides)
    return client.put('/api/onboarding-draft', json=body)


class TestDraftParserHappyPath:
    def test_put_normalizes_and_returns_canonical_row(
            self, logged_in_client, db_session, test_user):
        response = _put(logged_in_client)
        assert response.status_code == 200
        payload = response.get_json()
        assert set(payload.keys()) == {'onboarding_draft', 'saved'}
        assert payload['saved'] is True
        row = payload['onboarding_draft']
        assert set(row.keys()) == {
            'id', 'current_step', 'structured_payload',
            'created_at', 'updated_at',
        }
        assert row['current_step'] == 'baseline'
        assert row['created_at'].endswith('+00:00')
        assert row['updated_at'].endswith('+00:00')
        structured = row['structured_payload']
        # Decimals normalized to fixed two-decimal strings.
        assert structured['baseline_pouches'] == '10.00'
        assert structured['baseline_mg'] == '60.50'
        assert structured['baseline_mg_per_pouch'] == '6.00'
        assert structured['stage_targets'][0]['nicotine_ceiling_mg'] == '36.50'

    def test_minimal_payload_round_trips(self, logged_in_client):
        response = _put(logged_in_client, payload={'intention': 'observe'},
                        current_step='intention')
        assert response.status_code == 200
        row = response.get_json()['onboarding_draft']
        assert row['structured_payload'] == {'intention': 'observe'}


class TestDraftParserRejections:
    @pytest.mark.parametrize('body, field', [
        ({'structured_payload': {}}, 'current_step'),
        ({'current_step': 'baseline'}, 'structured_payload'),
        ({'current_step': 'nope', 'structured_payload': {}}, 'current_step'),
        ({'current_step': 'baseline', 'structured_payload': {},
          'extra': 1}, 'extra'),
    ])
    def test_outer_shape(self, logged_in_client, body, field):
        response = logged_in_client.put('/api/onboarding-draft', json=body)
        error = _assert_error_envelope(response, 422, 'validation_error')
        assert field in error['field_errors']

    @pytest.mark.parametrize('payload, field', [
        ({'intention': 'maybe'}, 'structured_payload.intention'),
        ({'baseline_source': 'guess'}, 'structured_payload.baseline_source'),
        ({'pace': 'fast'}, 'structured_payload.pace'),
        ({'reminder_window': 'always'}, 'structured_payload.reminder_window'),
        ({'baseline_pouches': 'abc'}, 'structured_payload.baseline_pouches'),
        ({'baseline_pouches': '-1'}, 'structured_payload.baseline_pouches'),
        ({'baseline_pouches': '0'}, 'structured_payload.baseline_pouches'),
        ({'baseline_pouches': 'NaN'}, 'structured_payload.baseline_pouches'),
        ({'baseline_pouches': 'Infinity'},
         'structured_payload.baseline_pouches'),
        ({'baseline_pouches': '1e999999'},
         'structured_payload.baseline_pouches'),
        ({'baseline_pouches': '0.004'},
         'structured_payload.baseline_pouches'),
        ({'baseline_pouches': 10}, 'structured_payload.baseline_pouches'),
        ({'baseline_mg': None}, 'structured_payload.baseline_mg'),
        ({'start_date': '01/08/2026'}, 'structured_payload.start_date'),
        ({'start_date': '2026-13-01'}, 'structured_payload.start_date'),
        ({'target_date': '2026-02-30'}, 'structured_payload.target_date'),
        ({'duration_days': 0}, 'structured_payload.duration_days'),
        ({'duration_days': 366}, 'structured_payload.duration_days'),
        ({'duration_days': True}, 'structured_payload.duration_days'),
        ({'duration_days': '30'}, 'structured_payload.duration_days'),
        ({'end_target_pouches': -1}, 'structured_payload.end_target_pouches'),
        ({'end_target_pouches': 1001},
         'structured_payload.end_target_pouches'),
        ({'end_target_pouches': False},
         'structured_payload.end_target_pouches'),
        ({'difficult_times': ['morning', 'morning']},
         'structured_payload.difficult_times'),
        ({'difficult_times': ['midnight']},
         'structured_payload.difficult_times'),
        ({'common_triggers': ['stress', 'stress']},
         'structured_payload.common_triggers'),
        ({'common_triggers': ['anxiety']},
         'structured_payload.common_triggers'),
        ({'preferred_pouch_ids': [True]},
         'structured_payload.preferred_pouch_ids'),
        ({'preferred_pouch_ids': [0]},
         'structured_payload.preferred_pouch_ids'),
        ({'preferred_pouch_ids': [1, 1]},
         'structured_payload.preferred_pouch_ids'),
        ({'preferred_pouch_ids': list(range(1, 12))},
         'structured_payload.preferred_pouch_ids'),
        ({'notes': 'I vape on weekends'}, 'structured_payload.notes'),
        ({'user_id': 1}, 'structured_payload.user_id'),
        ({'unknown_key': 'x'}, 'structured_payload.unknown_key'),
    ])
    def test_field_rejections(self, logged_in_client, payload, field):
        response = _put(logged_in_client, payload=payload)
        error = _assert_error_envelope(response, 422, 'validation_error')
        assert field in error['field_errors']

    def test_stage_target_nested_field_path(self, logged_in_client):
        payload = _valid_payload(stage_targets=[
            {'start_date': '2026-08-01', 'end_date': 'not-a-date',
             'target_pouches': 6, 'nicotine_ceiling_mg': '36.5'},
        ])
        response = _put(logged_in_client, payload=payload)
        error = _assert_error_envelope(response, 422, 'validation_error')
        assert 'structured_payload.stage_targets[0].end_date' in error['field_errors']

    def test_stage_target_unknown_nested_key(self, logged_in_client):
        payload = _valid_payload(stage_targets=[
            {'start_date': '2026-08-01', 'end_date': '2026-08-31',
             'target_pouches': 6, 'nicotine_ceiling_mg': '36.5',
             'label': 'week one'},
        ])
        response = _put(logged_in_client, payload=payload)
        error = _assert_error_envelope(response, 422, 'validation_error')
        assert any(k.startswith('structured_payload.stage_targets[0]')
                   for k in error['field_errors'])

    def test_stage_targets_capped_at_84(self, logged_in_client):
        stage = {'start_date': '2026-08-01', 'end_date': '2026-08-02',
                 'target_pouches': 1, 'nicotine_ceiling_mg': '6.0'}
        response = _put(logged_in_client,
                        payload=_valid_payload(stage_targets=[stage] * 85))
        error = _assert_error_envelope(response, 422, 'validation_error')
        assert 'structured_payload.stage_targets' in error['field_errors']

    def test_zero_target_stage_accepts_zero_ceiling(
            self, logged_in_client):
        payload = _valid_payload(stage_targets=[
            {'start_date': '2026-08-01', 'end_date': '2026-08-01',
             'target_pouches': 0, 'nicotine_ceiling_mg': '0.00'},
        ])
        response = _put(logged_in_client, payload=payload)
        assert response.status_code == 200
        stage = response.get_json()['onboarding_draft']['structured_payload']
        assert stage['stage_targets'][0]['target_pouches'] == 0
        assert stage['stage_targets'][0]['nicotine_ceiling_mg'] == '0.00'


class TestDraftCrud:
    def test_get_returns_null_when_absent(self, logged_in_client):
        response = logged_in_client.get('/api/onboarding-draft')
        assert response.status_code == 200
        assert response.get_json() == {'onboarding_draft': None}

    def test_put_creates_then_updates_single_row(
            self, logged_in_client, db_session, test_user):
        first = _put(logged_in_client)
        assert first.status_code == 200
        first_row = first.get_json()['onboarding_draft']

        second = _put(logged_in_client,
                      payload={'intention': 'quit_by_date'},
                      current_step='review')
        assert second.status_code == 200
        second_row = second.get_json()['onboarding_draft']
        assert second_row['id'] == first_row['id']
        assert second_row['current_step'] == 'review'
        assert second_row['created_at'] == first_row['created_at']
        assert OnboardingDraft.query.filter_by(user_id=test_user.id).count() == 1

    def test_get_returns_saved_row(self, logged_in_client):
        _put(logged_in_client)
        response = logged_in_client.get('/api/onboarding-draft')
        row = response.get_json()['onboarding_draft']
        assert row['current_step'] == 'baseline'
        assert 'user_id' not in row

    def test_delete_is_idempotent_204(self, logged_in_client, db_session,
                                      test_user):
        _put(logged_in_client)
        first = logged_in_client.delete('/api/onboarding-draft')
        assert first.status_code == 204
        assert first.data == b''
        assert OnboardingDraft.query.filter_by(user_id=test_user.id).count() == 0
        second = logged_in_client.delete('/api/onboarding-draft')
        assert second.status_code == 204

    def test_drafts_are_isolated_between_users(
            self, logged_in_client, db_session, test_user):
        _put(logged_in_client)
        other = User(email='other@example.com', email_verified=True,
                     timezone='UTC')
        other.set_password('password123')
        db_session.add(other)
        db_session.commit()
        assert OnboardingDraft.query.filter_by(user_id=other.id).count() == 0

    @pytest.mark.parametrize('method', ['put', 'delete'])
    def test_service_commit_failure_rolls_back_exactly_once(
            self, logged_in_client, db_session, test_user, monkeypatch,
            method):
        if method == 'delete':
            assert _put(logged_in_client).status_code == 200

        rollback_calls = []
        original_rollback = db.session.rollback

        def tracked_rollback():
            rollback_calls.append(True)
            return original_rollback()

        def failed_commit():
            raise RuntimeError('synthetic commit failure')

        monkeypatch.setattr(db.session, 'rollback', tracked_rollback)
        monkeypatch.setattr(db.session, 'commit', failed_commit)

        response = (
            _put(logged_in_client)
            if method == 'put'
            else logged_in_client.delete('/api/onboarding-draft')
        )

        _assert_error_envelope(
            response, 500, 'internal_error', retryable=True
        )
        assert rollback_calls == [True]


class TestPouchOwnershipAndRollback:
    def _make_pouches(self, db_session, test_user):
        global_pouch = Pouch(brand='Global', nicotine_mg=6, is_default=True,
                             created_by=None)
        owned_pouch = Pouch(brand='Mine', nicotine_mg=4, is_default=False,
                            created_by=test_user.id)
        other = User(email='rival@example.com', email_verified=True,
                     timezone='UTC')
        other.set_password('password123')
        db_session.add(other)
        db_session.flush()
        foreign_pouch = Pouch(brand='Theirs', nicotine_mg=8, is_default=False,
                              created_by=other.id)
        db_session.add_all([global_pouch, owned_pouch, foreign_pouch])
        db_session.commit()
        return global_pouch, owned_pouch, foreign_pouch

    def test_global_and_owned_pouches_accepted(
            self, logged_in_client, db_session, test_user):
        global_pouch, owned_pouch, _ = self._make_pouches(db_session, test_user)
        response = _put(logged_in_client, payload=_valid_payload(
            preferred_pouch_ids=[global_pouch.id, owned_pouch.id]))
        assert response.status_code == 200
        row = response.get_json()['onboarding_draft']
        assert row['structured_payload']['preferred_pouch_ids'] == [
            global_pouch.id, owned_pouch.id]

    @pytest.mark.parametrize('which', ['missing', 'foreign', 'out_of_range'])
    def test_missing_and_foreign_pouches_indistinguishable(
            self, logged_in_client, db_session, test_user, which):
        _, _, foreign_pouch = self._make_pouches(db_session, test_user)
        missing_id = 999999
        pouch_id = {
            'missing': missing_id,
            'foreign': foreign_pouch.id,
            'out_of_range': 10 ** 19,
        }[which]
        response = _put(logged_in_client, payload=_valid_payload(
            preferred_pouch_ids=[pouch_id]))
        error = _assert_error_envelope(response, 422, 'validation_error')
        field = 'structured_payload.preferred_pouch_ids'
        assert field in error['field_errors']
        assert error['field_errors'][field] == [
            'One or more selected pouches is not available.'
        ]

    def test_missing_and_foreign_messages_identical(
            self, logged_in_client, db_session, test_user):
        _, _, foreign_pouch = self._make_pouches(db_session, test_user)
        responses = [
            _put(logged_in_client,
                 payload=_valid_payload(preferred_pouch_ids=[pid]))
            for pid in (999999, foreign_pouch.id, 10 ** 19)
        ]
        bodies = [r.get_json() for r in responses]
        assert bodies[0] == bodies[1] == bodies[2]

    def test_failed_save_preserves_prior_draft_byte_for_byte(
            self, logged_in_client, db_session, test_user, monkeypatch):
        ok = _put(logged_in_client)
        assert ok.status_code == 200
        before = OnboardingDraft.query.filter_by(user_id=test_user.id).one()
        before_payload = dict(before.structured_payload)
        before_step = before.current_step
        before_updated = before.updated_at

        rollback_calls = []
        original_rollback = db.session.rollback

        def tracked_rollback():
            rollback_calls.append(True)
            return original_rollback()

        monkeypatch.setattr(db.session, 'rollback', tracked_rollback)

        bad = _put(logged_in_client, payload=_valid_payload(
            preferred_pouch_ids=[999999]), current_step='review')
        assert bad.status_code == 422
        assert rollback_calls == [True]

        db_session.expire_all()
        after = OnboardingDraft.query.filter_by(user_id=test_user.id).one()
        assert after.structured_payload == before_payload
        assert after.current_step == before_step
        assert after.updated_at == before_updated
