"""Disposable, in-memory application used only by Playwright."""

import sys
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT))

from app import create_app  # noqa: E402
from extensions import db  # noqa: E402
from routes.auth import get_current_user, login_required  # noqa: E402
from flask import render_template  # noqa: E402
from models import (  # noqa: E402
    Craving,
    DailyCheckIn,
    Goal,
    Log,
    PlanDay,
    PlanRevision,
    PlanStatusEvent,
    Pouch,
    ReductionPlan,
    User,
    UserPreferredPouch,
    UserPreferences,
)


app = create_app('testing')


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
    default_pouch = Pouch(
        brand='Steady Mint',
        nicotine_mg=Decimal('6.00'),
        is_default=True,
    )
    foreign_custom_pouch = Pouch(
        brand='Other User Custom',
        nicotine_mg=Decimal('9.00'),
        is_default=False,
        created_by=user.id,
    )
    db.session.add_all([default_pouch, foreign_custom_pouch])
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


if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5000, use_reloader=False)
