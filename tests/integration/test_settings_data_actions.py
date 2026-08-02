from datetime import datetime, timedelta
from decimal import Decimal
from pathlib import Path

from bs4 import BeautifulSoup
from werkzeug.datastructures import MultiDict

from models import DailyCheckIn, Goal, Log, Pouch, UserPreferences
from routes.settings import _retention_cutoff_utc
from services.log_service import assign_log_product


SUPPORTED_ACTIONS = {
    'export_data', 'cleanup_duplicates', 'merge_custom_pouches',
    'recalculate_goals', 'anonymize_data', 'delete_old_logs',
}
PROJECT_ROOT = Path(__file__).resolve().parents[2]


def _snapshot_data_state(user):
    """Capture every state family a data action is allowed to affect."""
    return {
        'profile': (user.age, user.gender, user.weight),
        'logs': tuple(
            (log.id, log.pouch_id, log.notes, log.log_time)
            for log in Log.query.filter_by(user_id=user.id).order_by(Log.id)
        ),
        'pouch_ids': tuple(
            pouch.id for pouch in Pouch.query.filter_by(created_by=user.id)
            .order_by(Pouch.id)
        ),
        'goal_streaks': tuple(
            (goal.id, goal.current_streak, goal.best_streak)
            for goal in Goal.query.filter_by(user_id=user.id).order_by(Goal.id)
        ),
    }


def _assert_state_unchanged_except(before, after, *changed_families):
    for family in before:
        if family not in changed_families:
            assert after[family] == before[family], (
                f'{family} changed while dispatching an unrelated data action'
            )


def _submit_data_button(client, label, *, overrides=None):
    """Submit the successful controls a browser sends for one clicked button."""
    page = client.get('/settings/data')
    document = BeautifulSoup(page.data, 'html.parser')
    button = next(
        candidate for candidate in document.find_all('button')
        if candidate.get_text(' ', strip=True) == label
    )
    form = button.find_parent('form')
    override_values = overrides or {}
    payload = MultiDict()
    for control in form.find_all('input'):
        name = control.get('name')
        if not name or control.has_attr('disabled'):
            continue
        if control.get('type', 'text') in {'button', 'reset', 'submit'}:
            continue
        if name in override_values:
            continue
        payload.add(name, control.get('value', ''))
    if button.get('name'):
        payload.add(button['name'], button.get('value', ''))
    for name, value in override_values.items():
        payload.add(name, value)
    return client.post('/settings/data', data=payload, follow_redirects=True)


def _seed_common_state(db_session, test_user, test_pouch, test_goal):
    test_user.age = 34
    test_user.gender = 'nonbinary'
    test_user.weight = 72.5
    test_goal.current_streak = 7
    test_goal.best_streak = 11
    preferences = UserPreferences(
        user_id=test_user.id,
        preferred_brands=['Test Brand'],
        units_preference='percentage',
    )
    log = Log(
        user_id=test_user.id,
        quantity=1,
        log_time=datetime.utcnow() - timedelta(days=2),
        notes='private note',
    )
    assign_log_product(log, pouch_id=test_pouch.id)
    db_session.add_all([preferences, log])
    db_session.commit()
    return preferences, log


def test_data_page_exposes_each_supported_action_once(
    logged_in_client,
):
    response = logged_in_client.get('/settings/data')
    document = BeautifulSoup(response.data, 'html.parser')

    action_controls = document.select('[name="action"]')
    rendered_actions = [control.get('value') for control in action_controls]

    assert len(rendered_actions) == len(SUPPORTED_ACTIONS)
    assert set(rendered_actions) == SUPPORTED_ACTIONS


def test_data_page_orders_actions_by_risk_and_explains_recoverability(
    logged_in_client,
):
    response = logged_in_client.get('/settings/data')
    document = BeautifulSoup(response.data, 'html.parser')

    assert document.select_one('main h1').get_text(' ', strip=True) == (
        'Data & privacy'
    )
    assert [heading.get_text(' ', strip=True) for heading in document.select(
        '.data-section h2'
    )] == ['Export', 'Offline use', 'Anonymize', 'Delete logs', 'Delete account']

    forms = {
        action['value']: action.find_parent('form')
        for action in document.select('[name="action"]')
    }
    assert set(forms) == SUPPORTED_ACTIONS
    assert all(form.select_one('input[name="csrf_token"]') for form in forms.values())
    assert forms['export_data'].select_one('button.c-button--secondary')
    assert not forms['export_data'].select_one('.c-button--danger')

    cleanup = forms['cleanup_duplicates']
    cleanup_confirmation = cleanup.select_one(
        'input[name="confirm_cleanup_duplicates"][pattern="CLEANUP"][required]'
    )
    assert cleanup_confirmation is not None
    assert 'confirm-cleanup-description' in cleanup_confirmation.get(
        'aria-describedby', ''
    )
    assert cleanup.select_one('button.c-button--danger')
    cleanup_copy = cleanup.get_text(' ', strip=True).casefold()
    assert 'permanent' in cleanup_copy
    assert 'cannot be recovered' in cleanup_copy
    assert 'keeps one' in cleanup_copy

    merge = forms['merge_custom_pouches']
    merge_confirmation = merge.select_one(
        'input[name="confirm_merge_pouches"][pattern="MERGE"][required]'
    )
    assert merge_confirmation is not None
    assert 'confirm-merge-description' in merge_confirmation.get(
        'aria-describedby', ''
    )
    assert merge.select_one('button.c-button--danger')
    merge_copy = merge.get_text(' ', strip=True).casefold()
    assert 'permanent' in merge_copy
    assert 'cannot be recovered' in merge_copy
    assert 'reconnect' in merge_copy

    assert forms['recalculate_goals'].select_one('button.c-button--secondary')
    assert not forms['recalculate_goals'].select_one('.c-button--danger')

    offline = document.select_one(
        'input#offline_queue_enabled[type="checkbox"]'
        '[data-endpoint="/settings/privacy/offline-queue"]'
    )
    assert offline is not None
    assert 'offline-queue-description' in offline.get('aria-describedby', '')
    assert document.select_one(
        '#offline-queue-status[role="status"][aria-live="polite"]'
    )

    anonymize = forms['anonymize_data']
    anonymize_input = anonymize.select_one(
        'input[name="confirm_anonymize"][pattern="ANONYMIZE"][required]'
    )
    assert anonymize_input is not None
    assert 'confirm-anonymize-description' in anonymize_input.get(
        'aria-describedby', ''
    )
    assert anonymize.select_one('button.c-button--danger')
    anonymize_copy = anonymize.get_text(' ', strip=True).casefold()
    assert 'cannot be undone' in anonymize_copy
    assert 'age' in anonymize_copy and 'notes' in anonymize_copy

    delete_logs = forms['delete_old_logs']
    confirmation = delete_logs.select_one(
        'input[name="confirm_delete_logs"][pattern="DELETE LOGS"][required]'
    )
    assert confirmation is not None
    assert 'confirm-delete-logs-description' in confirmation.get(
        'aria-describedby', ''
    )
    assert delete_logs.select_one('button.c-button--danger')
    delete_copy = delete_logs.get_text(' ', strip=True).casefold()
    assert 'permanent' in delete_copy
    assert 'cannot be recovered' in delete_copy

    account_link = document.select_one(
        'a.c-button--danger[href="/settings/account#account-delete-title"]'
    )
    assert account_link is not None
    account_copy = account_link.find_parent('section').get_text(
        ' ', strip=True
    ).casefold()
    assert 'all associated data' in account_copy
    assert 'cannot be recovered' in account_copy


def test_offline_queue_privacy_endpoint_persists_boolean(
        logged_in_client, db_session, test_user):
    response = logged_in_client.patch(
        '/settings/privacy/offline-queue', json={'enabled': False},
    )
    assert response.status_code == 200
    assert response.get_json()['offline_queue']['enabled'] is False
    preferences = UserPreferences.query.filter_by(user_id=test_user.id).one()
    assert preferences.offline_queue_enabled is False

    response = logged_in_client.patch(
        '/settings/privacy/offline-queue', json={'enabled': True},
    )
    assert response.status_code == 200
    db_session.refresh(preferences)
    assert preferences.offline_queue_enabled is True


def test_data_template_retires_legacy_cards_and_palette():
    source = (PROJECT_ROOT / 'templates/settings/data.html').read_text().casefold()
    for token in (
        'bg-indigo-', 'text-indigo-', 'ring-indigo-', 'bg-violet-',
        'bg-purple-', 'bg-blue-', 'bg-gray-', 'dark:bg-gray-',
        'shadow rounded-lg',
    ):
        assert token not in source


def test_data_page_rejects_multiple_actions_without_mutation(
    logged_in_client, test_user, db_session,
):
    before = (test_user.age, test_user.gender, test_user.weight)
    response = logged_in_client.post(
        '/settings/data',
        data=MultiDict([
            ('action', 'anonymize_data'),
            ('action', 'delete_old_logs'),
            ('confirm_anonymize', 'ANONYMIZE'),
            ('confirm_delete_logs', 'DELETE LOGS'),
            ('days_to_keep', '30'),
        ]),
        follow_redirects=True,
    )
    db_session.refresh(test_user)
    assert response.status_code == 200
    assert b'Choose one data action and try again.' in response.data
    assert (test_user.age, test_user.gender, test_user.weight) == before


def test_data_page_rejects_absent_action_without_mutation(
    logged_in_client, db_session, test_user, test_pouch, test_goal,
):
    _seed_common_state(db_session, test_user, test_pouch, test_goal)
    before = _snapshot_data_state(test_user)

    response = logged_in_client.post(
        '/settings/data', data={}, follow_redirects=True,
    )

    db_session.refresh(test_user)
    assert response.status_code == 200
    assert b'Choose one data action and try again.' in response.data
    assert _snapshot_data_state(test_user) == before


def test_data_page_rejects_unknown_action_without_mutation(
    logged_in_client, db_session, test_user, test_pouch, test_goal,
):
    _seed_common_state(db_session, test_user, test_pouch, test_goal)
    before = _snapshot_data_state(test_user)

    response = logged_in_client.post(
        '/settings/data', data={'action': 'erase_everything'},
        follow_redirects=True,
    )

    db_session.refresh(test_user)
    assert response.status_code == 200
    assert b'Choose one data action and try again.' in response.data
    assert _snapshot_data_state(test_user) == before


def test_export_button_exports_data_without_mutation(
    logged_in_client, db_session, test_user, test_pouch, test_goal,
):
    _seed_common_state(db_session, test_user, test_pouch, test_goal)
    before = _snapshot_data_state(test_user)

    response = _submit_data_button(logged_in_client, 'Download Data')

    assert response.status_code == 200
    assert response.get_json()['profile']['email'] == test_user.email
    assert _snapshot_data_state(test_user) == before


def test_export_uses_non_mutating_defaults_when_preferences_are_missing(
        logged_in_client, test_user):
    assert UserPreferences.query.filter_by(user_id=test_user.id).first() is None

    response = _submit_data_button(logged_in_client, 'Download Data')

    assert response.status_code == 200
    assert response.headers['Content-Disposition'].startswith(
        'attachment; filename=nicotine_tracker_data_'
    )
    profile = response.get_json()['profile']
    assert profile['units_preference'] == 'mg'
    assert profile['preferred_brands'] is None
    assert UserPreferences.query.filter_by(user_id=test_user.id).first() is None


def test_cleanup_button_removes_only_duplicate_logs(
    logged_in_client, db_session, test_user, test_pouch, test_goal,
):
    _seed_common_state(db_session, test_user, test_pouch, test_goal)
    duplicate_time = datetime(2026, 1, 2, 9, 30)
    duplicates = []
    for _ in range(2):
        duplicate = Log(
            user_id=test_user.id,
            quantity=2,
            log_time=duplicate_time,
            notes='same note',
        )
        assign_log_product(duplicate, pouch_id=test_pouch.id)
        db_session.add(duplicate)
        duplicates.append(duplicate)
    db_session.commit()
    before = _snapshot_data_state(test_user)
    before_ids = {row[0] for row in before['logs']}

    response = _submit_data_button(
        logged_in_client,
        'Cleanup',
        overrides={'confirm_cleanup_duplicates': 'CLEANUP'},
    )

    after = _snapshot_data_state(test_user)
    assert response.status_code == 200
    assert b'Removed 1 duplicate log entries.' in response.data
    assert {row[0] for row in after['logs']} == before_ids - {duplicates[1].id}
    _assert_state_unchanged_except(before, after, 'logs')


def test_cleanup_button_rejects_inexact_confirmation_without_mutation(
    logged_in_client, db_session, test_user, test_pouch, test_goal,
):
    _seed_common_state(db_session, test_user, test_pouch, test_goal)
    duplicate_time = datetime(2026, 1, 2, 9, 30)
    for _ in range(2):
        duplicate = Log(
            user_id=test_user.id,
            quantity=2,
            log_time=duplicate_time,
            notes='same note',
        )
        assign_log_product(duplicate, pouch_id=test_pouch.id)
        db_session.add(duplicate)
    db_session.commit()
    before = _snapshot_data_state(test_user)

    response = _submit_data_button(
        logged_in_client,
        'Cleanup',
        overrides={'confirm_cleanup_duplicates': 'cleanup'},
    )

    assert response.status_code == 200
    assert b'Type CLEANUP to confirm duplicate log removal.' in response.data
    assert _snapshot_data_state(test_user) == before


def test_merge_button_merges_only_matching_custom_pouches(
    logged_in_client, db_session, test_user, test_pouch, test_goal,
):
    _seed_common_state(db_session, test_user, test_pouch, test_goal)
    duplicate_pouch = Pouch(
        brand=' test brand ',
        nicotine_mg=Decimal('4.00'),
        is_default=False,
        created_by=test_user.id,
    )
    db_session.add(duplicate_pouch)
    db_session.flush()
    duplicate_log = Log(
        user_id=test_user.id,
        quantity=1,
        log_time=datetime.utcnow() - timedelta(days=1),
        notes='merge me',
    )
    assign_log_product(duplicate_log, pouch_id=duplicate_pouch.id)
    db_session.add(duplicate_log)
    db_session.commit()
    before = _snapshot_data_state(test_user)

    response = _submit_data_button(
        logged_in_client,
        'Merge',
        overrides={'confirm_merge_pouches': 'MERGE'},
    )

    after = _snapshot_data_state(test_user)
    assert response.status_code == 200
    assert b'Merged 1 similar pouch entries.' in response.data
    assert after['pouch_ids'] == (test_pouch.id,)
    assert duplicate_log.pouch_id == test_pouch.id
    _assert_state_unchanged_except(before, after, 'logs', 'pouch_ids')
    assert tuple((row[0], row[2], row[3]) for row in after['logs']) == tuple(
        (row[0], row[2], row[3]) for row in before['logs']
    )


def test_merge_button_rejects_inexact_confirmation_without_mutation(
    logged_in_client, db_session, test_user, test_pouch, test_goal,
):
    _seed_common_state(db_session, test_user, test_pouch, test_goal)
    duplicate_pouch = Pouch(
        brand=' test brand ',
        nicotine_mg=Decimal('4.00'),
        is_default=False,
        created_by=test_user.id,
    )
    db_session.add(duplicate_pouch)
    db_session.commit()
    before = _snapshot_data_state(test_user)

    response = _submit_data_button(
        logged_in_client,
        'Merge',
        overrides={'confirm_merge_pouches': 'merge'},
    )

    assert response.status_code == 200
    assert b'Type MERGE to confirm merging duplicate pouch records.' in response.data
    assert _snapshot_data_state(test_user) == before


def test_recalculate_button_changes_only_goal_streaks(
    logged_in_client, db_session, test_user, test_pouch, test_goal,
):
    _seed_common_state(db_session, test_user, test_pouch, test_goal)
    completed_day = datetime.utcnow().date() - timedelta(days=1)
    test_goal.start_date = completed_day
    test_goal.end_date = None
    test_goal.target_value = 10
    db_session.add(DailyCheckIn(
        user_id=test_user.id,
        local_date=completed_day,
    ))
    db_session.commit()
    before = _snapshot_data_state(test_user)

    response = _submit_data_button(logged_in_client, 'Recalculate')

    db_session.refresh(test_goal)
    after = _snapshot_data_state(test_user)
    assert response.status_code == 200
    assert b'Recalculated streaks for 1 goals.' in response.data
    assert (test_goal.current_streak, test_goal.best_streak) == (1, 1)
    _assert_state_unchanged_except(before, after, 'goal_streaks')


def test_anonymize_button_requires_exact_confirmation_and_anonymizes_only_profile_data(
    logged_in_client, db_session, test_user, test_pouch, test_goal,
):
    preferences, _ = _seed_common_state(
        db_session, test_user, test_pouch, test_goal,
    )
    before = _snapshot_data_state(test_user)

    response = _submit_data_button(
        logged_in_client,
        'Anonymize Data',
        overrides={'confirm_anonymize': 'ANONYMIZE'},
    )

    db_session.refresh(test_user)
    db_session.refresh(preferences)
    after = _snapshot_data_state(test_user)
    assert response.status_code == 200
    assert after['profile'] == (None, None, None)
    assert all(log[2] is None for log in after['logs'])
    assert preferences.preferred_brands is None
    assert preferences.units_preference == 'mg'
    _assert_state_unchanged_except(before, after, 'profile', 'logs')
    assert tuple((row[0], row[1], row[3]) for row in after['logs']) == tuple(
        (row[0], row[1], row[3]) for row in before['logs']
    )


def test_delete_logs_button_respects_the_30_day_retention_boundary(
    logged_in_client, db_session, test_user, test_pouch, test_goal,
):
    _seed_common_state(db_session, test_user, test_pouch, test_goal)
    cutoff = _retention_cutoff_utc(test_user, 30)
    before_cutoff = Log(
        user_id=test_user.id,
        quantity=1,
        log_time=cutoff - timedelta(microseconds=1),
        notes='delete',
    )
    at_cutoff = Log(
        user_id=test_user.id,
        quantity=1,
        log_time=cutoff,
        notes='keep boundary',
    )
    for log in (before_cutoff, at_cutoff):
        assign_log_product(log, pouch_id=test_pouch.id)
    db_session.add_all([before_cutoff, at_cutoff])
    db_session.commit()
    before = _snapshot_data_state(test_user)
    before_ids = {row[0] for row in before['logs']}

    response = _submit_data_button(
        logged_in_client,
        'Delete Logs',
        overrides={
            'days_to_keep': '30',
            'confirm_delete_logs': 'DELETE LOGS',
        },
    )

    after = _snapshot_data_state(test_user)
    remaining_ids = {row[0] for row in after['logs']}
    assert response.status_code == 200
    assert remaining_ids == before_ids - {before_cutoff.id}
    _assert_state_unchanged_except(before, after, 'logs')


def test_anonymize_rejects_invalid_confirmation_without_mutation(
    logged_in_client, db_session, test_user, test_pouch, test_goal,
):
    _seed_common_state(db_session, test_user, test_pouch, test_goal)
    before = _snapshot_data_state(test_user)

    response = logged_in_client.post(
        '/settings/data',
        data={
            'action': 'anonymize_data',
            'confirm_anonymize': 'anonymize',
        },
        follow_redirects=True,
    )

    db_session.refresh(test_user)
    assert response.status_code == 200
    assert b'Type ANONYMIZE to confirm anonymization.' in response.data
    assert _snapshot_data_state(test_user) == before


def test_delete_logs_rejects_invalid_confirmation_without_mutation(
    logged_in_client, db_session, test_user, test_pouch, test_goal,
):
    _seed_common_state(db_session, test_user, test_pouch, test_goal)
    old_log = Log(
        user_id=test_user.id,
        quantity=1,
        log_time=datetime.utcnow() - timedelta(days=60),
        notes='must remain',
    )
    assign_log_product(old_log, pouch_id=test_pouch.id)
    db_session.add(old_log)
    db_session.commit()
    before = _snapshot_data_state(test_user)

    response = logged_in_client.post(
        '/settings/data',
        data={
            'action': 'delete_old_logs',
            'days_to_keep': '30',
            'confirm_delete_logs': 'delete logs',
        },
        follow_redirects=True,
    )

    assert response.status_code == 200
    assert b'Type DELETE LOGS to confirm deletion.' in response.data
    assert _snapshot_data_state(test_user) == before


def test_delete_logs_rejects_retention_below_30_days_without_mutation(
    logged_in_client, db_session, test_user, test_pouch, test_goal,
):
    _seed_common_state(db_session, test_user, test_pouch, test_goal)
    before = _snapshot_data_state(test_user)

    response = logged_in_client.post(
        '/settings/data',
        data={
            'action': 'delete_old_logs',
            'days_to_keep': '29',
            'confirm_delete_logs': 'DELETE LOGS',
        },
        follow_redirects=True,
    )

    assert response.status_code == 200
    assert b'You must keep at least 30 days of data.' in response.data
    assert _snapshot_data_state(test_user) == before


def test_delete_logs_rejects_blank_retention_without_mutation(
    logged_in_client, db_session, test_user, test_pouch, test_goal,
):
    _seed_common_state(db_session, test_user, test_pouch, test_goal)
    very_old_log = Log(
        user_id=test_user.id,
        quantity=1,
        log_time=datetime.utcnow() - timedelta(days=500),
        notes='must remain after blank input',
    )
    assign_log_product(very_old_log, pouch_id=test_pouch.id)
    db_session.add(very_old_log)
    db_session.commit()
    before = _snapshot_data_state(test_user)

    response = logged_in_client.post(
        '/settings/data',
        data={
            'action': 'delete_old_logs',
            'days_to_keep': '',
            'confirm_delete_logs': 'DELETE LOGS',
        },
        follow_redirects=True,
    )

    assert response.status_code == 200
    assert b'Enter a whole number of days to keep.' in response.data
    assert _snapshot_data_state(test_user) == before


def test_delete_logs_rejects_non_numeric_retention_without_mutation(
    logged_in_client, db_session, test_user, test_pouch, test_goal,
):
    _seed_common_state(db_session, test_user, test_pouch, test_goal)
    very_old_log = Log(
        user_id=test_user.id,
        quantity=1,
        log_time=datetime.utcnow() - timedelta(days=500),
        notes='must remain after invalid input',
    )
    assign_log_product(very_old_log, pouch_id=test_pouch.id)
    db_session.add(very_old_log)
    db_session.commit()
    before = _snapshot_data_state(test_user)

    response = logged_in_client.post(
        '/settings/data',
        data={
            'action': 'delete_old_logs',
            'days_to_keep': 'not-a-number',
            'confirm_delete_logs': 'DELETE LOGS',
        },
        follow_redirects=True,
    )

    assert response.status_code == 200
    assert b'Enter a whole number of days to keep.' in response.data
    assert _snapshot_data_state(test_user) == before
