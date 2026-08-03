"""Disposable, in-memory application used only by Playwright."""

import sys
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT))

# Browser release evidence must not change when the suite crosses midnight.
# Keep the freeze entirely inside this disposable server process: application
# source remains unaware of it, and Playwright reads the same instant from the
# test-only endpoint below before installing its browser clock.
_REAL_DATE = date
_REAL_DATETIME = datetime
RELEASE_TEST_NOW = _REAL_DATETIME(2026, 8, 3, 12, 0, tzinfo=timezone.utc)


class _ReleaseTestDate(_REAL_DATE):
    @classmethod
    def today(cls):
        return cls(
            RELEASE_TEST_NOW.year,
            RELEASE_TEST_NOW.month,
            RELEASE_TEST_NOW.day,
        )


class _ReleaseTestDateTime(_REAL_DATETIME):
    @classmethod
    def now(cls, tz=None):
        if tz is None:
            return cls.fromtimestamp(RELEASE_TEST_NOW.timestamp())
        return cls.fromtimestamp(RELEASE_TEST_NOW.timestamp(), tz)

    @classmethod
    def utcnow(cls):
        return cls.fromtimestamp(RELEASE_TEST_NOW.timestamp(), timezone.utc).replace(
            tzinfo=None,
        )

    @classmethod
    def today(cls):
        return cls.now()


# Seed construction below resolves these names at runtime.
date = _ReleaseTestDate
datetime = _ReleaseTestDateTime

from app import create_app  # noqa: E402
from extensions import db, mail  # noqa: E402
from routes.auth import get_current_user, login_required  # noqa: E402
from flask import abort, redirect, render_template, request, url_for  # noqa: E402
from models import (  # noqa: E402
    Craving,
    DailyCheckIn,
    Goal,
    Log,
    PlanDay,
    PlanRevision,
    PlanStatusEvent,
    PasswordReset,
    Pouch,
    ReductionPlan,
    User,
    UserPreferredPouch,
    UserPreferences,
)
from services.notification_service import NotificationService  # noqa: E402
from services import notification_service as notification_service_module  # noqa: E402
from services.log_service import get_historical_brand  # noqa: E402
from models.email_verification import EmailVerification  # noqa: E402
from tests.browser.helpers.outbound_test_boundary import (  # noqa: E402
    install_outbound_boundary,
)


app = create_app('testing')


_OUTBOUND = install_outbound_boundary(
    NotificationService,
    notification_service_module.requests,
    mail,
    now=lambda: RELEASE_TEST_NOW.replace(tzinfo=None),
)


_DATE_CLOCK_MODULES = {
    'routes.logging',
    'routes.settings',
    'services.goal_service',
}
_DATETIME_CLOCK_MODULES = {
    'routes.api',
    'routes.cravings',
    'routes.dashboard',
    'routes.insights',
    'routes.logging',
    'routes.settings',
    'services.background_tasks',
    'services.check_in_service',
    'services.craving_service',
    'services.email_verification_service',
    'services.enhanced_insights_service',
    'services.goal_evaluation_service',
    'services.goal_service',
    'services.log_service',
    'services.notification_service',
    'services.password_reset_service',
    'services.plan_service',
    'services.preference_service',
    'services.serializers',
    'services.timezone_service',
    'services.today_service',
    'services.user_preferences_service',
    'services.user_service',
}


def _freeze_loaded_test_server_clocks():
    """Patch only audited wall-clock readers inside this test-server process."""
    for module_name, module in tuple(sys.modules.items()):
        if (
            module_name in _DATE_CLOCK_MODULES
            and getattr(module, 'date', None) is _REAL_DATE
        ):
            module.date = _ReleaseTestDate
        if (
            module_name in _DATETIME_CLOCK_MODULES
            and getattr(module, 'datetime', None) is _REAL_DATETIME
        ):
            module.datetime = _ReleaseTestDateTime


_freeze_loaded_test_server_clocks()


@app.before_request
def keep_test_server_clock_frozen():
    # Re-apply for any route/service module imported lazily after app creation.
    _freeze_loaded_test_server_clocks()


@app.get('/__test__/release-clock')
def release_clock_fixture():
    return {'fixed_now': RELEASE_TEST_NOW.isoformat().replace('+00:00', 'Z')}


@app.get('/__test__/error/<int:status_code>')
def render_accessibility_error_fixture(status_code):
    """Render the real error templates for browser-only accessibility QA."""
    templates = {
        400: ('errors/400.html', {}),
        500: ('errors/500.html', {'request_id': 'browser-accessibility-fixture'}),
    }
    if status_code not in templates:
        return render_template('errors/404.html'), 404
    template_name, context = templates[status_code]
    return render_template(template_name, **context), status_code

with app.app_context():
    db.create_all()
    user = User(
        email='browser@example.com',
        email_verified=True,
        timezone='UTC',
    )
    user.set_password('browser-password')
    db.session.add(user)
    db.session.flush()
    default_pouch = Pouch(
        brand='Steady Mint',
        nicotine_mg=Decimal('6.00'),
        is_default=True,
    )
    owned_custom_pouch = Pouch(
        brand='Browser Owned',
        nicotine_mg=Decimal('9.00'),
        is_default=False,
        created_by=user.id,
    )
    valid_reset = PasswordReset(
        user_id=user.id,
        token='browser-accessibility-reset-token',
        expires_at=datetime.utcnow() + timedelta(days=1),
    )
    db.session.add_all([default_pouch, owned_custom_pouch, valid_reset])
    db.session.commit()

    empty_smart_user = User(
        email='today-empty-smart@example.com',
        email_verified=True,
        timezone='UTC',
    )
    empty_smart_user.set_password('browser-password')
    db.session.add(empty_smart_user)
    db.session.flush()
    db.session.add(UserPreferredPouch(
        user_id=empty_smart_user.id,
        pouch_id=default_pouch.id,
        rank=0,
    ))

    def seed_today_fixture():
        today_user = User(
            email='today-targeted@example.com',
            email_verified=True,
            timezone='UTC',
        )
        today_user.set_password('browser-password')
        db.session.add(today_user)
        db.session.flush()
        db.session.add(Pouch(
            brand='Targeted Own',
            nicotine_mg=Decimal('4.00'),
            is_default=False,
            created_by=today_user.id,
        ))

        # Keep this live-clock fixture deterministic at every UTC hour.  A
        # midnight reset made the expected on-pace coaching flip to the
        # end-of-day reflection during the final two hours of a UTC day.
        # Moving the disposable user's boundary four hours ahead leaves the
        # instant safely outside that branch while still exercising the
        # canonical non-midnight user-day window.
        now_utc = datetime.now(timezone.utc)
        reset_time = (
            now_utc + timedelta(hours=4)
        ).replace(second=0, microsecond=0).time()
        selected = (
            now_utc.date() - timedelta(days=1)
            if now_utc.time() < reset_time
            else now_utc.date()
        )
        db.session.add(UserPreferences(
            user_id=today_user.id,
            daily_reset_time=reset_time,
        ))
        start = selected - timedelta(days=3)
        end = selected + timedelta(days=3)
        plan = ReductionPlan(
            user_id=today_user.id,
            mode='reduce',
            status='draft',
            start_date=start,
            target_date=end,
            baseline_pouches=Decimal('8.00'),
            baseline_mg=Decimal('48.00'),
            baseline_mg_per_pouch=Decimal('6.00'),
            baseline_source='manual',
            pace='steady',
            end_target_pouches=6,
        )
        db.session.add(plan)
        db.session.flush()
        revision = PlanRevision(
            plan_id=plan.id,
            effective_date=start,
            pace='steady',
            target_date=end,
            end_target_pouches=6,
            generation_inputs={
                'stage_targets': [{
                    'start_date': start.isoformat(),
                    'end_date': end.isoformat(),
                    'target_pouches': 6,
                }],
            },
            preview_digest='a' * 64,
            reason='initial',
        )
        db.session.add(revision)
        db.session.flush()
        plan.active_revision_id = revision.id
        plan.status = 'active'
        plan.active_slot = 1
        for offset in range(7):
            db.session.add(PlanDay(
                plan_id=plan.id,
                revision_id=revision.id,
                local_date=start + timedelta(days=offset),
                target_pouches=6,
                nicotine_ceiling_mg=Decimal('36.00'),
            ))
        db.session.add(PlanStatusEvent(
            plan_id=plan.id,
            status='active',
            effective_at_utc=datetime.combine(start, time.min),
            local_date=start,
            reason='Today browser fixture activation',
        ))

        window_start = datetime.combine(selected, reset_time)
        log_time = window_start + timedelta(hours=1)
        db.session.add(Log(
            user_id=today_user.id,
            pouch_id=default_pouch.id,
            log_date=selected,
            log_time=log_time,
            product_brand_snapshot='Steady Mint',
            nicotine_mg_snapshot=Decimal('6.00'),
            quantity=2,
        ))
        db.session.add(Craving(
            user_id=today_user.id,
            craving_time=window_start + timedelta(hours=2),
            intensity=7,
            trigger='after lunch',
            outcome='resisted',
        ))
        db.session.add(DailyCheckIn(
            user_id=today_user.id,
            plan_id=plan.id,
            local_date=selected,
            mood=3,
            confidence=4,
            reflection='The pause before lunch helped.',
            context='Workday',
            created_at=window_start + timedelta(hours=3),
        ))

    seed_today_fixture()

    def seed_task8_today_user(
        email,
        *,
        plan_status='active',
        target_pouches=4,
        nicotine_ceiling='24.00',
        current_quantity=1,
        saved_check_in=False,
        repeated_difficulty=False,
    ):
        """Build one disposable canonical Today state for Task 8 browser QA."""
        task_user = User(
            email=email,
            email_verified=True,
            timezone='UTC',
        )
        task_user.set_password('browser-password')
        db.session.add(task_user)
        db.session.flush()
        db.session.add(UserPreferredPouch(
            user_id=task_user.id,
            pouch_id=default_pouch.id,
            rank=0,
        ))

        now_utc = datetime.now(timezone.utc).replace(microsecond=0)
        selected = now_utc.date()
        start = selected - timedelta(days=6)
        end = selected + timedelta(days=1)
        plan = ReductionPlan(
            user_id=task_user.id,
            mode='reduce',
            status='draft',
            active_slot=None,
            start_date=start,
            target_date=end,
            baseline_pouches=Decimal('6.00'),
            baseline_mg=Decimal('36.00'),
            baseline_mg_per_pouch=Decimal('6.00'),
            baseline_source='manual',
            pace='steady',
            end_target_pouches=target_pouches,
        )
        db.session.add(plan)
        db.session.flush()
        revision = PlanRevision(
            plan_id=plan.id,
            effective_date=start,
            pace='steady',
            target_date=end,
            end_target_pouches=target_pouches,
            generation_inputs={},
            preview_digest=(str(plan.id) * 64)[:64],
            reason='initial',
        )
        db.session.add(revision)
        db.session.flush()
        plan.active_revision_id = revision.id
        plan.status = plan_status
        plan.active_slot = 1 if plan_status == 'active' else None
        for offset in range(8):
            db.session.add(PlanDay(
                plan_id=plan.id,
                revision_id=revision.id,
                local_date=start + timedelta(days=offset),
                target_pouches=target_pouches,
                nicotine_ceiling_mg=Decimal(nicotine_ceiling),
            ))
        db.session.add(PlanStatusEvent(
            plan_id=plan.id,
            status='active',
            effective_at_utc=datetime.combine(start, time.min),
            local_date=start,
            reason='Task 8 browser fixture activation',
        ))
        if plan_status == 'paused':
            db.session.add(PlanStatusEvent(
                plan_id=plan.id,
                status='paused',
                effective_at_utc=datetime.combine(selected, time.min),
                local_date=selected,
                reason='Task 8 browser fixture pause',
            ))

        if repeated_difficulty:
            for index, offset in enumerate(range(1, 6), start=1):
                quantity = target_pouches + 1 if index <= 3 else target_pouches
                db.session.add(Log(
                    user_id=task_user.id,
                    pouch_id=default_pouch.id,
                    log_date=selected - timedelta(days=offset),
                    log_time=datetime.combine(
                        selected - timedelta(days=offset), time(12, 0)
                    ),
                    product_brand_snapshot='Steady Mint',
                    nicotine_mg_snapshot=Decimal('6.00'),
                    quantity=quantity,
                ))

        if current_quantity:
            db.session.add(Log(
                user_id=task_user.id,
                pouch_id=default_pouch.id,
                log_date=selected,
                log_time=now_utc.replace(tzinfo=None),
                product_brand_snapshot='Steady Mint',
                nicotine_mg_snapshot=Decimal('6.00'),
                quantity=current_quantity,
            ))
        if saved_check_in:
            db.session.add(DailyCheckIn(
                user_id=task_user.id,
                plan_id=plan.id,
                local_date=selected,
                mood=3,
                confidence=4,
                reflection='The short walk helped.',
                context='After lunch',
                created_at=now_utc.replace(tzinfo=None),
            ))
        return task_user

    for project_name in ('desktop', 'mobile'):
        seed_task8_today_user(
            f'today-checkin-empty-{project_name}@example.com',
            target_pouches=2,
            nicotine_ceiling='12.00',
            current_quantity=2,
        )
        seed_task8_today_user(
            f'today-checkin-saved-{project_name}@example.com',
            saved_check_in=True,
        )
        seed_task8_today_user(
            f'today-checkin-retry-{project_name}@example.com',
            saved_check_in=True,
        )
        seed_task8_today_user(
            f'today-checkin-responsive-{project_name}@example.com',
            saved_check_in=True,
        )
        seed_task8_today_user(
            f'today-checkin-transition-{project_name}@example.com',
            target_pouches=2,
            nicotine_ceiling='12.00',
            current_quantity=1,
        )
        seed_task8_today_user(
            f'today-recovery-transition-{project_name}@example.com',
            target_pouches=2,
            nicotine_ceiling='12.00',
            current_quantity=1,
        )
        seed_task8_today_user(
            f'today-checkin-reconcile-{project_name}@example.com',
            target_pouches=2,
            nicotine_ceiling='12.00',
            current_quantity=2,
        )
    seed_task8_today_user(
        'today-paused@example.com',
        plan_status='paused',
        target_pouches=2,
        nicotine_ceiling='12.00',
        current_quantity=3,
    )
    seed_task8_today_user(
        'today-exceeded@example.com',
        target_pouches=2,
        nicotine_ceiling='10.00',
        current_quantity=3,
        repeated_difficulty=True,
    )

    def seed_review_fixture(email, fingerprint_character, digest_character):
        review_user = User(
            email=email,
            email_verified=True,
            timezone='UTC',
        )
        review_user.set_password('browser-password')
        db.session.add(review_user)
        db.session.flush()

        goal_start = date.today() - timedelta(days=35)
        goal_end = date.today() + timedelta(days=14)
        pouch_goal = Goal(
            user_id=review_user.id,
            goal_type='daily_pouches',
            target_value=4,
            start_date=goal_start,
            end_date=goal_end,
            is_active=True,
        )
        matching_mg = Goal(
            user_id=review_user.id,
            goal_type='daily_mg',
            target_value=24,
            start_date=goal_start,
            end_date=goal_end,
            is_active=True,
        )
        conflict_goal = Goal(
            user_id=review_user.id,
            goal_type='weekly_reduction',
            target_value=1,
            start_date=goal_start,
            end_date=goal_end,
            is_active=True,
        )
        db.session.add_all([pouch_goal, matching_mg, conflict_goal])
        db.session.flush()
        db.session.add(ReductionPlan(
            user_id=review_user.id,
            mode='reduce',
            status='draft',
            baseline_source='legacy_goal',
            end_target_pouches=4,
            migration_fingerprint=fingerprint_character * 64,
            legacy_goal_ids=[pouch_goal.id, matching_mg.id],
        ))

        observe_start = date.today() - timedelta(days=7)
        observe_plan = ReductionPlan(
            user_id=review_user.id,
            mode='observe',
            status='active',
            active_slot=1,
            start_date=observe_start,
            target_date=observe_start + timedelta(days=6),
            baseline_source='observe',
        )
        db.session.add(observe_plan)
        db.session.flush()
        observe_revision = PlanRevision(
            plan_id=observe_plan.id,
            effective_date=observe_start,
            generation_inputs={'mode': 'observe', 'duration_days': 7},
            preview_digest=digest_character * 64,
            reason='initial',
        )
        db.session.add(observe_revision)
        db.session.flush()
        observe_plan.active_revision_id = observe_revision.id
        for offset in range(7):
            db.session.add(PlanDay(
                plan_id=observe_plan.id,
                revision_id=observe_revision.id,
                local_date=observe_start + timedelta(days=offset),
                target_pouches=None,
                nicotine_ceiling_mg=None,
            ))
        db.session.add(PlanStatusEvent(
            plan_id=observe_plan.id,
            status='active',
            effective_at_utc=datetime.utcnow() - timedelta(days=7),
            local_date=observe_start,
            reason='fixture activation',
        ))

    seed_review_fixture('journey-review-desktop@example.com', 'c', 'd')
    seed_review_fixture('journey-review-mobile@example.com', 'e', 'f')

    def seed_release_user(
        email,
        *,
        offline_enabled=True,
        log_quantity=None,
        log_day_offsets=(),
        owned_data=False,
    ):
        """Build isolated, non-mutating Task 1 release inventory evidence."""
        is_inventory = email == 'release-inventory@example.com'
        release_user = User(
            email=email,
            email_verified=True,
            timezone='UTC',
            age=34 if is_inventory else None,
            gender='prefer_not_to_say' if is_inventory else None,
            weight=71.5 if is_inventory else None,
        )
        release_user.set_password('browser-password')
        db.session.add(release_user)
        db.session.flush()
        db.session.add(UserPreferences(
            user_id=release_user.id,
            offline_queue_enabled=offline_enabled,
            notification_channel=['email'],
            units_preference='percentage' if is_inventory else 'mg',
            preferred_brands=['Release Fixture'] if is_inventory else [],
        ))

        owned_pouch = None
        if owned_data:
            owned_pouch = Pouch(
                brand='Release Fixture',
                nicotine_mg=Decimal('3.50'),
                is_default=False,
                created_by=release_user.id,
            )
            db.session.add(owned_pouch)
            db.session.flush()
            db.session.add(Goal(
                user_id=release_user.id,
                goal_type='daily_pouches',
                target_value=4,
                start_date=date.today() - timedelta(days=5),
                is_active=True,
            ))
            db.session.add(Craving(
                user_id=release_user.id,
                craving_time=datetime.combine(date.today(), time(10, 0)),
                intensity=5,
                trigger='release fixture',
                outcome='resisted',
            ))

        day_offsets = tuple(log_day_offsets)
        if log_quantity is not None and not day_offsets:
            day_offsets = (1,)
        for index, day_offset in enumerate(day_offsets):
            log_day = date.today() - timedelta(days=day_offset)
            db.session.add(Log(
                user_id=release_user.id,
                pouch_id=(owned_pouch or default_pouch).id,
                log_date=log_day,
                log_time=datetime.combine(
                    log_day,
                    time(9 + (index % 8), 15),
                ),
                product_brand_snapshot=(
                    owned_pouch.brand if owned_pouch else default_pouch.brand
                ),
                nicotine_mg_snapshot=(
                    owned_pouch.nicotine_mg
                    if owned_pouch else default_pouch.nicotine_mg
                ),
                quantity=log_quantity or 1,
                notes='Release Fixture log' if is_inventory else None,
            ))
        return release_user

    seed_release_user('release-analytics-empty@example.com')
    seed_release_user(
        'release-analytics-sparse@example.com',
        log_day_offsets=(1,),
    )
    seed_release_user(
        'release-analytics-ready@example.com',
        log_day_offsets=(7, 6, 5, 4, 3, 2, 1),
    )
    seed_release_user('release-offline-enabled@example.com')
    seed_release_user(
        'release-offline-disabled@example.com',
        offline_enabled=False,
    )
    seed_release_user('release-settings@example.com')
    seed_release_user(
        'release-inventory@example.com',
        log_quantity=2,
        owned_data=True,
    )
    seed_release_user(
        'release-destructive@example.com',
        log_quantity=1,
        owned_data=True,
    )
    User.query.update({User.created_at: RELEASE_TEST_NOW.replace(tzinfo=None)})
    PlanRevision.query.update({
        PlanRevision.created_at: RELEASE_TEST_NOW.replace(tzinfo=None),
    })
    db.session.commit()


@app.post('/__test__/cleanup-today-events')
@login_required
def cleanup_today_events():
    """Remove only browser-created idempotent events for the signed-in fixture."""
    current_user = get_current_user()
    cravings = Craving.query.filter(
        Craving.user_id == current_user.id,
        Craving.client_event_id.isnot(None),
    ).all()
    linked_log_ids = [item.linked_log_id for item in cravings if item.linked_log_id]
    for craving in cravings:
        craving.linked_log_id = None
    db.session.flush()
    Log.query.filter(
        Log.user_id == current_user.id,
        Log.client_event_id.isnot(None),
    ).delete(synchronize_session=False)
    if linked_log_ids:
        Log.query.filter(
            Log.user_id == current_user.id,
            Log.id.in_(linked_log_ids),
        ).delete(synchronize_session=False)
    for craving in cravings:
        db.session.delete(craving)
    db.session.commit()
    return {'success': True}


@app.get('/__test__/external-notifications')
@login_required
def external_notifications():
    current_user = get_current_user()
    return {
        'notifications': [
            item for item in _OUTBOUND.records
            if item['kind'] == 'notification-queue'
            and item['user_id'] == current_user.id
        ],
        'boundaries': list(_OUTBOUND.records),
        'unexpected': list(_OUTBOUND.unexpected),
    }


@app.post('/__test__/clear-outbound')
@login_required
def clear_outbound():
    """Reset only the disposable browser server's transport recorder."""
    _OUTBOUND.records.clear()
    _OUTBOUND.unexpected.clear()
    return {'success': True}


@app.post('/__test__/clear-verification-cooldown')
@login_required
def clear_verification_cooldown():
    current_user = get_current_user()
    EmailVerification.query.filter_by(user_id=current_user.id).delete()
    db.session.commit()
    return {'success': True}


@app.get('/__test__/account-snapshot')
@login_required
def account_snapshot():
    """Expose exact isolated database state to browser release assertions."""
    current_user = get_current_user()
    preferences = current_user.preferences
    return {
        'profile': {
            'id': current_user.id,
            'email': current_user.email,
            'age': current_user.age,
            'gender': current_user.gender,
            'weight': float(current_user.weight) if current_user.weight is not None else None,
        },
        'preferences': {
            'units_preference': preferences.units_preference if preferences else None,
            'preferred_brands': preferences.preferred_brands if preferences else None,
            'offline_queue_enabled': (
                preferences.offline_queue_enabled if preferences else None
            ),
            'weekly_reports': preferences.weekly_reports if preferences else None,
            'notification_frequency': (
                preferences.notification_frequency if preferences else None
            ),
        },
        'logs': [{
            'id': item.id,
            'brand': get_historical_brand(item),
            'quantity': item.quantity,
            'notes': item.notes,
            'log_time': item.log_time.isoformat(),
            'pouch_id': item.pouch_id,
        } for item in current_user.logs.order_by(Log.id).all()],
        'pouches': [{
            'id': item.id,
            'brand': item.brand,
            'nicotine_mg': str(item.nicotine_mg),
        } for item in current_user.custom_pouches.order_by(Pouch.id).all()],
        'goals': [{
            'id': item.id,
            'goal_type': item.goal_type,
            'target_value': item.target_value,
            'current_streak': item.current_streak,
            'best_streak': item.best_streak,
            'is_active': item.is_active,
        } for item in current_user.goals.order_by(Goal.id).all()],
        'cravings': [{
            'id': item.id,
            'craving_time': item.craving_time.isoformat(),
            'intensity': item.intensity,
            'trigger': item.trigger,
            'notes': item.notes,
            'outcome': item.outcome,
        } for item in Craving.query.filter_by(
            user_id=current_user.id
        ).order_by(Craving.id).all()],
    }


@app.get('/__test__/owned-artifact-snapshot')
def owned_artifact_snapshot():
    """Expose exact post-deletion counts for one disposable browser identity."""
    user_id = request.args.get('user_id', type=int)
    brand = request.args.get('brand', type=str)
    if user_id is None or not brand:
        abort(400)
    return {
        'users': User.query.filter_by(id=user_id).count(),
        'logs': Log.query.filter_by(user_id=user_id).count(),
        'goals': Goal.query.filter_by(user_id=user_id).count(),
        'cravings': Craving.query.filter_by(user_id=user_id).count(),
        'owned_pouches': Pouch.query.filter_by(created_by=user_id).count(),
        'named_pouches': Pouch.query.filter_by(brand=brand).count(),
        'orphan_named_pouches': Pouch.query.filter(
            Pouch.brand == brand,
            Pouch.created_by.is_(None),
        ).count(),
    }


@app.get('/__test__/password-match')
@login_required
def password_match():
    """Expose only whether the authenticated disposable user matches a test password."""
    password = request.args.get('password', type=str)
    if not password:
        abort(400)
    return {'matches': get_current_user().check_password(password)}


@app.post('/__test__/age-goals-for-recalculation')
@login_required
def age_goals_for_recalculation():
    """Age UI-created goals and poison streaks so recalculation is observable."""
    current_user = get_current_user()
    goals = current_user.goals.all()
    for goal in goals:
        goal.start_date = _ReleaseTestDate(2026, 1, 1)
        goal.current_streak = 9
        goal.best_streak = 9
    db.session.commit()
    return {'goal_ids': [goal.id for goal in goals]}


@app.get('/__test__/release/goal-edit')
@login_required
def release_goal_edit():
    current_user = get_current_user()
    goal = Goal.query.filter_by(user_id=current_user.id).order_by(Goal.id).first()
    if goal is None:
        abort(404)
    return redirect(url_for('goals.edit_goal', goal_id=goal.id))


@app.get('/__test__/release/log-edit')
@login_required
def release_log_edit():
    current_user = get_current_user()
    log = Log.query.filter_by(user_id=current_user.id).order_by(Log.id).first()
    if log is None:
        abort(404)
    return redirect(url_for('logging.edit_log', log_id=log.id))


@app.get('/__test__/release/catalog-edit')
@login_required
def release_catalog_edit():
    current_user = get_current_user()
    pouch = Pouch.query.filter_by(
        created_by=current_user.id,
        is_default=False,
    ).order_by(Pouch.id).first()
    if pouch is None:
        abort(404)
    return redirect(url_for('catalog.edit_pouch', pouch_id=pouch.id))


if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5000, use_reloader=False)
