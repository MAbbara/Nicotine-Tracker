"""Goals route behavior and Journey-aligned interface contracts."""

from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
import re

from bs4 import BeautifulSoup
from sqlalchemy import event

from models import DailyCheckIn, Goal, Log, UserPreferences
import routes.goals as goals_routes
from services import log_service
from services import goal_service
from services import goal_evaluation_service


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
    db_session.add_all([
        DailyCheckIn(user_id=test_goal.user_id, local_date=today - timedelta(days=offset))
        for offset in range(1, 7)
    ])
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
        assert len(periods) == 6
        assert periods[0].select_one('time')['datetime'] == test_goal.start_date.isoformat()
        assert periods[-1].select_one('time')['datetime'] == (today - timedelta(days=1)).isoformat()
        assert '6 days' in document.select_one(
            f'[data-goal-id="{test_goal.id}"] [data-evaluated-periods]'
        ).get_text(' ', strip=True)


def test_daily_history_requires_logs_or_check_in_and_excludes_active_day(
        logged_in_client, db_session, test_user, test_goal, test_pouch):
    today = goals_routes._current_effective_day(
        test_user, goals_routes.resolve_timezone(test_user.timezone)
    )
    test_goal.start_date = today - timedelta(days=3)
    db_session.add(DailyCheckIn(
        user_id=test_user.id,
        local_date=today - timedelta(days=3),
    ))
    for target_date, quantity in (
        (today - timedelta(days=1), 2),
        (today, 1),
    ):
        log = Log(
            user_id=test_user.id,
            quantity=quantity,
            log_time=datetime.combine(target_date, time(12), timezone.utc),
        )
        log_service.assign_log_product(log, pouch_id=test_pouch.id)
        db_session.add(log)
    db_session.commit()

    response = logged_in_client.get('/goals/progress')
    document = BeautifulSoup(response.data, 'html.parser')
    goal_row = document.select_one(f'[data-goal-id="{test_goal.id}"]')
    periods = goal_row.select('[data-progress-period]')

    assert response.status_code == 200
    assert [period['data-period-end'] for period in periods] == [
        (today - timedelta(days=3)).isoformat(),
        (today - timedelta(days=2)).isoformat(),
        (today - timedelta(days=1)).isoformat(),
    ]
    assert '0 pouches' in periods[0].get_text(' ', strip=True)
    assert 'Not enough evidence' in periods[1].get_text(' ', strip=True)
    assert '2 pouches' in periods[2].get_text(' ', strip=True)
    assert today.isoformat() not in [period['data-period-end'] for period in periods]
    assert '100% across 2 days' in goal_row.select_one(
        '[data-evaluated-periods]'
    ).get_text(' ', strip=True)


def test_goals_index_marks_live_and_missing_daily_evidence_without_false_bar(
        logged_in_client, db_session, test_user, test_goal):
    response = logged_in_client.get('/goals/')
    document = BeautifulSoup(response.data, 'html.parser')
    row = document.select_one(f'[data-goal-id="{test_goal.id}"]')

    assert response.status_code == 200
    assert 'No intake evidence yet for this account day' in row.get_text(' ', strip=True)
    assert row.select_one('progress') is None


def test_weekly_index_and_notice_use_latest_completed_week_constructively(
        logged_in_client, db_session, test_user, test_goal):
    today = goals_routes._current_effective_day(
        test_user, goals_routes.resolve_timezone(test_user.timezone)
    )
    current_monday = today - timedelta(days=today.weekday())
    baseline_monday = current_monday - timedelta(days=14)
    latest_monday = current_monday - timedelta(days=7)
    test_goal.is_active = False
    weekly = Goal(
        user_id=test_user.id,
        goal_type='weekly_reduction',
        target_value=20,
        start_date=baseline_monday,
        is_active=True,
        enable_notifications=True,
        notification_threshold=.8,
    )
    db_session.add(weekly)
    db_session.add_all([
        Log(
            user_id=test_user.id,
            quantity=10,
            log_time=datetime.combine(baseline_monday, time(12), timezone.utc),
            nicotine_mg_snapshot=4,
            product_brand_snapshot='Baseline',
        ),
        Log(
            user_id=test_user.id,
            quantity=5,
            log_time=datetime.combine(latest_monday, time(12), timezone.utc),
            nicotine_mg_snapshot=4,
            product_brand_snapshot='Latest',
        ),
    ])
    db_session.commit()

    index = BeautifulSoup(logged_in_client.get('/goals/').data, 'html.parser')
    row = index.select_one(f'[data-goal-id="{weekly.id}"]')
    notices = logged_in_client.get('/goals/api/check_notifications').get_json()

    assert 'Latest completed week' in row.get_text(' ', strip=True)
    assert 'Today’s progress' not in row.get_text(' ', strip=True)
    assert '50.0% reduction' in row.get_text(' ', strip=True)
    assert len(notices['notifications']) == 1
    notice = notices['notifications'][0]
    assert notice['goal_id'] == weekly.id
    assert notice['type'] not in {'danger', 'warning'}
    assert 'latest completed week' in notice['message'].casefold()
    assert 'exceeded' not in notice['message'].casefold()


def test_weekly_silent_comparison_is_unavailable_across_service_route_and_notice(
        logged_in_client, db_session, test_user, test_goal):
    today = goals_routes._current_effective_day(
        test_user, goals_routes.resolve_timezone(test_user.timezone)
    )
    current_monday = today - timedelta(days=today.weekday())
    baseline_monday = current_monday - timedelta(days=14)
    comparison_monday = current_monday - timedelta(days=7)
    test_goal.is_active = False
    weekly = Goal(
        user_id=test_user.id,
        goal_type='weekly_reduction',
        target_value=20,
        start_date=baseline_monday,
        is_active=True,
        enable_notifications=True,
        notification_threshold=.8,
    )
    db_session.add_all([
        weekly,
        Log(
            user_id=test_user.id,
            quantity=10,
            log_time=datetime.combine(
                baseline_monday, time(12), timezone.utc
            ),
            nicotine_mg_snapshot=4,
            product_brand_snapshot='Measured baseline',
        ),
    ])
    db_session.commit()

    progress = goals_routes.calculate_goal_progress(
        test_user,
        weekly,
        comparison_monday,
        goals_routes.resolve_timezone(test_user.timezone),
    )
    index = BeautifulSoup(logged_in_client.get('/goals/').data, 'html.parser')
    row = index.select_one(f'[data-goal-id="{weekly.id}"]')
    notices = logged_in_client.get(
        '/goals/api/check_notifications'
    ).get_json()['notifications']

    assert progress['available'] is False
    assert progress['achieved'] is None
    assert progress['reason'] == 'no_evidence'
    assert progress['current'] is None
    assert 'No completed weekly comparison is available yet' in row.get_text(
        ' ', strip=True
    )
    assert row.select_one('progress') is None
    assert notices == []


def test_weekly_check_in_confirms_zero_use_comparison_week(
        logged_in_client, db_session, test_user, test_goal):
    today = goals_routes._current_effective_day(
        test_user, goals_routes.resolve_timezone(test_user.timezone)
    )
    current_monday = today - timedelta(days=today.weekday())
    baseline_monday = current_monday - timedelta(days=14)
    comparison_monday = current_monday - timedelta(days=7)
    test_goal.is_active = False
    weekly = Goal(
        user_id=test_user.id,
        goal_type='weekly_reduction',
        target_value=20,
        start_date=baseline_monday,
        is_active=True,
        enable_notifications=True,
        notification_threshold=.8,
    )
    db_session.add_all([
        weekly,
        Log(
            user_id=test_user.id,
            quantity=10,
            log_time=datetime.combine(
                baseline_monday, time(12), timezone.utc
            ),
            nicotine_mg_snapshot=4,
            product_brand_snapshot='Measured baseline',
        ),
        DailyCheckIn(
            user_id=test_user.id,
            local_date=comparison_monday + timedelta(days=3),
        ),
    ])
    db_session.commit()

    progress = goals_routes.calculate_goal_progress(
        test_user,
        weekly,
        comparison_monday,
        goals_routes.resolve_timezone(test_user.timezone),
    )
    notices = logged_in_client.get(
        '/goals/api/check_notifications'
    ).get_json()['notifications']

    assert progress['available'] is True
    assert progress['achieved'] is True
    assert progress['current'] == 100
    assert progress['reason'] is None
    assert len(notices) == 1
    assert notices[0]['goal_id'] == weekly.id
    assert notices[0]['type'] == 'success'


class _FrozenDateTime(datetime):
    @classmethod
    def now(cls, tz=None):
        instant = cls(2030, 1, 2, 10, 30, tzinfo=timezone.utc)
        return instant if tz is None else instant.astimezone(tz)


class _FrozenHostDate(date):
    @classmethod
    def today(cls):
        return cls(2030, 1, 2)


def _configure_reset_mismatch(db_session, test_user):
    test_user.timezone = 'America/Los_Angeles'
    db_session.add(UserPreferences(
        user_id=test_user.id,
        daily_reset_time=time(4),
        preferred_brands=[],
    ))
    db_session.commit()


def test_create_goal_uses_reset_aware_account_day_for_dates(
        logged_in_client, db_session, test_user, test_goal, monkeypatch):
    _configure_reset_mismatch(db_session, test_user)
    monkeypatch.setattr(goals_routes, 'datetime', _FrozenDateTime)
    monkeypatch.setattr(goal_service, 'date', _FrozenHostDate)
    monkeypatch.setattr(
        goal_evaluation_service, 'datetime', _FrozenDateTime
    )

    response = logged_in_client.post('/goals/create', data={
        'goal_type': 'daily_mg',
        'target_value': '20',
        'end_date': '2030-01-02',
        'notification_threshold': '80',
    })
    created = Goal.query.filter_by(
        user_id=test_user.id, goal_type='daily_mg'
    ).one_or_none()

    assert response.status_code == 302
    assert created is not None
    assert created.start_date == date(2030, 1, 1)
    assert created.end_date == date(2030, 1, 2)


def test_create_goal_maps_service_activation_conflict_constructively(
        logged_in_client, monkeypatch):
    def conflict(**_kwargs):
        raise goal_service.ActiveGoalConflict('daily_pouches')

    monkeypatch.setattr(goals_routes, 'create_goal_service', conflict)

    response = logged_in_client.post(
        '/goals/create',
        data={
            'goal_type': 'daily_pouches',
            'target_value': '7',
            'notification_threshold': '80',
        },
        follow_redirects=True,
    )

    assert response.status_code == 200
    text = response.get_data(as_text=True).casefold()
    assert 'already have an active daily pouches goal' in text
    assert 'an error occurred while creating the goal' not in text


def test_edit_goal_uses_reset_aware_account_day_for_review_date(
        logged_in_client, db_session, test_user, test_goal, monkeypatch):
    _configure_reset_mismatch(db_session, test_user)
    monkeypatch.setattr(goals_routes, 'datetime', _FrozenDateTime)

    response = logged_in_client.post(f'/goals/edit/{test_goal.id}', data={
        'target_value': '9',
        'end_date': '2030-01-02',
        'notification_threshold': '80',
        'is_active': 'on',
    })
    db_session.refresh(test_goal)

    assert response.status_code == 302
    assert test_goal.target_value == 9
    assert test_goal.end_date == date(2030, 1, 2)


def test_edit_activation_rejects_an_active_sibling_in_same_transaction(
        logged_in_client, db_session, test_user, test_goal):
    paused = Goal(
        user_id=test_user.id,
        goal_type=test_goal.goal_type,
        target_value=4,
        start_date=test_goal.start_date,
        is_active=False,
    )
    db_session.add(paused)
    db_session.commit()

    response = logged_in_client.post(
        f'/goals/edit/{paused.id}',
        data={
            'target_value': '3',
            'notification_threshold': '80',
            'is_active': 'on',
        },
        follow_redirects=True,
    )
    db_session.refresh(paused)

    assert response.status_code == 200
    assert paused.is_active is False
    assert paused.target_value == 4
    assert 'already have an active daily pouches goal' in response.get_data(
        as_text=True
    ).casefold()


def test_direct_toggle_rejects_active_sibling_but_preserves_pause(
        logged_in_client, db_session, test_user, test_goal):
    paused = Goal(
        user_id=test_user.id,
        goal_type=test_goal.goal_type,
        target_value=4,
        start_date=test_goal.start_date,
        is_active=False,
    )
    db_session.add(paused)
    db_session.commit()

    rejected = logged_in_client.post(
        f'/goals/toggle/{paused.id}', follow_redirects=True
    )
    db_session.refresh(paused)
    assert paused.is_active is False
    assert 'already have an active daily pouches goal' in rejected.get_data(
        as_text=True
    ).casefold()

    paused_active = logged_in_client.post(f'/goals/toggle/{test_goal.id}')
    db_session.refresh(test_goal)
    assert paused_active.status_code == 302
    assert test_goal.is_active is False


def test_goal_routes_use_one_log_and_one_check_in_select_with_multiple_goals(
        app, logged_in_client, db_session, test_user, test_goal):
    test_goal.start_date = date.today() - timedelta(days=29)
    db_session.add_all([
        Goal(
            user_id=test_user.id,
            goal_type='daily_mg',
            target_value=30,
            start_date=test_goal.start_date,
            is_active=True,
        ),
        Goal(
            user_id=test_user.id,
            goal_type='weekly_reduction',
            target_value=10,
            start_date=test_goal.start_date,
            is_active=True,
        ),
    ])
    db_session.add(Log(
        user_id=test_user.id,
        quantity=2,
        log_time=datetime.now(timezone.utc) - timedelta(days=8),
        nicotine_mg_snapshot=4,
        product_brand_snapshot='Query baseline',
    ))
    db_session.commit()
    engine = db_session.get_bind()

    counts = {}
    for path in ('/goals/', '/goals/progress'):
        statements = []

        def capture(_connection, _cursor, statement, _parameters, _context, _many):
            normalized = ' '.join(statement.casefold().split())
            if statement.lstrip().upper().startswith('SELECT'):
                statements.append(normalized)

        event.listen(engine, 'before_cursor_execute', capture)
        try:
            response = logged_in_client.get(path)
        finally:
            event.remove(engine, 'before_cursor_execute', capture)
        assert response.status_code == 200
        counts[path] = {
            'logs': sum(bool(re.search(r'\bfrom\s+"?log"?\b', item)) for item in statements),
            'check_ins': sum('from daily_check_in' in item for item in statements),
        }

    assert counts == {
        '/goals/': {'logs': 1, 'check_ins': 1},
        '/goals/progress': {'logs': 1, 'check_ins': 1},
    }


def test_daily_mg_progress_treats_unknown_strength_as_unavailable_evidence(
        logged_in_client, db_session, test_user, test_goal, test_pouch):
    today = goals_routes._current_effective_day(
        test_user, goals_routes.resolve_timezone(test_user.timezone)
    )
    test_goal.goal_type = 'daily_mg'
    test_goal.target_value = 10
    test_goal.start_date = today - timedelta(days=1)
    test_goal.enable_notifications = True
    test_goal.notification_threshold = .5

    known_log = Log(
        user_id=test_user.id,
        quantity=1,
        log_time=datetime.combine(
            today - timedelta(days=1), time(12), timezone.utc
        ),
    )
    log_service.assign_log_product(known_log, pouch_id=test_pouch.id)
    unknown_log = Log(
        user_id=test_user.id,
        quantity=2,
        log_time=datetime.combine(today, time(12), timezone.utc),
        product_brand_snapshot='Strength not saved',
    )
    db_session.add_all([known_log, unknown_log])
    db_session.commit()

    progress = goals_routes.calculate_goal_progress(
        test_user,
        test_goal,
        today,
        goals_routes.resolve_timezone(test_user.timezone),
    )
    notification_response = logged_in_client.get(
        '/goals/api/check_notifications'
    )

    assert progress['available'] is False
    assert progress['achieved'] is None
    assert progress['unknown_strength_count'] == 1
    assert notification_response.status_code == 200
    assert notification_response.get_json() == {
        'success': True,
        'notifications': [],
    }


def test_daily_mg_progress_page_explains_missing_strength_without_zero_reading(
        logged_in_client, db_session, test_user, test_goal, test_pouch):
    today = goals_routes._current_effective_day(
        test_user, goals_routes.resolve_timezone(test_user.timezone)
    )
    yesterday = today - timedelta(days=1)
    two_days_ago = today - timedelta(days=2)
    test_goal.goal_type = 'daily_mg'
    test_goal.target_value = 10
    test_goal.start_date = two_days_ago

    known_log = Log(
        user_id=test_user.id,
        quantity=1,
        log_time=datetime.combine(two_days_ago, time(12), timezone.utc),
    )
    log_service.assign_log_product(known_log, pouch_id=test_pouch.id)
    unknown_log = Log(
        user_id=test_user.id,
        quantity=2,
        log_time=datetime.combine(yesterday, time(12), timezone.utc),
        product_brand_snapshot='Strength not saved',
    )
    db_session.add_all([known_log, unknown_log])
    db_session.commit()

    response = logged_in_client.get('/goals/progress')
    document = BeautifulSoup(response.data, 'html.parser')
    goal_row = document.select_one(f'[data-goal-id="{test_goal.id}"]')
    unknown_row = goal_row.select_one(
        f'[data-progress-period][data-period-end="{yesterday.isoformat()}"]'
    )

    assert response.status_code == 200
    assert goal_row.select_one('[data-current-streak]').get_text(
        ' ', strip=True
    ) == '0 days'
    assert '100% across 1 day' in goal_row.select_one(
        '[data-evaluated-periods]'
    ).get_text(' ', strip=True)
    assert 'Nicotine total unavailable' in unknown_row.get_text(' ', strip=True)
    assert 'Strength data missing from 1 log entry' in unknown_row.get_text(
        ' ', strip=True
    )
    assert unknown_row.select('td')[0].get_text(
        ' ', strip=True
    ) == 'Nicotine total unavailable'
    assert 'Worth reviewing' not in unknown_row.get_text(' ', strip=True)


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
        is_active=False,
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
    weekly_goal.is_active = False
    db_session.commit()
    open_weekly_goal.is_active = True
    db_session.commit()
    open_response = logged_in_client.get('/goals/progress')
    open_document = BeautifulSoup(open_response.data, 'html.parser')
    open_goal_row = open_document.select_one(
        f'[data-goal-id="{open_weekly_goal.id}"]'
    )
    open_dates = [
        period.select_one('time')['datetime']
        for period in open_goal_row.select(
            '[data-progress-period][data-period-unit="week"]'
        )
    ]

    assert response.status_code == 200
    assert open_response.status_code == 200
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


def test_completed_weekly_miss_uses_completed_period_copy(
        logged_in_client, db_session, test_user, test_goal):
    today = goals_routes._current_effective_day(
        test_user, goals_routes.resolve_timezone(test_user.timezone)
    )
    current_monday = today - timedelta(days=today.weekday())
    baseline_monday = current_monday - timedelta(days=14)
    comparison_monday = current_monday - timedelta(days=7)
    test_goal.is_active = False
    weekly = Goal(
        user_id=test_user.id,
        goal_type='weekly_reduction',
        target_value=50,
        start_date=baseline_monday,
        is_active=True,
        enable_notifications=False,
    )
    db_session.add(weekly)
    for target_date, quantity, label in (
        (baseline_monday, 10, 'Baseline'),
        (comparison_monday, 8, 'Comparison'),
    ):
        db_session.add(Log(
            user_id=test_user.id,
            quantity=quantity,
            log_time=datetime.combine(target_date, time(12), timezone.utc),
            nicotine_mg_snapshot=4,
            product_brand_snapshot=label,
        ))
    db_session.commit()

    response = logged_in_client.get('/goals/progress')
    row = BeautifulSoup(response.data, 'html.parser').select_one(
        f'[data-goal-id="{weekly.id}"] '
        f'[data-progress-period][data-period-end="'
        f'{(comparison_monday + timedelta(days=6)).isoformat()}"]'
    )

    assert response.status_code == 200
    assert 'Guide not reached' in row.get_text(' ', strip=True)
    assert 'Still in progress' not in row.get_text(' ', strip=True)


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
