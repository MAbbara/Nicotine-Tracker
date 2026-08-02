"""Goals route behavior and Journey-aligned interface contracts."""

from datetime import date, timedelta
from pathlib import Path

from bs4 import BeautifulSoup

from models import Goal
import routes.goals as goals_routes


PROJECT_ROOT = Path(__file__).resolve().parents[2]
GOAL_TEMPLATES = ('goals.html', 'create_goal.html', 'edit_goal.html')
BANNED_PALETTE = (
    'bg-indigo-', 'text-indigo-', 'border-indigo-', 'ring-indigo-',
    'outline-indigo-', 'bg-purple-', 'text-purple-', 'bg-violet-',
    'bg-fuchsia-', 'bg-blue-', 'text-blue-',
)


def test_goals_index_uses_editorial_active_and_inactive_rows(
        logged_in_client, db_session, test_user, test_goal):
    inactive_goal = Goal(
        user_id=test_user.id,
        goal_type='daily_mg',
        target_value=30,
        start_date=date.today() - timedelta(days=14),
        end_date=date.today() + timedelta(days=14),
        is_active=False,
    )
    db_session.add(inactive_goal)
    db_session.commit()

    response = logged_in_client.get('/goals/')
    document = BeautifulSoup(response.data, 'html.parser')

    assert response.status_code == 200
    assert len(document.select('main h1')) == 1
    assert document.select_one('main h1').get_text(' ', strip=True) == 'Goals'
    assert 'Journey plan' in document.get_text(' ', strip=True)
    assert document.select_one('[data-goals-analytics][data-endpoint="/goals/api/goals"]')
    assert document.select_one('script[src*="js/goals/page.js"]')
    assert 'traditionalGoalsCard' not in response.get_data(as_text=True)

    active = document.select_one(
        f'article.goal-row[data-goal-id="{test_goal.id}"][data-goal-state="active"]'
    )
    assert active is not None
    assert active.select_one(f'form[action="/goals/toggle/{test_goal.id}"][method="post"]')
    assert active.find('button', string='Pause goal')
    assert active.select_one(f'a[href="/goals/edit/{test_goal.id}"]')
    assert active.select_one(f'form.goal-delete-form[action="/goals/delete/{test_goal.id}"]')

    inactive = document.select_one(
        f'article.goal-row[data-goal-id="{inactive_goal.id}"][data-goal-state="inactive"]'
    )
    assert inactive is not None
    assert inactive.select_one(f'form[action="/goals/toggle/{inactive_goal.id}"]') is None
    assert inactive.find('button', string='Resume goal') is None
    assert inactive.select_one(f'a[href="/goals/edit/{inactive_goal.id}"]')
    assert inactive.select_one(f'form.goal-delete-form[action="/goals/delete/{inactive_goal.id}"]')
    assert not document.select('[onsubmit]')
    for mutation in document.select('form[method="post"]'):
        assert mutation.select_one('input[name="csrf_token"][type="hidden"]')


def test_goal_forms_preserve_names_values_validation_and_shared_primitives(
        logged_in_client, test_goal):
    expected_common = {
        'target_value', 'end_date', 'enable_notifications',
        'notification_threshold', 'csrf_token',
    }
    for path, heading, submit_label in (
        ('/goals/create', 'Create a goal', 'Create goal'),
        (f'/goals/edit/{test_goal.id}', 'Adjust goal', 'Save changes'),
    ):
        response = logged_in_client.get(path)
        document = BeautifulSoup(response.data, 'html.parser')
        form = document.select_one('form.goal-form[method="post"]')

        assert response.status_code == 200
        assert len(document.select('main h1')) == 1
        assert document.select_one('main h1').get_text(' ', strip=True) == heading
        assert form is not None
        names = {field.get('name') for field in form.select('[name]')}
        assert expected_common <= names
        assert form.select_one('input.c-field__control[name="target_value"][type="number"][min="1"][required]')
        assert form.select_one('input.c-field__control[name="end_date"][type="date"]')
        assert form.select_one('input.c-field__check-input[name="enable_notifications"][type="checkbox"]')
        threshold = form.select_one(
            'input.c-field__control[name="notification_threshold"]'
            '[type="number"][min="1"][max="100"][required]'
        )
        assert threshold is not None
        assert form.select_one('button.c-button.c-button--primary[type="submit"]') \
            .get_text(' ', strip=True) == submit_label
        assert form.select_one('a.c-button.c-button--secondary[href="/goals/"]')

    create = BeautifulSoup(
        logged_in_client.get('/goals/create').data, 'html.parser'
    )
    assert create.select_one('select.c-field__control[name="goal_type"][required]')
    assert create.select_one('[name="notification_threshold"]')['value'] == '80'
    assert create.select_one('[name="enable_notifications"]').has_attr('checked')

    edit = BeautifulSoup(
        logged_in_client.get(f'/goals/edit/{test_goal.id}').data, 'html.parser'
    )
    goal_type = edit.select_one('select.c-field__control[name="goal_type"]')
    assert goal_type.has_attr('disabled')
    assert edit.select_one('input.c-field__check-input[name="is_active"]')
    assert edit.select_one('[name="target_value"]')['value'] == str(test_goal.target_value)


def test_create_edit_toggle_delete_progress_and_api_contracts_remain_available(
        logged_in_client, db_session, test_user):
    future = (date.today() + timedelta(days=30)).isoformat()
    created = logged_in_client.post('/goals/create', data={
        'goal_type': 'daily_pouches',
        'target_value': '7',
        'end_date': future,
        'enable_notifications': 'on',
        'notification_threshold': '75',
    })
    goal = Goal.query.filter_by(user_id=test_user.id, goal_type='daily_pouches').one()

    assert created.status_code == 302
    assert created.headers['Location'].endswith('/goals/')
    assert goal.target_value == 7
    assert goal.enable_notifications is True
    assert goal.notification_threshold == .75

    api = logged_in_client.get('/goals/api/goals')
    payload = api.get_json()
    assert api.status_code == 200
    assert payload['success'] is True
    assert payload['goals']['total_count'] == 1
    assert payload['goals']['traditional_goals'][0]['id'] == goal.id
    assert payload['analytics']['total_goals'] == 1
    assert payload['analytics']['active_goals'] == 1

    assert any(rule.rule == '/goals/progress' for rule in logged_in_client.application.url_map.iter_rules())

    edited = logged_in_client.post(f'/goals/edit/{goal.id}', data={
        'target_value': '6',
        'end_date': future,
        'enable_notifications': 'on',
        'notification_threshold': '70',
        'is_active': 'on',
    })
    db_session.refresh(goal)
    assert edited.status_code == 302
    assert goal.target_value == 6
    assert goal.notification_threshold == .70

    toggled = logged_in_client.post(f'/goals/toggle/{goal.id}')
    db_session.refresh(goal)
    assert toggled.status_code == 302
    assert goal.is_active is False

    progress = logged_in_client.get('/goals/progress')
    assert progress.status_code == 302
    assert progress.headers['Location'].endswith('/goals/create')

    deleted = logged_in_client.post(f'/goals/delete/{goal.id}')
    assert deleted.status_code == 302
    assert db_session.get(Goal, goal.id) is None


def test_goal_validation_messages_and_values_remain_candid(
        logged_in_client, db_session, test_user, test_goal):
    invalid_type = logged_in_client.post('/goals/create', data={
        'goal_type': 'not-a-goal',
        'target_value': '7',
        'notification_threshold': '80',
    })
    assert invalid_type.status_code == 200
    assert b'Please select a valid goal type.' in invalid_type.data

    invalid_target = logged_in_client.post(f'/goals/edit/{test_goal.id}', data={
        'target_value': '0',
        'notification_threshold': '80',
    })
    assert invalid_target.status_code == 200
    assert b'Target value must be a positive number.' in invalid_target.data
    db_session.refresh(test_goal)
    assert test_goal.target_value == 10


def test_goal_templates_use_shared_primitives_and_retire_legacy_palette():
    for name in GOAL_TEMPLATES:
        source = (PROJECT_ROOT / 'templates' / 'goals' / name).read_text().casefold()
        for token in BANNED_PALETTE:
            assert token not in source, f'{name}: {token}'
        assert 'dark:' not in source


def test_goal_pages_do_not_load_the_unused_legacy_preline_runtime(
        logged_in_client, test_goal):
    for path in ('/goals/', '/goals/create', f'/goals/edit/{test_goal.id}'):
        document = BeautifulSoup(logged_in_client.get(path).data, 'html.parser')
        scripts = [script.get('src', '') for script in document.select('script[src]')]
        assert not any(source.endswith('/static/js/preline.js') for source in scripts)


def test_goal_progress_respects_start_date_and_repeated_get_is_read_only(
        logged_in_client, db_session, test_goal, monkeypatch):
    today = goals_routes._current_effective_day(
        test_goal.user, goals_routes.resolve_timezone(test_goal.user.timezone)
    )
    test_goal.start_date = today - timedelta(days=6)
    test_goal.current_streak = 4
    test_goal.best_streak = 9
    test_goal.enable_notifications = True
    db_session.commit()

    commit_calls = []
    notification_calls = []

    class RecordingNotificationService:
        def send_goal_achievement_notification(self, *args):
            notification_calls.append(args)

    monkeypatch.setattr(
        goals_routes, 'NotificationService', RecordingNotificationService,
        raising=False,
    )
    monkeypatch.setattr(
        goals_routes.db.session, 'commit', lambda: commit_calls.append(True)
    )

    responses = [
        logged_in_client.get('/goals/progress'),
        logged_in_client.get('/goals/progress'),
    ]

    assert [response.status_code for response in responses] == [200, 200]
    assert commit_calls == []
    assert notification_calls == []
    assert test_goal.current_streak == 4
    assert test_goal.best_streak == 9
    for response in responses:
        document = BeautifulSoup(response.data, 'html.parser')
        periods = document.select(
            f'[data-goal-id="{test_goal.id}"] [data-progress-period]'
        )
        assert len(periods) == 7
        assert periods[0].select_one('time')['datetime'] == test_goal.start_date.isoformat()
        assert periods[-1].select_one('time')['datetime'] == today.isoformat()
        assert '7 days' in document.select_one(
            f'[data-goal-id="{test_goal.id}"] [data-evaluated-periods]'
        ).get_text(' ', strip=True)


def test_weekly_goal_progress_uses_distinct_weeks_and_marks_missing_baseline(
        logged_in_client, db_session, test_user, test_goal):
    today = goals_routes._current_effective_day(
        test_user, goals_routes.resolve_timezone(test_user.timezone)
    )
    current_monday = today - timedelta(days=today.weekday())
    test_goal.is_active = False
    weekly_goal = Goal(
        user_id=test_user.id,
        goal_type='weekly_reduction',
        target_value=20,
        start_date=current_monday - timedelta(days=26),
        end_date=current_monday - timedelta(days=2),
        is_active=True,
        enable_notifications=False,
    )
    open_weekly_goal = Goal(
        user_id=test_user.id,
        goal_type='weekly_reduction',
        target_value=15,
        start_date=current_monday - timedelta(days=14),
        is_active=True,
        enable_notifications=False,
    )
    db_session.add_all([weekly_goal, open_weekly_goal])
    db_session.commit()

    response = logged_in_client.get('/goals/progress')
    document = BeautifulSoup(response.data, 'html.parser')
    goal_row = document.select_one(f'[data-goal-id="{weekly_goal.id}"]')
    periods = goal_row.select('[data-progress-period][data-period-unit="week"]')
    dates = [period.select_one('time')['datetime'] for period in periods]
    ends = [period['data-period-end'] for period in periods]
    open_goal_row = document.select_one(f'[data-goal-id="{open_weekly_goal.id}"]')
    open_dates = [
        period.select_one('time')['datetime']
        for period in open_goal_row.select(
            '[data-progress-period][data-period-unit="week"]'
        )
    ]

    assert response.status_code == 200
    assert dates == [
        (current_monday - timedelta(days=21)).isoformat(),
        (current_monday - timedelta(days=14)).isoformat(),
    ]
    assert ends == [
        (current_monday - timedelta(days=15)).isoformat(),
        (current_monday - timedelta(days=8)).isoformat(),
    ]
    assert all(date.fromisoformat(value) >= weekly_goal.start_date for value in dates)
    assert all(date.fromisoformat(value) <= weekly_goal.end_date for value in ends)
    assert open_dates == [
        (current_monday - timedelta(days=14)).isoformat(),
        (current_monday - timedelta(days=7)).isoformat(),
    ]
    assert current_monday.isoformat() not in open_dates
    assert 'weeks' in goal_row.select_one('[data-current-streak]').get_text(' ', strip=True)
    assert 'Not enough baseline' in goal_row.get_text(' ', strip=True)
    assert 'Reduction met' not in goal_row.get_text(' ', strip=True)


def test_goal_notifications_are_owned_only_by_the_scoped_goals_page(
        logged_in_client):
    goals = logged_in_client.get('/goals/').get_data(as_text=True)
    dashboard = logged_in_client.get('/dashboard/').get_data(as_text=True)

    assert 'data-goals-notifications' in goals
    assert 'data-endpoint="/goals/api/check_notifications"' in goals
    assert '/static/js/goals/page.js' in goals
    assert 'data-goals-notifications' not in dashboard
    assert '/static/js/goals/page.js' not in dashboard
    assert '/goals/api/check_notifications' not in dashboard
