"""Examples for the pure reduction schedule generator."""

from dataclasses import FrozenInstanceError
from datetime import date, timedelta
from decimal import Decimal

import pytest

from services.plan_schedule import (
    GeneratedPlanDay,
    GeneratedPlanPreview,
    PlanGenerationInput,
    PlanScheduleGenerator,
    PlanValidationError,
    StageTarget,
)


def test_schedule_contracts_are_immutable_values():
    generation_input = PlanGenerationInput(
        mode='reduce',
        start_date=date(2027, 1, 1),
        baseline_pouches=Decimal('8.00'),
        baseline_mg=Decimal('48.00'),
        baseline_mg_per_pouch=Decimal('6.00'),
        pace='steady',
        end_target_pouches=2,
    )
    with pytest.raises(FrozenInstanceError):
        generation_input.mode = 'observe'


def test_observe_mode_produces_seven_honestly_untargeted_days():
    preview = PlanScheduleGenerator.generate(PlanGenerationInput(
        mode='observe', start_date=date(2027, 1, 1)
    ))
    assert len(preview.days) == 7
    assert preview.days[0] == GeneratedPlanDay(date(2027, 1, 1), None, None)
    assert preview.days[-1] == GeneratedPlanDay(date(2027, 1, 7), None, None)
    assert preview.normalized_stages == ()
    assert len(preview.digest) == 64


def test_steady_reduce_uses_default_duration_and_exact_endpoints():
    preview = PlanScheduleGenerator.generate(PlanGenerationInput(
        mode='reduce',
        start_date=date(2027, 1, 1),
        baseline_pouches=Decimal('8.20'),
        baseline_mg=Decimal('49.20'),
        baseline_mg_per_pouch=Decimal('6.00'),
        pace='steady',
        end_target_pouches=2,
    ))
    assert len(preview.days) == 49
    assert preview.days[0] == GeneratedPlanDay(
        date(2027, 1, 1), 9, Decimal('54.00')
    )
    assert preview.days[-1] == GeneratedPlanDay(
        date(2027, 2, 18), 2, Decimal('12.00')
    )
    assert all(
        current.target_pouches >= following.target_pouches
        for current, following in zip(preview.days, preview.days[1:])
    )


def test_quit_by_date_derives_inclusive_duration_and_ends_at_zero():
    preview = PlanScheduleGenerator.generate(PlanGenerationInput(
        mode='quit_by_date',
        start_date=date(2027, 1, 1),
        target_date=date(2027, 1, 30),
        baseline_pouches=Decimal('5.00'),
        baseline_mg=Decimal('30.00'),
        baseline_mg_per_pouch=Decimal('6.00'),
        pace='focused',
        end_target_pouches=0,
    ))
    assert len(preview.days) == 30
    assert preview.days[0].target_pouches == 5
    assert preview.days[-1] == GeneratedPlanDay(
        date(2027, 1, 30), 0, Decimal('0.00')
    )


def test_explicit_contiguous_stages_are_expanded_exactly():
    stages = (
        StageTarget(date(2027, 1, 1), date(2027, 1, 10), 8, Decimal('48.00')),
        StageTarget(date(2027, 1, 11), date(2027, 1, 21), 6, Decimal('36.00')),
    )
    preview = PlanScheduleGenerator.generate(PlanGenerationInput(
        mode='reduce',
        start_date=date(2027, 1, 1),
        target_date=date(2027, 1, 21),
        duration_days=21,
        baseline_pouches=Decimal('8.00'),
        baseline_mg=Decimal('48.00'),
        baseline_mg_per_pouch=Decimal('6.00'),
        pace='focused',
        end_target_pouches=6,
        stage_targets=stages,
    ))
    assert preview.normalized_stages == stages
    assert [day.target_pouches for day in preview.days[:10]] == [8] * 10
    assert [day.target_pouches for day in preview.days[10:]] == [6] * 11


@pytest.mark.parametrize(('pace', 'expected_days'), (
    ('gentle', 77), ('steady', 49), ('focused', 28),
))
def test_each_pace_has_the_approved_default_duration(pace, expected_days):
    preview = PlanScheduleGenerator.generate(PlanGenerationInput(
        mode='reduce', start_date=date(2027, 1, 1),
        baseline_pouches=Decimal('10.00'), baseline_mg=Decimal('60.00'),
        baseline_mg_per_pouch=Decimal('6.00'), pace=pace,
        end_target_pouches=3,
    ))
    assert len(preview.days) == expected_days


@pytest.mark.parametrize(('overrides', 'field'), (
    ({'baseline_pouches': Decimal('0')}, 'baseline_pouches'),
    ({'baseline_pouches': Decimal('NaN')}, 'baseline_pouches'),
    ({'baseline_mg': None}, 'baseline_mg'),
    ({'baseline_mg': Decimal('Infinity')}, 'baseline_mg'),
    ({'baseline_mg_per_pouch': Decimal('-1')}, 'baseline_mg_per_pouch'),
    ({'end_target_pouches': 11}, 'end_target_pouches'),
    ({'duration_days': 0}, 'duration_days'),
    ({'duration_days': 10}, 'duration_days'),
))
def test_targeted_modes_return_structured_field_errors(overrides, field):
    values = {
        'mode': 'reduce', 'start_date': date(2027, 1, 1),
        'baseline_pouches': Decimal('10.00'),
        'baseline_mg': Decimal('60.00'),
        'baseline_mg_per_pouch': Decimal('6.00'),
        'pace': 'steady', 'end_target_pouches': 2,
    }
    values.update(overrides)
    with pytest.raises(PlanValidationError) as caught:
        PlanScheduleGenerator.generate(PlanGenerationInput(**values))
    assert field in caught.value.field_errors


def test_observe_rejects_inconsistent_redundant_bounds():
    with pytest.raises(PlanValidationError) as caught:
        PlanScheduleGenerator.generate(PlanGenerationInput(
            mode='observe', start_date=date(2027, 1, 1), duration_days=8
        ))
    assert caught.value.field_errors == {
        'duration_days': 'is inconsistent with the seven-day observe period'
    }


def test_observe_duration_must_be_a_whole_number_when_supplied():
    with pytest.raises(PlanValidationError) as caught:
        PlanScheduleGenerator.generate(PlanGenerationInput(
            mode='observe', start_date=date(2027, 1, 1),
            duration_days=Decimal('7'),
        ))
    assert caught.value.field_errors == {
        'duration_days': 'must be a whole number of days'
    }


@pytest.mark.parametrize('stages', (
    (
        StageTarget(date(2027, 1, 1), date(2027, 1, 10), 8, Decimal('48')),
        StageTarget(date(2027, 1, 12), date(2027, 1, 21), 6, Decimal('36')),
    ),
    (
        StageTarget(date(2027, 1, 1), date(2027, 1, 10), 6, Decimal('36')),
        StageTarget(date(2027, 1, 11), date(2027, 1, 21), 8, Decimal('48')),
    ),
))
def test_explicit_stages_reject_gaps_and_increases(stages):
    with pytest.raises(PlanValidationError) as caught:
        PlanScheduleGenerator.generate(PlanGenerationInput(
            mode='reduce', start_date=date(2027, 1, 1),
            baseline_pouches=Decimal('8'), baseline_mg=Decimal('48'),
            baseline_mg_per_pouch=Decimal('6'), pace='focused',
            end_target_pouches=stages[-1].target_pouches,
            stage_targets=stages,
        ))
    assert 'stage_targets' in caught.value.field_errors


@pytest.mark.parametrize('stages', (
    (),
    (
        StageTarget(date(2027, 1, 1), date(2027, 1, 21), 7, Decimal('42')),
    ),
))
def test_explicit_stages_must_define_the_full_schedule_from_baseline(stages):
    with pytest.raises(PlanValidationError) as caught:
        PlanScheduleGenerator.generate(PlanGenerationInput(
            mode='reduce', start_date=date(2027, 1, 1),
            baseline_pouches=Decimal('8'), baseline_mg=Decimal('48'),
            baseline_mg_per_pouch=Decimal('6'), pace='focused',
            end_target_pouches=7, stage_targets=stages,
        ))
    assert 'stage_targets' in caught.value.field_errors


def test_observe_accepts_only_its_derived_target_date_when_redundant():
    preview = PlanScheduleGenerator.generate(PlanGenerationInput(
        mode='observe', start_date=date(2027, 1, 1),
        duration_days=7, target_date=date(2027, 1, 7),
    ))
    assert preview.days[-1].local_date == date(2027, 1, 7)

    with pytest.raises(PlanValidationError) as caught:
        PlanScheduleGenerator.generate(PlanGenerationInput(
            mode='observe', start_date=date(2027, 1, 1),
            target_date=date(2027, 1, 8),
        ))
    assert 'target_date' in caught.value.field_errors


def test_observe_rejects_explicit_stages_instead_of_silently_ignoring_them():
    with pytest.raises(PlanValidationError) as caught:
        PlanScheduleGenerator.generate(PlanGenerationInput(
            mode='observe', start_date=date(2027, 1, 1),
            stage_targets=(
                StageTarget(
                    date(2027, 1, 1), date(2027, 1, 7),
                    1, Decimal('6'),
                ),
            ),
        ))
    assert caught.value.field_errors == {
        'stage_targets': 'is not supported for observe mode'
    }


def test_schedule_generation_is_independent_of_the_wall_clock():
    generation_input = PlanGenerationInput(
        mode='observe', start_date=date(2000, 1, 1)
    )
    first = PlanScheduleGenerator.generate(generation_input)
    second = PlanScheduleGenerator.generate(generation_input)
    assert first == second
    assert first.days[0].local_date == date(2000, 1, 1)


def test_injected_reference_date_rejects_past_starts_without_clock_reads():
    with pytest.raises(PlanValidationError) as caught:
        PlanScheduleGenerator.generate(
            PlanGenerationInput(mode='observe', start_date=date(2027, 1, 1)),
            reference_date=date(2027, 1, 2),
        )
    assert caught.value.field_errors == {
        'start_date': 'cannot be before the current user day'
    }


def test_quit_target_date_cannot_precede_start_date():
    with pytest.raises(PlanValidationError) as caught:
        PlanScheduleGenerator.generate(PlanGenerationInput(
            mode='quit_by_date', start_date=date(2027, 2, 1),
            target_date=date(2027, 1, 31),
            baseline_pouches=Decimal('5'), baseline_mg=Decimal('30'),
            baseline_mg_per_pouch=Decimal('6'), pace='focused',
            end_target_pouches=0,
        ))
    assert 'target_date' in caught.value.field_errors


def test_duration_must_fit_every_requested_whole_pouch_drop():
    with pytest.raises(PlanValidationError) as caught:
        PlanScheduleGenerator.generate(PlanGenerationInput(
            mode='reduce', start_date=date(2027, 1, 1),
            baseline_pouches=Decimal('30'), baseline_mg=Decimal('180'),
            baseline_mg_per_pouch=Decimal('6'), pace='focused',
            end_target_pouches=0, duration_days=21,
        ))
    assert caught.value.field_errors == {
        'duration_days': 'is too short for the requested reduction'
    }


def test_explicit_stages_cannot_bypass_minimum_reduction_duration():
    with pytest.raises(PlanValidationError) as caught:
        PlanScheduleGenerator.generate(PlanGenerationInput(
            mode='reduce', start_date=date(2027, 1, 1),
            baseline_pouches=Decimal('30'), baseline_mg=Decimal('180'),
            baseline_mg_per_pouch=Decimal('6'), pace='focused',
            end_target_pouches=0,
            stage_targets=(
                StageTarget(
                    date(2027, 1, 1), date(2027, 1, 20),
                    30, Decimal('180'),
                ),
                StageTarget(
                    date(2027, 1, 21), date(2027, 1, 21),
                    0, Decimal('0'),
                ),
            ),
        ))
    assert caught.value.field_errors == {
        'duration_days': 'is too short for the requested reduction'
    }


def test_explicit_stage_ceilings_must_match_strength_times_target():
    with pytest.raises(PlanValidationError) as caught:
        PlanScheduleGenerator.generate(PlanGenerationInput(
            mode='reduce', start_date=date(2027, 1, 1),
            baseline_pouches=Decimal('8'), baseline_mg=Decimal('48'),
            baseline_mg_per_pouch=Decimal('6'), pace='focused',
            end_target_pouches=6,
            stage_targets=(
                StageTarget(
                    date(2027, 1, 1), date(2027, 1, 10),
                    8, Decimal('48'),
                ),
                StageTarget(
                    date(2027, 1, 11), date(2027, 1, 21),
                    6, Decimal('999'),
                ),
            ),
        ))
    assert caught.value.field_errors == {
        'stage_targets': 'nicotine ceilings must match pouch targets and strength'
    }


def test_explicit_stage_ceilings_are_normalized_before_preview_and_hashing():
    preview = PlanScheduleGenerator.generate(PlanGenerationInput(
        mode='reduce', start_date=date(2027, 1, 1),
        baseline_pouches=Decimal('8'), baseline_mg=Decimal('48'),
        baseline_mg_per_pouch=Decimal('6'), pace='focused',
        end_target_pouches=6,
        stage_targets=(
            StageTarget(
                date(2027, 1, 1), date(2027, 1, 10),
                8, Decimal('48.004'),
            ),
            StageTarget(
                date(2027, 1, 11), date(2027, 1, 21),
                6, Decimal('36.004'),
            ),
        ),
    ))
    assert [stage.nicotine_ceiling_mg for stage in preview.normalized_stages] == [
        Decimal('48.00'), Decimal('36.00')
    ]
    assert preview.days[-1].nicotine_ceiling_mg == Decimal('36.00')


@pytest.mark.parametrize('stage_targets', (
    [
        StageTarget(date(2027, 1, 1), date(2027, 1, 21), 8, Decimal('48')),
    ],
    (
        StageTarget(
            date(2027, 1, 1), date(2027, 1, 21), Decimal('8'), Decimal('48')
        ),
    ),
    (
        StageTarget(date(2027, 1, 1), date(2027, 1, 21), 8, 48.0),
    ),
))
def test_explicit_stage_runtime_types_fail_as_structured_validation(
    stage_targets,
):
    with pytest.raises(PlanValidationError) as caught:
        PlanScheduleGenerator.generate(PlanGenerationInput(
            mode='reduce', start_date=date(2027, 1, 1),
            baseline_pouches=Decimal('8'), baseline_mg=Decimal('48'),
            baseline_mg_per_pouch=Decimal('6'), pace='focused',
            end_target_pouches=8, stage_targets=stage_targets,
        ))
    assert 'stage_targets' in caught.value.field_errors


@pytest.mark.parametrize(('overrides', 'field'), (
    ({'end_target_pouches': 2.0}, 'end_target_pouches'),
    ({'end_target_pouches': Decimal('2')}, 'end_target_pouches'),
    ({'duration_days': Decimal('49')}, 'duration_days'),
))
def test_top_level_runtime_types_fail_as_structured_validation(
    overrides, field,
):
    values = {
        'mode': 'reduce', 'start_date': date(2027, 1, 1),
        'baseline_pouches': Decimal('8'), 'baseline_mg': Decimal('48'),
        'baseline_mg_per_pouch': Decimal('6'), 'pace': 'steady',
        'end_target_pouches': 2,
    }
    values.update(overrides)
    with pytest.raises(PlanValidationError) as caught:
        PlanScheduleGenerator.generate(PlanGenerationInput(**values))
    assert field in caught.value.field_errors


def test_digest_covers_reviewed_baseline_inputs_not_only_generated_days():
    common = dict(
        mode='reduce', start_date=date(2027, 1, 1),
        baseline_pouches=Decimal('8'), baseline_mg_per_pouch=Decimal('6'),
        pace='steady', end_target_pouches=2,
    )
    first = PlanScheduleGenerator.generate(PlanGenerationInput(
        **common, baseline_mg=Decimal('48')
    ))
    second = PlanScheduleGenerator.generate(PlanGenerationInput(
        **common, baseline_mg=Decimal('49')
    ))
    assert first.days == second.days
    assert first.digest != second.digest


def test_observe_date_horizon_overflow_is_structured_validation():
    with pytest.raises(PlanValidationError) as caught:
        PlanScheduleGenerator.generate(PlanGenerationInput(
            mode='observe', start_date=date.max,
        ))
    assert 'start_date' in caught.value.field_errors


def test_generated_reduce_date_horizon_overflow_is_structured_validation():
    with pytest.raises(PlanValidationError) as caught:
        PlanScheduleGenerator.generate(PlanGenerationInput(
            mode='reduce', start_date=date.max,
            baseline_pouches=Decimal('2'), baseline_mg=Decimal('2'),
            baseline_mg_per_pouch=Decimal('1'), pace='focused',
            end_target_pouches=1,
        ))
    assert 'start_date' in caught.value.field_errors


def test_explicit_stage_adjacency_at_date_max_is_structured_validation():
    with pytest.raises(PlanValidationError) as caught:
        PlanScheduleGenerator.generate(PlanGenerationInput(
            mode='reduce', start_date=date.max - timedelta(days=1),
            baseline_pouches=Decimal('2'), baseline_mg=Decimal('2'),
            baseline_mg_per_pouch=Decimal('1'), pace='focused',
            end_target_pouches=1,
            stage_targets=(
                StageTarget(
                    date.max - timedelta(days=1), date.max,
                    2, Decimal('2'),
                ),
                StageTarget(date.max, date.max, 1, Decimal('1')),
            ),
        ))
    assert 'stage_targets' in caught.value.field_errors
