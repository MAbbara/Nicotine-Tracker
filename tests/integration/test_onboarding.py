"""Integration contracts for the progressively enhanced onboarding form."""

from datetime import datetime, timedelta, timezone
from decimal import Decimal

from bs4 import BeautifulSoup

from extensions import db
from models import (
    Log,
    OnboardingDraft,
    Pouch,
    ReductionPlan,
    User,
    UserPreferredPouch,
)
from services import log_service
from services.onboarding_draft_service import OnboardingDraftService


def _manual_form(**overrides):
    data = {
        'intention': 'reduce',
        'baseline_source': 'manual',
        'baseline_mg': '48',
        'baseline_mg_per_pouch': '6',
        'pace': 'steady',
        'end_target_mg': '12',
        'target_date': '',
        'start_date': '2099-01-01',
        'difficult_times': ['morning', 'evening'],
        'common_triggers': ['stress', 'routine'],
        'preferred_pouch_ids': [],
        'reminder_window': 'morning',
        'form_action': 'preview',
    }
    data.update(overrides)
    return data


def _preview(client, data=None):
    response = client.post(
        '/journey/onboarding', data=data or _manual_form()
    )
    assert response.status_code == 200
    soup = BeautifulSoup(response.data, 'html.parser')
    digest = soup.select_one('input[name="preview_digest"]')
    assert digest is not None and len(digest.get('value', '')) == 64
    return response, digest['value']


def _seed_complete_days(session, user, pouch, *, days=4, quantity=8):
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    for offset in range(1, days + 1):
        log = Log(
            user_id=user.id,
            quantity=quantity,
            log_time=(now - timedelta(days=offset)).replace(
                hour=12, minute=0, second=0, microsecond=0,
            ),
        )
        log_service.assign_log_product(log, pouch_id=pouch.id)
        session.add(log)
    session.commit()


class TestOnboardingPage:
    def test_login_is_required(self, client):
        response = client.get('/journey/onboarding')
        assert response.status_code == 302
        assert '/auth/login' in response.headers['Location']

    def test_all_five_steps_share_one_semantic_no_js_form(
            self, logged_in_client):
        response = logged_in_client.get('/journey/onboarding')
        assert response.status_code == 200
        soup = BeautifulSoup(response.data, 'html.parser')
        forms = soup.select('form[method="post"]')
        assert len(forms) == 1
        form = forms[0]
        assert form.select_one('input[name="csrf_token"]') is not None
        assert [section['data-onboarding-step'] for section in form.select(
            '[data-onboarding-step]'
        )] == ['intention', 'baseline', 'pace', 'support', 'review']
        assert len(form.select('fieldset > legend')) >= 8
        assert form.select_one('[aria-live="polite"]') is not None
        assert form.select_one('button[name="form_action"][value="preview"]')
        copy = form.get_text(' ', strip=True)
        assert 'Work toward a lower daily nicotine ceiling.' in copy
        assert 'lower daily pouch ceiling' not in copy
        steady = form.select_one('input[name="pace"][value="steady"]')
        assert steady is not None and not steady.has_attr('checked')
        assert 'recommended' in form.get_text(' ', strip=True).lower()

    def test_get_resumes_canonical_draft_and_filters_foreign_pouches(
            self, logged_in_client, db_session, test_user):
        default = Pouch(
            brand='Shared', nicotine_mg=Decimal('3.00'), is_default=True,
        )
        owned = Pouch(
            brand='Mine', nicotine_mg=Decimal('5.00'), is_default=False,
            created_by=test_user.id,
        )
        other = User(email='other-onboarding@example.com', timezone='UTC')
        other.set_password('password123')
        db_session.add_all([default, owned, other])
        db_session.flush()
        foreign = Pouch(
            brand='Private other', nicotine_mg=Decimal('9.00'),
            is_default=False, created_by=other.id,
        )
        db_session.add(foreign)
        db_session.commit()
        OnboardingDraftService().save(test_user.id, 'support', {
            'intention': 'reduce',
            'target_basis': 'nicotine_mg',
            'baseline_source': 'manual',
            'baseline_mg': '35.00',
            'baseline_mg_per_pouch': '5.00',
            'pace': 'gentle',
            'start_date': '2099-01-01',
            'end_target_mg': '5.00',
            'difficult_times': ['after_meals'],
            'preferred_pouch_ids': [owned.id],
            'reminder_window': 'evening',
        })

        response = logged_in_client.get('/journey/onboarding')
        soup = BeautifulSoup(response.data, 'html.parser')
        assert soup.select_one('input[name="baseline_mg"]')['value'] == '35.00'
        assert soup.select_one('input[name="baseline_pouches"]') is None
        assert soup.select_one('input[name="end_target_mg"]')['value'] == '5.00'
        assert soup.select_one('input[name="pace"][value="gentle"]').has_attr(
            'checked'
        )
        owned_control = soup.select_one(
            f'input[name="preferred_pouch_ids"][value="{owned.id}"]'
        )
        assert owned_control is not None and owned_control.has_attr('checked')
        assert soup.select_one(
            f'input[name="preferred_pouch_ids"][value="{default.id}"]'
        ) is not None
        assert soup.select_one(
            f'input[name="preferred_pouch_ids"][value="{foreign.id}"]'
        ) is None

    def test_recent_log_baseline_preview_uses_server_suggestion(
            self, logged_in_client, db_session, test_user, test_pouch):
        _seed_complete_days(db_session, test_user, test_pouch)
        response, _ = _preview(logged_in_client, _manual_form(
            baseline_source='recent_logs',
            baseline_mg='',
            baseline_mg_per_pouch='',
        ))
        text = BeautifulSoup(response.data, 'html.parser').get_text(' ', strip=True)
        assert 'Based on 4 complete logged days' in text
        assert '32.00 mg nicotine per day' in text
        assert '4.00 mg per pouch' in text


class TestNoJavascriptPreviewAndConfirm:
    def test_preview_is_read_only_and_saves_review_draft(
            self, logged_in_client, test_user):
        response, _ = _preview(logged_in_client)
        assert b'Complete daily schedule' in response.data
        soup = BeautifulSoup(response.data, 'html.parser')
        decisions = soup.select_one('.review-decisions')
        terms = [node.get_text(' ', strip=True) for node in decisions.select('dt')]
        assert 'Historical pouch context' not in terms
        assert terms.index('Starting nicotine') < terms.index('Usual pouch strength')
        schedule = soup.select_one('[aria-label="Complete daily schedule"] table')
        assert [node.get_text(' ', strip=True) for node in schedule.select('thead th')] == [
            'Date', 'Nicotine ceiling',
        ]
        assert all(len(row.select('th, td')) == 2 for row in schedule.select('tbody tr'))
        assert 'Observe' not in schedule.get_text(' ', strip=True)
        assert ReductionPlan.query.filter_by(user_id=test_user.id).count() == 0
        draft = OnboardingDraft.query.filter_by(user_id=test_user.id).one()
        assert draft.current_step == 'review'
        assert draft.structured_payload['target_basis'] == 'nicotine_mg'
        assert draft.structured_payload['baseline_mg'] == '48.00'
        assert draft.structured_payload['end_target_mg'] == '12.00'
        assert draft.structured_payload['difficult_times'] == [
            'morning', 'evening'
        ]

    def test_field_error_is_linked_and_preserves_submitted_answer(
            self, logged_in_client):
        response = logged_in_client.post(
            '/journey/onboarding',
            data=_manual_form(end_target_mg='48'),
        )
        assert response.status_code == 422
        soup = BeautifulSoup(response.data, 'html.parser')
        control = soup.select_one('input[name="end_target_mg"]')
        assert control['value'] == '48'
        error_id = control.get('aria-describedby', '').split()[-1]
        assert error_id
        error = soup.select_one(f'#{error_id}')
        assert error is not None
        assert 'below' in error.get_text(' ', strip=True).lower()
        assert soup.select_one('[role="alert"]') is not None

    def test_explicit_confirm_activates_and_promotes_support_preferences(
            self, logged_in_client, db_session, test_user, test_pouch):
        form = _manual_form(preferred_pouch_ids=[str(test_pouch.id)])
        _, digest = _preview(logged_in_client, form)
        form.update(form_action='confirm', preview_digest=digest)

        response = logged_in_client.post('/journey/onboarding', data=form)
        assert response.status_code == 302
        assert response.headers['Location'].endswith('/today/')

        plan = ReductionPlan.query.filter_by(user_id=test_user.id).one()
        assert plan.status == 'active'
        assert plan.active_slot == 1
        assert plan.end_target_mg == Decimal('12.00')
        assert plan.end_target_pouches is None
        assert OnboardingDraft.query.filter_by(user_id=test_user.id).count() == 0
        db_session.refresh(test_user.preferences)
        assert test_user.preferences.difficult_times == ['morning', 'evening']
        assert test_user.preferences.common_triggers == ['stress', 'routine']
        assert test_user.preferences.daily_reminders is True
        assert test_user.preferences.reminder_time.strftime('%H:%M') == '08:00'
        links = UserPreferredPouch.query.filter_by(
            user_id=test_user.id
        ).order_by(UserPreferredPouch.rank).all()
        assert [(link.pouch_id, link.rank) for link in links] == [
            (test_pouch.id, 0)
        ]

    def test_stale_confirmation_renders_fresh_unconfirmed_review(
            self, logged_in_client, test_user):
        form = _manual_form()
        _, old_digest = _preview(logged_in_client, form)
        form.update(
            form_action='confirm',
            preview_digest=old_digest,
            start_date='2099-01-02',
        )

        response = logged_in_client.post('/journey/onboarding', data=form)
        assert response.status_code == 409
        soup = BeautifulSoup(response.data, 'html.parser')
        assert 'changed since this preview' in soup.get_text(' ', strip=True)
        fresh_digest = soup.select_one('input[name="preview_digest"]')['value']
        assert fresh_digest != old_digest
        assert ReductionPlan.query.filter_by(user_id=test_user.id).count() == 0
        assert OnboardingDraft.query.filter_by(user_id=test_user.id).count() == 1


class TestRegistrationOnboardingRedirect:
    def test_registration_establishes_session_and_redirects_to_onboarding(
            self, client):
        response = client.post('/auth/register', data={
            'email': 'new-onboarding@example.com',
            'password': 'password123',
            'confirm_password': 'password123',
        })
        assert response.status_code == 302
        assert response.headers['Location'].endswith('/journey/onboarding')
        user = db.session.execute(
            db.select(User).filter_by(email='new-onboarding@example.com')
        ).scalar_one()
        with client.session_transaction() as browser_session:
            assert browser_session['user_id'] == user.id
            assert browser_session['user_email'] == user.email
            assert browser_session['user_timezone'] == 'UTC'
