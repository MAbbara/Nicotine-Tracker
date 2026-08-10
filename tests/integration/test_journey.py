"""Integration contracts for the server-rendered Journey destination."""

import json

from datetime import date, datetime, time, timedelta
from decimal import Decimal

from bs4 import BeautifulSoup

from extensions import db
from models import (
    Goal,
    Log,
    PlanDay,
    PlanRevision,
    PlanStatusEvent,
    ReductionPlan,
    User,
)
from services import log_service
from services.timezone_service import get_current_user_day, resolve_timezone


def _revision(session, plan, effective_date, *, pace='steady', target_date=None,
              end_target=2, reason='initial', created_at=None):
    row = PlanRevision(
        plan_id=plan.id,
        effective_date=effective_date,
        pace=pace,
        target_date=target_date,
        end_target_pouches=end_target,
        generation_inputs={},
        preview_digest=(str(plan.id) * 64)[:64],
        reason=reason,
        created_at=created_at or datetime(2026, 1, 1, 9),
    )
    session.add(row)
    session.flush()
    return row


def _plan(session, user, *, status='active', mode='reduce', start=None,
          length=10, baseline_source='manual', baseline_pouches='8.00',
          baseline_mg='48.00', baseline_strength='6.00', pace='steady',
          end_target=2, with_revision=True):
    start = start or date.today()
    plan = ReductionPlan(
        user_id=user.id,
        mode=mode,
        status=status,
        active_slot=1 if status == 'active' else None,
        start_date=start,
        target_date=start + timedelta(days=length - 1),
        baseline_source=baseline_source,
        baseline_pouches=(
            None if baseline_pouches is None else Decimal(baseline_pouches)
        ),
        baseline_mg=None if baseline_mg is None else Decimal(baseline_mg),
        baseline_mg_per_pouch=(
            None if baseline_strength is None else Decimal(baseline_strength)
        ),
        pace=pace,
        end_target_pouches=end_target,
        created_at=datetime(2026, 1, 1, 8),
        updated_at=datetime(2026, 1, 1, 8),
    )
    session.add(plan)
    session.flush()
    if with_revision:
        revision = _revision(
            session, plan, start, pace=pace, target_date=plan.target_date,
            end_target=end_target,
        )
        plan.active_revision_id = revision.id
        for offset in range(length):
            targeted = mode != 'observe'
            session.add(PlanDay(
                plan_id=plan.id,
                revision_id=revision.id,
                local_date=start + timedelta(days=offset),
                target_pouches=8 if targeted else None,
                nicotine_ceiling_mg=Decimal('48.00') if targeted else None,
            ))
    if status in {'active', 'paused', 'completed', 'archived'}:
        session.add(PlanStatusEvent(
            plan_id=plan.id,
            status=status,
            effective_at_utc=datetime(2026, 1, 1, 10),
            local_date=start,
            reason='fixture',
        ))
    session.commit()
    return plan


def _text(response):
    return BeautifulSoup(response.data, 'html.parser').get_text(' ', strip=True)


def _graph(user_id):
    plans = ReductionPlan.query.filter_by(user_id=user_id).order_by(
        ReductionPlan.id
    ).all()
    plan_ids = [plan.id for plan in plans]
    return {
        'plans': [
            (plan.id, plan.status, plan.active_slot, plan.active_revision_id,
             plan.target_date, plan.end_target_pouches)
            for plan in plans
        ],
        'days': [
            (row.id, row.plan_id, row.revision_id, row.local_date,
             row.target_pouches, row.nicotine_ceiling_mg)
            for row in PlanDay.query.filter(PlanDay.plan_id.in_(plan_ids)).order_by(
                PlanDay.id
            ).all()
        ] if plan_ids else [],
        'revisions': [
            (row.id, row.plan_id, row.effective_date, row.reason)
            for row in PlanRevision.query.filter(
                PlanRevision.plan_id.in_(plan_ids)
            ).order_by(PlanRevision.id).all()
        ] if plan_ids else [],
        'events': [
            (row.id, row.plan_id, row.status, row.effective_at_utc)
            for row in PlanStatusEvent.query.filter(
                PlanStatusEvent.plan_id.in_(plan_ids)
            ).order_by(PlanStatusEvent.id).all()
        ] if plan_ids else [],
    }


class TestJourneyComposition:
    def test_login_protection_and_two_action_empty_state(self, app,
                                                         logged_in_client):
        anonymous = app.test_client().get('/journey/')
        assert anonymous.status_code == 302
        assert '/auth/login' in anonymous.headers['Location']

        response = logged_in_client.get('/journey/')
        assert response.status_code == 200
        soup = BeautifulSoup(response.data, 'html.parser')
        assert soup.select_one('a[href="/journey/onboarding"]') is not None
        assert soup.select_one('a[href="/today/"]') is not None
        text = soup.get_text(' ', strip=True)
        assert 'Create a plan' in text
        assert 'Continue neutral tracking' in text

    def test_active_plan_renders_truthful_baseline_schedule_history_and_milestones(
            self, logged_in_client, db_session, test_user):
        # Align the fixture with the app's user-day resolution (UTC here) so
        # date-relative assertions hold around the local/UTC boundary too.
        reset_time = (
            test_user.preferences.daily_reset_time
            if test_user.preferences and test_user.preferences.daily_reset_time
            else time.min
        )
        today = get_current_user_day(
            resolve_timezone(test_user.timezone).zone, reset_time
        )
        plan = _plan(db_session, test_user, start=today - timedelta(days=1))
        original = PlanDay.query.filter_by(plan_id=plan.id).order_by(
            PlanDay.local_date
        ).all()
        second = _revision(
            db_session, plan, today + timedelta(days=3), pace='focused',
            target_date=today + timedelta(days=8), end_target=4,
            reason='user_edit', created_at=datetime(2026, 1, 2, 9),
        )
        for row in original[4:]:
            row.revision_id = second.id
            row.target_pouches = 6
            row.nicotine_ceiling_mg = Decimal('36.00')
        third = _revision(
            db_session, plan, today + timedelta(days=6), pace='focused',
            target_date=today + timedelta(days=8), end_target=4,
            reason='user_edit', created_at=datetime(2026, 1, 4, 9),
        )
        for row in original[7:]:
            row.revision_id = third.id
        plan.active_revision_id = third.id
        plan.pace = 'focused'
        db_session.add_all([
            PlanStatusEvent(
                plan_id=plan.id, status='paused',
                effective_at_utc=datetime(2026, 1, 3, 10),
                local_date=today, reason='break',
            ),
            PlanStatusEvent(
                plan_id=plan.id, status='active',
                effective_at_utc=datetime(2026, 1, 5, 11),
                local_date=today + timedelta(days=2), reason='resumed',
            ),
        ])
        db_session.commit()

        response = logged_in_client.get('/journey/')
        soup = BeautifulSoup(response.data, 'html.parser')
        text = soup.get_text(' ', strip=True)
        overview = soup.select_one('.journey-overview')
        assert overview is not None
        assert overview['data-plan-id'] == str(plan.id)
        # hero + status line
        assert 'Active' in text
        assert 'Focused pace' in text
        assert 'Day 2 of 10' in text
        # today panel (current stage: days 1-4 at 8 pouches / 48.00 mg)
        assert '8 pouches · 48.00 mg ceiling' in text
        assert 'day 2 of 4' in text
        # screen-reader stage table + JSON island (3 stages: 8, 6, 6)
        assert len(soup.select('[data-stage-table] tbody tr')) == 3
        payload = json.loads(soup.select_one('[data-path-data]').string)
        assert [s['pouches'] for s in payload['stages']] == [8, 6, 6]
        assert payload['stages'][1]['revision'] == second.id
        # next change (stage 2 starts today+3)
        assert 'steps down to 6 pouches' in text
        # facts grid (production phrasing preserved)
        facts = soup.select_one('.facts__grid').get_text(' ', strip=True)
        assert 'Manual baseline' in facts
        assert '8.00 pouches per day' in facts
        assert '48.00 mg per day' in facts
        assert '6.00 mg per pouch' in facts
        # merged history
        history = soup.select_one('.history__list').get_text(' ', strip=True)
        assert f'Revision {second.id}' in history
        assert f'Revision {third.id}' in history
        assert 'Paused' in history
        assert 'break' in history
        assert 'Resumed' in history
        assert 'resumed' in history
        # lifecycle forms
        assert soup.select_one('form[action$="/pause"]') is not None
        assert soup.select_one('form[action$="/complete"]') is not None
        assert soup.select_one('form[action$="/archive"]') is not None
        # old editor internals still live inside the adjust shell
        assert soup.select_one('[data-plan-editor="revision"]') is not None
        assert 'preview_digest' not in text

    def test_null_observe_values_are_unknown_and_proposal_needs_review(
            self, logged_in_client, db_session, test_user):
        _plan(
            db_session, test_user, status='draft', mode='reduce',
            baseline_source='observe', baseline_pouches='7.00',
            baseline_mg=None, baseline_strength=None, pace=None,
            end_target=None, with_revision=False,
        )
        response = logged_in_client.get('/journey/')
        text = _text(response)
        assert 'Proposed baseline' in text
        assert 'needs pace and target review' in text.lower()
        assert 'Nicotine baseline Unknown' in text
        assert 'Direct median strength Unknown' in text
        assert '0.00 mg' not in text

    def test_persisted_zero_draft_values_are_not_mislabeled_unknown(
            self, logged_in_client, db_session, test_user):
        _plan(
            db_session, test_user, status='draft', mode='reduce',
            baseline_source='manual', baseline_pouches='0.00',
            baseline_mg='0.00', baseline_strength='0.00', pace=None,
            end_target=0, with_revision=False,
        )

        text = _text(logged_in_client.get('/journey/'))

        assert 'Pouch baseline 0.00 pouches per day' in text
        assert 'Nicotine baseline 0.00 mg per day' in text
        assert 'Direct median strength 0.00 mg per pouch' in text

    def test_paused_beats_newer_draft_and_completed_archived_are_history(
            self, logged_in_client, db_session, test_user):
        paused = _plan(db_session, test_user, status='paused', end_target=3)
        paused.updated_at = datetime(2026, 2, 1)
        draft = _plan(db_session, test_user, status='draft', end_target=1)
        draft.updated_at = datetime(2026, 3, 1)
        completed = _plan(db_session, test_user, status='completed')
        completed.updated_at = datetime(2026, 4, 1)
        archived = _plan(db_session, test_user, status='archived')
        archived.updated_at = datetime(2026, 5, 1)
        db_session.commit()

        response = logged_in_client.get('/journey/')
        soup = BeautifulSoup(response.data, 'html.parser')
        assert soup.select_one('.journey-plan')['data-plan-id'] == str(paused.id)
        historical = [
            int(row['data-plan-id'])
            for row in soup.select('[data-historical-plan]')
        ]
        assert historical == [archived.id, completed.id]
        assert str(draft.id) not in historical


class TestJourneyLifecycleActions:
    def test_pause_complete_and_archive_use_candid_redirect_flashes(
            self, logged_in_client, db_session, test_user):
        plan = _plan(db_session, test_user)
        paused = logged_in_client.post(f'/journey/plans/{plan.id}/pause')
        assert paused.status_code == 302
        follow = logged_in_client.get(paused.headers['Location'])
        assert 'Plan paused. Your history is unchanged.' in _text(follow)
        db_session.refresh(plan)
        assert plan.status == 'paused'

        completed = logged_in_client.post(
            f'/journey/plans/{plan.id}/complete'
        )
        follow = logged_in_client.get(completed.headers['Location'])
        assert 'Plan marked complete.' in _text(follow)
        db_session.refresh(plan)
        assert plan.status == 'completed'

        archived = logged_in_client.post(
            f'/journey/plans/{plan.id}/archive'
        )
        follow = logged_in_client.get(archived.headers['Location'])
        assert 'Plan archived. Your history is still available.' in _text(follow)
        db_session.refresh(plan)
        assert plan.status == 'archived'

    def test_invalid_state_is_calm_redirect_without_mutation(
            self, logged_in_client, db_session, test_user):
        plan = _plan(db_session, test_user, status='completed')
        before = _graph(test_user.id)
        response = logged_in_client.post(f'/journey/plans/{plan.id}/pause')
        assert response.status_code == 302
        follow = logged_in_client.get(response.headers['Location'])
        assert 'That plan action is not available in its current state.' in _text(
            follow
        )
        assert _graph(test_user.id) == before

    def test_resume_preview_is_read_only_and_confirm_requires_displayed_digest(
            self, logged_in_client, db_session, test_user):
        today = date.today()
        plan = _plan(
            db_session, test_user, status='paused', start=today - timedelta(days=1)
        )
        event = PlanStatusEvent.query.filter_by(plan_id=plan.id).one()
        event.local_date = today
        event.effective_at_utc = datetime.utcnow()
        db_session.commit()
        resume_date = today + timedelta(days=2)
        before = _graph(test_user.id)

        preview_response = logged_in_client.post(
            f'/journey/plans/{plan.id}/resume', data={
                'form_action': 'preview',
                'resume_date': resume_date.isoformat(),
            },
        )
        assert preview_response.status_code == 200
        soup = BeautifulSoup(preview_response.data, 'html.parser')
        digest = soup.select_one(
            'form[data-resume-confirm] input[name="preview_digest"]'
        )['value']
        assert len(digest) == 64
        assert _graph(test_user.id) == before

        stale = logged_in_client.post(
            f'/journey/plans/{plan.id}/resume', data={
                'form_action': 'confirm',
                'resume_date': resume_date.isoformat(),
                'preview_digest': 'f' * 64,
            },
        )
        assert stale.status_code == 409
        assert 'fresh preview' in _text(stale).lower()
        assert _graph(test_user.id) == before

        confirmed = logged_in_client.post(
            f'/journey/plans/{plan.id}/resume', data={
                'form_action': 'confirm',
                'resume_date': resume_date.isoformat(),
                'preview_digest': digest,
            },
        )
        assert confirmed.status_code == 302
        db_session.refresh(plan)
        assert plan.status == 'active'

    def test_revision_preview_is_read_only_and_confirm_preserves_history(
            self, logged_in_client, db_session, test_user):
        today = date.today()
        plan = _plan(
            db_session, test_user, start=today - timedelta(days=1), length=10
        )
        effective = today + timedelta(days=2)
        historical = PlanDay.query.filter(
            PlanDay.plan_id == plan.id,
            PlanDay.local_date < effective,
        ).order_by(PlanDay.id).all()
        historical_bytes = [
            (row.id, row.revision_id, row.local_date, row.target_pouches,
             row.nicotine_ceiling_mg, row.created_at)
            for row in historical
        ]
        before = _graph(test_user.id)
        data = {
            'form_action': 'preview',
            'effective_date': effective.isoformat(),
            'pace': 'focused',
            'duration_days': '28',
            'end_target_pouches': '3',
        }
        preview_response = logged_in_client.post(
            f'/journey/plans/{plan.id}/revision', data=data
        )
        assert preview_response.status_code == 200
        soup = BeautifulSoup(preview_response.data, 'html.parser')
        stage_rows = soup.select('[data-revision-preview-stages] tbody tr')
        assert stage_rows
        rows = soup.select('[data-revision-preview] tbody tr')
        assert len(rows) == 28
        digest = soup.select_one(
            'form[data-revision-confirm] input[name="preview_digest"]'
        )['value']
        assert _graph(test_user.id) == before

        stale = dict(data, form_action='confirm', preview_digest='f' * 64)
        stale_response = logged_in_client.post(
            f'/journey/plans/{plan.id}/revision', data=stale
        )
        assert stale_response.status_code == 409
        assert 'fresh preview' in _text(stale_response).lower()
        assert _graph(test_user.id) == before

        confirm = dict(data, form_action='confirm', preview_digest=digest)
        response = logged_in_client.post(
            f'/journey/plans/{plan.id}/revision', data=confirm
        )
        assert response.status_code == 302
        after_history = PlanDay.query.filter(
            PlanDay.plan_id == plan.id,
            PlanDay.local_date < effective,
        ).order_by(PlanDay.id).all()
        assert [
            (row.id, row.revision_id, row.local_date, row.target_pouches,
             row.nicotine_ceiling_mg, row.created_at)
            for row in after_history
        ] == historical_bytes
        assert PlanRevision.query.filter_by(
            plan_id=plan.id, reason='user_edit'
        ).count() == 1

    def test_finish_observe_without_evidence_completes_and_prompts_manual_baseline(
            self, logged_in_client, db_session, test_user):
        plan = _plan(
            db_session, test_user, mode='observe',
            start=date.today() - timedelta(days=9), length=7,
            baseline_source='observe', baseline_pouches=None,
            baseline_mg=None, baseline_strength=None, pace=None,
            end_target=None,
        )
        response = logged_in_client.post(
            f'/journey/plans/{plan.id}/finish-observe'
        )
        assert response.status_code == 302
        follow = logged_in_client.get(response.headers['Location'])
        assert 'enter a baseline manually' in _text(follow).lower()
        db_session.refresh(plan)
        assert plan.status == 'completed'
        assert ReductionPlan.query.filter_by(
            user_id=test_user.id, status='draft', baseline_source='observe'
        ).count() == 0

    def test_finish_observe_with_evidence_creates_unactivated_proposal(
            self, logged_in_client, db_session, test_user, test_pouch):
        start = date.today() - timedelta(days=9)
        plan = _plan(
            db_session, test_user, mode='observe', start=start, length=7,
            baseline_source='observe', baseline_pouches=None,
            baseline_mg=None, baseline_strength=None, pace=None,
            end_target=None,
        )
        for offset in range(4):
            log = Log(
                user_id=test_user.id,
                quantity=7,
                log_time=datetime.combine(start + timedelta(days=offset), time(12)),
            )
            log_service.assign_log_product(log, pouch_id=test_pouch.id)
            db_session.add(log)
        db_session.commit()

        response = logged_in_client.post(
            f'/journey/plans/{plan.id}/finish-observe'
        )
        assert response.status_code == 302
        proposal = ReductionPlan.query.filter_by(
            user_id=test_user.id, status='draft', baseline_source='observe'
        ).one()
        assert proposal.active_slot is None
        assert proposal.active_revision_id is None
        page = logged_in_client.get(response.headers['Location'])
        assert 'Proposed baseline' in _text(page)

    def test_missing_and_foreign_actions_are_identical_404_without_mutation(
            self, logged_in_client, db_session, test_user):
        other = User(email='journey-foreign@example.com', timezone='UTC')
        other.set_password('password123')
        db_session.add(other)
        db_session.commit()
        foreign = _plan(db_session, other, status='paused')
        logged_in_client.get('/journey/')  # consume the login flash once
        requester_before = _graph(test_user.id)
        foreign_before = _graph(other.id)
        paths = [
            ('pause', {}), ('complete', {}), ('archive', {}),
            ('finish-observe', {}),
            ('resume', {'form_action': 'preview', 'resume_date': '2099-01-01'}),
            ('revision', {
                'form_action': 'preview', 'effective_date': '2099-01-01',
                'pace': 'focused',
            }),
        ]
        for suffix, data in paths:
            missing = logged_in_client.post(
                f'/journey/plans/999999/{suffix}', data=data
            )
            hidden = logged_in_client.post(
                f'/journey/plans/{foreign.id}/{suffix}', data=data
            )
            assert missing.status_code == hidden.status_code == 404
            assert missing.data == hidden.data
            assert _graph(test_user.id) == requester_before
            assert _graph(other.id) == foreign_before


class TestLegacyGoalReview:
    def test_candidates_conflicts_source_ids_and_goal_rows_are_preserved(
            self, logged_in_client, db_session, test_user):
        pouch_goal = Goal(
            user_id=test_user.id, goal_type='daily_pouches', target_value=4,
            start_date=date(2026, 1, 1), end_date=date(2026, 2, 1),
            is_active=True,
        )
        matching_mg = Goal(
            user_id=test_user.id, goal_type='daily_mg', target_value=24,
            start_date=date(2026, 1, 1), end_date=date(2026, 2, 1),
            is_active=True,
        )
        conflict = Goal(
            user_id=test_user.id, goal_type='weekly_reduction', target_value=2,
            start_date=date(2026, 1, 1), end_date=date(2026, 3, 1),
            is_active=True,
        )
        historical = Goal(
            user_id=test_user.id, goal_type='daily_pouches', target_value=6,
            start_date=date(2025, 1, 1), end_date=date(2025, 2, 1),
            is_active=False,
        )
        db_session.add_all([pouch_goal, matching_mg, conflict, historical])
        db_session.flush()
        candidate = ReductionPlan(
            user_id=test_user.id, mode='reduce', status='draft',
            baseline_source='legacy_goal', end_target_pouches=4,
            migration_fingerprint='a' * 64,
            legacy_goal_ids=[pouch_goal.id, matching_mg.id],
        )
        db_session.add(candidate)
        db_session.commit()
        before = [goal.to_dict() for goal in Goal.query.order_by(Goal.id).all()]

        response = logged_in_client.get('/journey/')
        soup = BeautifulSoup(response.data, 'html.parser')
        text = soup.get_text(' ', strip=True)
        assert soup.select_one('.legacy-review') is not None
        assert f'Candidate plan {candidate.id}' in text
        assert f'Source Goal IDs {pouch_goal.id}, {matching_mg.id}' in text
        assert '4 pouches per day' in text
        assert '24 mg per day' in text
        assert f'Goal {conflict.id}' in text
        assert 'weekly reduction' in text.lower()
        assert 'Review this draft' in text
        assert 'Past Goal rows' in text
        assert [goal.to_dict() for goal in Goal.query.order_by(Goal.id).all()] == before
