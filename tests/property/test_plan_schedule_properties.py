"""Generative invariants for the pure plan schedule generator."""

from datetime import date, timedelta
from decimal import Decimal, ROUND_CEILING, ROUND_HALF_UP

from hypothesis import given, settings, strategies as st
import pytest

from services.plan_schedule import (
    PlanGenerationInput,
    PlanScheduleGenerator,
    PlanValidationError,
    StageTarget,
)


@st.composite
def valid_focused_plan_inputs(draw):
    baseline_pouches = Decimal(draw(st.integers(100, 10_000))) / 100
    strength = Decimal(draw(st.integers(10, 10_000))) / 100
    start_target = int(
        baseline_pouches.to_integral_value(rounding=ROUND_CEILING)
    )
    reduction = draw(st.integers(0, min(start_target, 20)))
    duration = draw(st.integers(max(21, reduction + 1), 35))
    return PlanGenerationInput(
        mode='reduce',
        start_date=date(2035, 1, 1),
        baseline_pouches=baseline_pouches,
        baseline_mg=(baseline_pouches * strength).quantize(Decimal('0.01')),
        baseline_mg_per_pouch=strength,
        pace='focused',
        end_target_pouches=start_target - reduction,
        duration_days=duration,
    )


@given(valid_focused_plan_inputs())
@settings(max_examples=150, deadline=None)
def test_auto_schedule_preserves_all_numeric_and_digest_invariants(
    generation_input,
):
    first = PlanScheduleGenerator.generate(generation_input)
    second = PlanScheduleGenerator.generate(generation_input)
    days = first.days
    start_target = int(
        generation_input.baseline_pouches.to_integral_value(
            rounding=ROUND_CEILING
        )
    )

    assert first == second
    assert len(days) == generation_input.duration_days
    assert days[0].local_date == generation_input.start_date
    assert days[-1].local_date == (
        generation_input.start_date
        + timedelta(days=generation_input.duration_days - 1)
    )
    assert days[0].target_pouches == start_target
    assert days[-1].target_pouches == generation_input.end_target_pouches
    assert all(
        current.local_date + timedelta(days=1) == following.local_date
        for current, following in zip(days, days[1:])
    )
    assert all(
        isinstance(day.target_pouches, int) and day.target_pouches >= 0
        for day in days
    )
    assert all(
        current.target_pouches >= following.target_pouches
        for current, following in zip(days, days[1:])
    )
    assert all(
        day.nicotine_ceiling_mg
        == (
            generation_input.baseline_mg_per_pouch * day.target_pouches
        ).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
        for day in days
    )
    assert len(first.digest) == 64


@given(
    split_day=st.integers(1, 20),
    end_target=st.integers(0, 10),
)
@settings(max_examples=60, deadline=None)
def test_valid_stage_partitions_expand_without_gaps(split_day, end_target):
    start = date(2035, 1, 1)
    stages = (
        StageTarget(
            start,
            start + timedelta(days=split_day - 1),
            10,
            Decimal('60'),
        ),
        StageTarget(
            start + timedelta(days=split_day),
            start + timedelta(days=20),
            end_target,
            Decimal(end_target * 6),
        ),
    )
    preview = PlanScheduleGenerator.generate(PlanGenerationInput(
        mode='reduce', start_date=start,
        baseline_pouches=Decimal('10'), baseline_mg=Decimal('60'),
        baseline_mg_per_pouch=Decimal('6'), pace='focused',
        end_target_pouches=end_target, duration_days=21,
        target_date=start + timedelta(days=20), stage_targets=stages,
    ))

    assert len(preview.days) == 21
    assert preview.normalized_stages == stages
    assert preview.days[split_day - 1].target_pouches == 10
    assert preview.days[split_day].target_pouches == end_target


@given(gap_days=st.integers(1, 30))
@settings(max_examples=30, deadline=None)
def test_invalid_stage_partitions_are_rejected(gap_days):
    start = date(2035, 1, 1)
    stages = (
        StageTarget(start, start + timedelta(days=9), 10, Decimal('60')),
        StageTarget(
            start + timedelta(days=10 + gap_days),
            start + timedelta(days=20 + gap_days),
            5,
            Decimal('30'),
        ),
    )

    with pytest.raises(PlanValidationError) as caught:
        PlanScheduleGenerator.generate(PlanGenerationInput(
            mode='reduce', start_date=start,
            baseline_pouches=Decimal('10'), baseline_mg=Decimal('60'),
            baseline_mg_per_pouch=Decimal('6'), pace='focused',
            end_target_pouches=5, stage_targets=stages,
        ))

    assert 'stage_targets' in caught.value.field_errors
