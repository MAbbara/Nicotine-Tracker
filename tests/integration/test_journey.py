"""Integration contracts for the server-rendered Journey destination."""

from datetime import date, datetime, time, timedelta
from decimal import Decimal

from bs4 import BeautifulSoup
import pytest

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
from services.plan_schedule import PlanGenerationInput, PlanScheduleGenerator
from services.plan_service import PlanService
from services.today_service import TodayService


def _revision(session, plan, effective_date, *, pace='steady', target_date=None,
              end_target=2, end_target_mg='48.00', reason='initial',
              created_at=None):
    row = PlanRevision(
        plan_id=plan.id,
        effective_date=effective_date,
        pace=pace,
        target_date=target_date,
        end_target_pouches=end_target,
        end_target_mg=(
            None if end_target_mg is None else Decimal(end_target_mg)
        ),
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
        end_target_mg=(
            None if mode == 'observe' else Decimal('48.00')
        ),
        created_at=datetime(2026, 1, 1, 8),
        updated_at=datetime(2026, 1, 1, 8),
    )
    session.add(plan)
    session.flush()
    if with_revision:
        revision = _revision(
            session, plan, start, pace=pace, target_date=plan.target_date,
            end_target=end_target, end_target_mg=plan.end_target_mg,
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


def _legacy_plan(session, user, *, start=None):
    start = start or date.today()
    generation_input = PlanGenerationInput(
        mode='reduce',
        target_basis='legacy_pouches',
        start_date=start,
        baseline_pouches=Decimal('8.00'),
        baseline_mg=Decimal('48.00'),
        baseline_mg_per_pouch=Decimal('6.00'),
        pace='steady',
        end_target_pouches=2,
    )
    preview = PlanScheduleGenerator.generate(generation_input)
    plan = PlanService.create_from_preview(
        user.id,
        generation_input,
        'manual',
        preview.digest,
        'activate',
    )
    session.expire_all()
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


def _form_contract(form):
    fields = []
    for control in form.select('input[name], select[name], button[name]'):
        name = control.get('name')
        if name == 'csrf_token':
            assert control.get('type') == 'hidden'
            assert control.get('value')
            value = '<csrf>'
        elif control.name == 'select':
            option = control.select_one('option[selected]') or control.select_one(
                'option'
            )
            value = option.get('value', '')
        else:
            value = control.get('value', '')
        fields.append((control.name, control.get('type'), name, value))
    return {
        'method': form.get('method', 'get').lower(),
        'action': form.get('action'),
        'fields': fields,
    }


def _assert_trajectory_owner(soup, *, count, accessible_name):
    trajectory = soup.select_one('[data-journey-trajectory]')
    assert trajectory.get('aria-label') == accessible_name
    buttons = trajectory.select('[data-journey-day]')
    assert len(buttons) == count
    selected = trajectory.select('[data-journey-day][aria-pressed="true"]')
    assert len(selected) == 1
    expected_detail = ' · '.join([
        selected[0]['data-date-label'],
        selected[0]['data-ceiling-label'],
        selected[0]['data-change-label'],
    ])
    assert soup.select_one('[data-journey-day-detail]').get_text(
        ' ', strip=True
    ) == expected_detail
    return selected[0]


class TestJourneyComposition:
    def test_login_protection_and_two_action_empty_state(self, app,
                                                         logged_in_client):
        anonymous = app.test_client().get('/journey/')
        assert anonymous.status_code == 302
        assert '/auth/login' in anonymous.headers['Location']

        response = logged_in_client.get('/journey/')
        assert response.status_code == 200
        soup = BeautifulSoup(response.data, 'html.parser')
        assert soup.select_one('h1').get_text(strip=True) == 'Journey'
        assert 'sr-only' not in soup.select_one('h1').get('class', [])
        assert soup.select_one('[data-journey-scorecard]') is None
        assert soup.select_one('[data-journey-trajectory]') is None
        assert soup.select_one('a[href="/journey/onboarding"]') is not None
        assert soup.select_one('a[href="/today/"]') is not None
        text = soup.get_text(' ', strip=True)
        assert 'Create a plan' in text
        assert 'Continue neutral tracking' in text

    def test_journey_uses_one_canonical_today_summary_date(
            self, logged_in_client, db_session, test_user, monkeypatch):
        from routes import journey as journey_routes

        original_get_summary = TodayService.get_summary
        canonical_day = original_get_summary(test_user.id).local_date
        plan = _plan(db_session, test_user, start=canonical_day)
        summary = original_get_summary(test_user.id)
        assert summary.plan is not None and summary.plan.id == plan.id
        calls = []

        def tracked_get_summary(user_id):
            calls.append(user_id)
            return summary

        monkeypatch.setattr(
            TodayService, 'get_summary', staticmethod(tracked_get_summary)
        )
        monkeypatch.setattr(
            journey_routes,
            '_today_for',
            lambda _user: (_ for _ in ()).throw(
                AssertionError('Journey must not read a second date authority')
            ),
        )

        response = logged_in_client.get('/journey/')

        assert response.status_code == 200
        assert calls == [test_user.id]
        soup = BeautifulSoup(response.data, 'html.parser')
        current = soup.select_one(
            'table[data-complete-schedule] tr[aria-current="date"] th'
        )
        assert current is not None
        assert current.get_text(strip=True) == summary.local_date.isoformat()

    def test_active_nicotine_plan_renders_compact_live_scorecard(
            self, logged_in_client, db_session, test_user):
        authority = TodayService.get_summary(test_user.id)
        _plan(db_session, test_user, start=authority.local_date)

        response = logged_in_client.get('/journey/')
        assert response.status_code == 200
        page = BeautifulSoup(response.data, 'html.parser')

        heading = page.select_one('h1')
        assert heading.get_text(strip=True) == 'Journey'
        assert 'sr-only' not in heading.get('class', [])
        scorecard = page.select_one('[data-journey-scorecard]')
        assert scorecard.select_one('[data-known-mg]') is not None
        assert scorecard.select_one('[data-ceiling-mg]') is not None
        assert scorecard.select_one('[data-difference-mg]') is not None
        assert scorecard.select_one('[data-difference-mg]').get_text(
            strip=True
        ) == '−48.00 mg'

        trajectory = page.select_one('[data-journey-trajectory]')
        assert trajectory['aria-describedby'] == 'journey-trajectory-summary'
        selected = _assert_trajectory_owner(
            page,
            count=7,
            accessible_name='7-day nicotine ceiling trajectory',
        )
        assert selected['data-date-label'] == authority.local_date.strftime(
            '%A'
        )
        assert page.select_one('[data-journey-day-detail]') is not None
        assert page.select_one('[data-journey-trajectory-summary]').get_text(
            ' ', strip=True
        ) == 'Ceilings stay at 48.00 mg across these 7 scheduled days.'
        assert len(page.select('[data-mobile-schedule] tbody tr')) == 7

        scripts = [script.get('src', '') for script in page.select('script[src]')]
        assert any(src.endswith('/js/journey/progress.js') for src in scripts)
        assert any(src.endswith('/js/journey/plan_editor.js') for src in scripts)

    def test_active_plan_preserves_exact_form_and_editor_hook_contracts(
            self, logged_in_client, db_session, test_user):
        plan = _plan(db_session, test_user)

        soup = BeautifulSoup(
            logged_in_client.get('/journey/').data, 'html.parser'
        )
        forms = {
            form['action']: _form_contract(form)
            for form in soup.select('.journey-plan form[action]')
        }
        csrf_only = [('input', 'hidden', 'csrf_token', '<csrf>')]
        assert forms[f'/journey/plans/{plan.id}/pause'] == {
            'method': 'post',
            'action': f'/journey/plans/{plan.id}/pause',
            'fields': csrf_only,
        }
        assert forms[f'/journey/plans/{plan.id}/complete'] == {
            'method': 'post',
            'action': f'/journey/plans/{plan.id}/complete',
            'fields': csrf_only,
        }
        assert forms[f'/journey/plans/{plan.id}/archive'] == {
            'method': 'post',
            'action': f'/journey/plans/{plan.id}/archive',
            'fields': csrf_only,
        }
        assert forms[f'/journey/plans/{plan.id}/revision'] == {
            'method': 'post',
            'action': f'/journey/plans/{plan.id}/revision',
            'fields': [
                ('input', 'hidden', 'csrf_token', '<csrf>'),
                ('input', 'date', 'effective_date', ''),
                ('select', None, 'pace', ''),
                ('input', 'number', 'duration_days', ''),
                ('input', 'number', 'end_target_mg', '48.00'),
                ('button', 'submit', 'form_action', 'preview'),
            ],
        }

        editor = soup.select_one('[data-plan-editor="revision"]')
        assert editor['data-plan-id'] == str(plan.id)
        assert editor.select_one('form[data-plan-editor-form]') is not None
        digest = editor.select_one('input[data-plan-editor-digest]')
        assert digest.get('type') == 'hidden'
        assert digest.get('name') is None
        preview = editor.select_one('[data-plan-editor-preview-button]')
        assert preview.get('type') == 'submit'
        assert (preview.get('name'), preview.get('value')) == (
            'form_action', 'preview'
        )
        confirm = editor.select_one('[data-plan-editor-confirm]')
        assert confirm.get('type') == 'button'
        assert confirm.get('name') is None
        assert confirm.has_attr('hidden')
        assert editor.select_one('[data-plan-editor-status]') is not None
        assert editor.select_one('[data-plan-editor-preview]') is not None

    def test_paused_plan_preserves_resume_form_and_editor_hook_contracts(
            self, logged_in_client, db_session, test_user):
        plan = _plan(db_session, test_user, status='paused')

        soup = BeautifulSoup(
            logged_in_client.get('/journey/').data, 'html.parser'
        )
        form = soup.select_one('[data-plan-editor="resume"] form')
        assert _form_contract(form) == {
            'method': 'post',
            'action': f'/journey/plans/{plan.id}/resume',
            'fields': [
                ('input', 'hidden', 'csrf_token', '<csrf>'),
                ('input', 'date', 'resume_date', ''),
                ('button', 'submit', 'form_action', 'preview'),
            ],
        }
        assert form.has_attr('data-plan-editor-form')
        assert form.select_one('input[data-plan-editor-digest]') is not None
        assert form.select_one('[data-plan-editor-preview-button]') is not None
        assert form.select_one('[data-plan-editor-confirm]') is not None
        status = soup.select_one('.journey-progress-status').get_text(
            ' ', strip=True
        )
        assert status == '● Plan paused'
        assert not any(
            comparison in status
            for comparison in ('Below', 'At today', 'Above')
        )
        assert soup.select_one('[data-ceiling-mg]').get_text(
            ' ', strip=True
        ) == 'Paused — not in effect'
        assert soup.select_one('[data-journey-scorecard]') is not None
        assert soup.select_one('[data-difference-mg]') is None
        next_change = soup.select_one('[data-next-change]')
        assert 'Resume this plan before future ceiling dates are scheduled' in (
            next_change.get_text(' ', strip=True)
        )
        assert next_change.select_one('time') is None

    def test_paused_observe_describes_neutral_observation_not_ceilings(
            self, logged_in_client, db_session, test_user):
        _plan(
            db_session,
            test_user,
            status='paused',
            mode='observe',
            baseline_source='observe',
            baseline_pouches=None,
            baseline_mg=None,
            baseline_strength=None,
            pace=None,
            end_target=None,
        )

        soup = BeautifulSoup(
            logged_in_client.get('/journey/').data, 'html.parser'
        )
        next_change = soup.select_one('[data-next-change]')
        text = next_change.get_text(' ', strip=True)

        assert 'Observation is paused' in text
        assert 'Resume when you want to continue neutral observation' in text
        assert 'ceiling dates' not in text.lower()
        assert next_change.select_one('time') is None
        assert soup.select_one('[data-difference-mg]') is None
        trajectory = soup.select_one('[data-journey-trajectory]')
        _assert_trajectory_owner(
            soup,
            count=7,
            accessible_name='7-day observation schedule',
        )
        assert all(
            day['data-ceiling-label'] == 'No nicotine ceiling'
            for day in trajectory.select('[data-journey-day]')
        )
        assert soup.select_one('[data-journey-trajectory-summary]').get_text(
            ' ', strip=True
        ) == 'These 7 observation days have no nicotine ceiling.'

    def test_pre_start_plan_names_first_ceiling_without_comparison(
            self, logged_in_client, db_session, test_user):
        start_date = date.today() + timedelta(days=2)
        _plan(db_session, test_user, start=start_date)

        soup = BeautifulSoup(
            logged_in_client.get('/journey/').data, 'html.parser'
        )
        next_change = soup.select_one('[data-next-change]')

        assert 'First ceiling begins at 48.00 mg' in next_change.get_text(
            ' ', strip=True
        )
        assert next_change.select_one('time')['datetime'] == (
            start_date.isoformat()
        )
        assert 'final scheduled ceiling' not in next_change.get_text(
            ' ', strip=True
        ).lower()
        selected = _assert_trajectory_owner(
            soup,
            count=7,
            accessible_name='7-day nicotine ceiling trajectory',
        )
        assert selected['data-date-label'] == start_date.strftime('%A')
        assert selected['data-change-label'] == 'First scheduled ceiling'

    def test_plan_flow_wraps_overview_schedule_maintenance_and_revision_fields(
            self, logged_in_client, db_session, test_user):
        _plan(db_session, test_user)

        soup = BeautifulSoup(
            logged_in_client.get('/journey/').data, 'html.parser'
        )
        plan = soup.select_one('.journey-plan')
        today_panel = plan.select_one(':scope > .journey-today')
        next_change = plan.select_one(':scope > .journey-next-change')
        schedule = plan.select_one(':scope > .journey-plan__schedule')
        maintenance = plan.select_one(':scope > .journey-plan__maintenance')
        details = plan.select_one(':scope > .journey-details')
        assert today_panel.select_one('#journey-today-title') is not None
        assert next_change.select_one('#journey-next-change-title') is not None
        assert schedule.select_one('.journey-schedule') is not None
        assert details.select_one('.journey-actions') is not None
        editor = maintenance.select_one('[data-plan-editor="revision"]')
        assert editor is not None

        direct_children = [child for child in plan.children if child.name]
        assert direct_children.index(today_panel) < direct_children.index(next_change)
        assert direct_children.index(next_change) < direct_children.index(schedule)
        assert direct_children.index(schedule) < direct_children.index(maintenance)
        assert direct_children.index(maintenance) < direct_children.index(details)
        assert plan.select_one('.journey-schedule').find_next(
            attrs={'data-plan-editor': 'revision'}
        ) == editor

        fields = editor.select_one('.journey-editor__fields')
        assert [control.get('name') for control in fields.select(
            'input[name], select[name]'
        )] == [
            'effective_date', 'pace', 'duration_days',
            'end_target_mg',
        ]
        assert len(fields.find_all('div', recursive=False)) == 4
        assert editor.select_one('.journey-editor__fields p') is None
        assert editor.select_one('.journey-editor__fields [role="alert"]') is None
        assert editor.select_one('.journey-editor__fields .journey-editor__buttons') is None
        assert editor.select_one('.journey-editor__fields [data-plan-editor-status]') is None
        assert editor.select_one('.journey-editor__fields [data-plan-editor-preview]') is None

    def test_today_progress_and_next_change_are_immediately_comprehensible(
            self, logged_in_client, db_session, test_user):
        authority = TodayService.get_summary(test_user.id)
        today = authority.local_date
        log_time = authority.window.start_utc.replace(tzinfo=None) + timedelta(
            hours=1
        )
        plan = _plan(db_session, test_user, start=today - timedelta(days=1))
        days = PlanDay.query.filter_by(plan_id=plan.id).order_by(
            PlanDay.local_date
        ).all()
        for row in days:
            row.target_pouches = None
        days[1].nicotine_ceiling_mg = Decimal('36.00')
        days[2].nicotine_ceiling_mg = Decimal('36.00')
        days[3].nicotine_ceiling_mg = Decimal('30.00')
        plan.end_target_pouches = None
        plan.baseline_pouches = None
        plan.end_target_mg = Decimal('30.00')
        plan.active_revision.end_target_pouches = None
        plan.active_revision.end_target_mg = Decimal('30.00')
        plan.active_revision.generation_inputs = {
            'target_basis': 'nicotine_mg',
            'end_target_mg': '30.00',
        }
        db_session.add(Log(
            user_id=test_user.id,
            log_time=log_time,
            quantity=2,
            nicotine_mg_snapshot=Decimal('6.00'),
            product_brand_snapshot='Known fixture',
        ))
        db_session.commit()

        soup = BeautifulSoup(
            logged_in_client.get('/journey/').data, 'html.parser'
        )
        progress = soup.select_one('[data-journey-progress]')
        assert progress is not None
        assert progress.select_one('[data-known-mg]').get_text(strip=True) == '12.00 mg'
        assert progress.select_one('[data-ceiling-mg]').get_text(strip=True) == '36.00 mg'
        assert progress.select_one('[data-difference-mg]').get_text(
            strip=True
        ) == '−24.00 mg'
        assert 'Below today’s ceiling' in progress.get_text(' ', strip=True)
        assert 'Pouches logged' not in progress.get_text(' ', strip=True)
        pouch_context = soup.select_one('[data-pouch-context]')
        assert pouch_context.get_text(' ', strip=True) == 'Pouches logged 2'
        assert pouch_context.find_previous('table').has_attr(
            'data-mobile-schedule'
        )

        trajectory = soup.select_one('[data-journey-trajectory]')
        buttons = trajectory.select('[data-journey-day]')
        assert buttons[0]['data-change-label'] == 'Current ceiling'
        assert buttons[1]['data-change-label'] == 'Ceiling unchanged'
        assert buttons[2]['data-change-label'] == '6.00 mg lower'

        complete_schedule = soup.select_one('[data-complete-schedule]')
        assert [cell.get_text(' ', strip=True) for cell in complete_schedule.select('thead th')] == [
            'Date', 'Nicotine ceiling',
        ]
        assert 'Observation' not in complete_schedule.get_text(' ', strip=True)
        assert 'Not used' not in complete_schedule.get_text(' ', strip=True)
        plan_facts = soup.select_one('[aria-labelledby="plan-facts-title"]')
        assert 'Historical pouch baseline' not in plan_facts.get_text(' ', strip=True)

        next_change = soup.select_one('[data-next-change]')
        assert next_change is not None
        assert next_change.select_one('time')['datetime'] == (
            today + timedelta(days=2)
        ).isoformat()
        assert '30.00 mg' in next_change.get_text(' ', strip=True)
        assert '6.00 mg lower' in next_change.get_text(' ', strip=True)

    def test_unknown_strength_shows_known_subtotal_without_false_remaining(
            self, logged_in_client, db_session, test_user):
        authority = TodayService.get_summary(test_user.id)
        today = authority.local_date
        log_time = authority.window.start_utc.replace(tzinfo=None) + timedelta(
            hours=1
        )
        plan = _plan(db_session, test_user, start=today)
        for row in PlanDay.query.filter_by(plan_id=plan.id):
            row.target_pouches = None
        plan.end_target_pouches = None
        plan.end_target_mg = Decimal('48.00')
        plan.active_revision.end_target_pouches = None
        plan.active_revision.end_target_mg = Decimal('48.00')
        plan.active_revision.generation_inputs = {
            'target_basis': 'nicotine_mg',
            'end_target_mg': '48.00',
        }
        db_session.add_all([
            Log(
                user_id=test_user.id,
                log_time=log_time,
                quantity=1,
                nicotine_mg_snapshot=Decimal('6.00'),
                product_brand_snapshot='Known fixture',
            ),
            Log(
                user_id=test_user.id,
                log_time=log_time + timedelta(minutes=1),
                quantity=1,
                nicotine_mg_snapshot=None,
                product_brand_snapshot='Unknown fixture',
            ),
        ])
        db_session.commit()

        soup = BeautifulSoup(
            logged_in_client.get('/journey/').data, 'html.parser'
        )
        progress = soup.select_one('[data-journey-progress]')
        text = progress.get_text(' ', strip=True)
        assert 'Known nicotine 6.00 mg' in text
        assert 'Nicotine total incomplete' in text
        assert progress.select_one('[data-remaining-mg]') is None
        assert progress.select_one('[data-difference-mg]') is None
        assert progress.select_one('[data-journey-scorecard]') is not None
        assert '%' not in text
        assert 'on track' not in text.lower()

    def test_paused_plan_keeps_unknown_strength_total_incomplete_and_neutral(
            self, logged_in_client, db_session, test_user):
        authority = TodayService.get_summary(test_user.id)
        plan = _plan(db_session, test_user, status='paused', start=authority.local_date)
        db_session.add(Log(
            user_id=test_user.id,
            log_time=authority.window.start_utc.replace(tzinfo=None) + timedelta(hours=1),
            quantity=2,
            nicotine_mg_snapshot=None,
            product_brand_snapshot='Unknown paused fixture',
        ))
        db_session.commit()

        soup = BeautifulSoup(logged_in_client.get('/journey/').data, 'html.parser')
        progress = soup.select_one('[data-journey-progress]')
        text = progress.get_text(' ', strip=True)
        assert 'Plan paused' in text
        assert 'Nicotine total incomplete' in text
        assert 'Total Incomplete' in text
        assert progress.select_one('[data-remaining-mg]') is None
        assert 'on track' not in text.lower()

    def test_active_plan_renders_truthful_baseline_schedule_history_and_milestones(
            self, logged_in_client, db_session, test_user):
        today = date.today()
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
        assert soup.select_one('.journey-plan') is not None
        assert soup.select_one('.journey-today') is not None
        assert soup.select_one('.journey-next-change') is not None
        assert soup.select_one('.journey-schedule') is not None
        assert soup.select_one('.journey-history') is not None
        assert 'Manual baseline' in text
        assert 'Historical pouch guide 8.00 pouches per day' in text
        assert '48.00 mg per day' in text
        assert '6.00 mg per pouch' in text
        assert 'Today in this plan' in text
        assert 'Your next seven days' in text
        assert len(soup.select('[data-mobile-schedule] tbody tr')) == 7
        assert len(soup.select('[data-complete-schedule] tbody tr')) == 10
        assert len(soup.select('.journey-history-list > li')) >= 3
        assert 'Plan change 2' in text
        assert 'Plan change 3' in text
        assert 'Historical pouch guide: 6' in text
        assert 'paused' in text.lower()
        assert '2026-01-03 10:00' in text
        assert '2026-01-05 11:00' in text
        assert 'ongoing' in text.lower()
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
        assert 'Starting nicotine Not known' in text
        assert 'Usual pouch strength Not provided' in text
        assert '0.00 mg' not in text
        soup = BeautifulSoup(response.data, 'html.parser')
        assert soup.select_one('[data-journey-scorecard]') is None
        assert soup.select_one('[data-journey-trajectory]') is None

    def test_observe_and_short_schedule_render_only_real_day_controls(
            self, logged_in_client, db_session, test_user):
        authority = TodayService.get_summary(test_user.id)
        _plan(
            db_session,
            test_user,
            mode='observe',
            start=authority.local_date,
            length=3,
            baseline_source='observe',
            baseline_pouches=None,
            baseline_mg=None,
            baseline_strength=None,
            pace=None,
            end_target=None,
        )

        soup = BeautifulSoup(
            logged_in_client.get('/journey/').data, 'html.parser'
        )
        trajectory = soup.select_one('[data-journey-trajectory]')
        selected = _assert_trajectory_owner(
            soup,
            count=3,
            accessible_name='3-day observation schedule',
        )
        assert selected['data-date-label'] == authority.local_date.strftime(
            '%A'
        )
        assert len(soup.select('[data-mobile-schedule] tbody tr')) == 3
        assert all(
            button['data-ceiling-label'] == 'No nicotine ceiling'
            for button in trajectory.select('[data-journey-day]')
        )
        assert soup.select_one('[data-difference-mg]') is None

    def test_short_targeted_schedule_name_and_owner_match_real_rows(
            self, logged_in_client, db_session, test_user):
        authority = TodayService.get_summary(test_user.id)
        _plan(
            db_session,
            test_user,
            start=authority.local_date,
            length=3,
        )

        soup = BeautifulSoup(
            logged_in_client.get('/journey/').data, 'html.parser'
        )
        selected = _assert_trajectory_owner(
            soup,
            count=3,
            accessible_name='3-day nicotine ceiling trajectory',
        )
        assert selected['data-date-label'] == authority.local_date.strftime(
            '%A'
        )
        assert len(soup.select('[data-mobile-schedule] tbody tr')) == 3

    def test_exhausted_schedule_keeps_history_without_empty_trajectory(
            self, logged_in_client, db_session, test_user):
        authority = TodayService.get_summary(test_user.id)
        _plan(
            db_session,
            test_user,
            start=authority.local_date - timedelta(days=5),
            length=3,
        )

        soup = BeautifulSoup(
            logged_in_client.get('/journey/').data, 'html.parser'
        )
        assert soup.select_one('[data-journey-trajectory]') is None
        assert soup.select_one('[data-mobile-schedule]') is None
        assert 'No future days are scheduled' in soup.get_text(' ', strip=True)
        assert len(soup.select('[data-complete-schedule] tbody tr')) == 3
        assert soup.select_one('.journey-history') is not None

    def test_persisted_zero_draft_values_are_not_mislabeled_unknown(
            self, logged_in_client, db_session, test_user):
        _plan(
            db_session, test_user, status='draft', mode='reduce',
            baseline_source='manual', baseline_pouches='0.00',
            baseline_mg='0.00', baseline_strength='0.00', pace=None,
            end_target=0, with_revision=False,
        )

        text = _text(logged_in_client.get('/journey/'))

        assert 'Historical pouch guide 0.00 pouches per day' in text
        assert 'Starting nicotine 0.00 mg per day' in text
        assert 'Usual pouch strength 0.00 mg per pouch' in text

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
        for row in PlanDay.query.filter_by(plan_id=plan.id):
            row.target_pouches = None
        plan.end_target_pouches = None
        plan.active_revision.end_target_pouches = None
        plan.active_revision.generation_inputs = {
            'target_basis': 'nicotine_mg',
            'end_target_mg': str(plan.end_target_mg),
        }
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
        preview_tables = soup.select('[data-resume-preview-stages], [data-resume-preview]')
        assert preview_tables
        for table in preview_tables:
            text = table.get_text(' ', strip=True)
            assert 'Historical pouch guide' not in text
            assert 'Not used' not in text
            assert all(
                len(row.select('th, td')) == 2
                for row in table.select('tr')
            )
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
            'end_target_mg': '12.00',
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
        assert [row.target_pouches for row in historical] == [
            row[3] for row in historical_bytes
        ]
        new_future = PlanDay.query.filter(
            PlanDay.plan_id == plan.id,
            PlanDay.local_date >= effective,
        ).all()
        assert new_future
        assert all(row.target_pouches is None for row in new_future)
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

    @pytest.mark.parametrize('field,value', [
        ('pace', 'focused'),
        ('duration_days', '42'),
    ])
    def test_legacy_editor_prefills_mg_and_converts_pace_or_duration_edit(
            self, logged_in_client, db_session, test_user, field, value):
        today = date.today()
        plan = _legacy_plan(db_session, test_user, start=today)
        effective = today + timedelta(days=1)
        historical = PlanDay.query.filter(
            PlanDay.plan_id == plan.id,
            PlanDay.local_date < effective,
        ).order_by(PlanDay.id).all()
        historical_bytes = [
            (row.id, row.revision_id, row.local_date, row.target_pouches,
             row.nicotine_ceiling_mg, row.created_at)
            for row in historical
        ]

        initial = BeautifulSoup(
            logged_in_client.get('/journey/').data, 'html.parser'
        )
        target = initial.select_one('#revision-end-target')
        assert target['value'] == '12.00'
        assert target.has_attr('required')
        data = {
            'form_action': 'preview',
            'effective_date': effective.isoformat(),
            'pace': '',
            'duration_days': '',
            'end_target_mg': target['value'],
            field: value,
        }
        preview_response = logged_in_client.post(
            f'/journey/plans/{plan.id}/revision', data=data
        )
        assert preview_response.status_code == 200
        preview_soup = BeautifulSoup(preview_response.data, 'html.parser')
        digest = preview_soup.select_one(
            'form[data-revision-confirm] input[name="preview_digest"]'
        )['value']

        confirmed = logged_in_client.post(
            f'/journey/plans/{plan.id}/revision',
            data=dict(data, form_action='confirm', preview_digest=digest),
        )
        assert confirmed.status_code == 302
        assert [
            (row.id, row.revision_id, row.local_date, row.target_pouches,
             row.nicotine_ceiling_mg, row.created_at)
            for row in historical
        ] == historical_bytes
        future = PlanDay.query.filter(
            PlanDay.plan_id == plan.id,
            PlanDay.local_date >= effective,
        ).all()
        assert future
        assert all(row.target_pouches is None for row in future)
        db_session.refresh(plan)
        assert plan.end_target_pouches is None
        assert plan.active_revision.generation_inputs['target_basis'] == (
            'nicotine_mg'
        )

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
