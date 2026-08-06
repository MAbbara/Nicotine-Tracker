"""Pure, deterministic reduction-plan schedule generation."""

from dataclasses import dataclass, replace
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation, ROUND_CEILING, ROUND_HALF_UP
import hashlib
import json
from typing import Literal


@dataclass(frozen=True)
class StageTarget:
    start_date: date
    end_date: date
    target_pouches: int | None
    nicotine_ceiling_mg: Decimal


@dataclass(frozen=True)
class PlanGenerationInput:
    mode: Literal['reduce', 'quit_by_date', 'observe']
    start_date: date
    target_basis: (
        Literal['nicotine_mg', 'legacy_pouches', 'observe'] | None
    ) = None
    baseline_pouches: Decimal | None = None
    baseline_mg: Decimal | None = None
    baseline_mg_per_pouch: Decimal | None = None
    pace: Literal['gentle', 'steady', 'focused'] | None = None
    end_target_pouches: int | None = None
    end_target_mg: Decimal | None = None
    target_date: date | None = None
    duration_days: int | None = None
    stage_targets: tuple[StageTarget, ...] | None = None


@dataclass(frozen=True)
class GeneratedPlanDay:
    local_date: date
    target_pouches: int | None
    nicotine_ceiling_mg: Decimal | None


@dataclass(frozen=True)
class GeneratedPlanPreview:
    days: tuple[GeneratedPlanDay, ...]
    normalized_stages: tuple[StageTarget, ...]
    digest: str


class PlanValidationError(ValueError):
    def __init__(self, field_errors: dict[str, str]):
        self.field_errors = field_errors
        super().__init__('plan generation input is invalid')


class PlanScheduleGenerator:
    """Public schedule-generation boundary; implemented through TDD slices."""

    DEFAULT_DURATIONS = {'gentle': 77, 'steady': 49, 'focused': 28}
    DURATION_RANGES = {
        'gentle': (70, 84),
        'steady': (42, 56),
        'focused': (21, 35),
    }

    @classmethod
    def generate(
        cls,
        generation_input: PlanGenerationInput,
        *,
        reference_date: date | None = None,
    ) -> GeneratedPlanPreview:
        date_errors = {}
        if type(generation_input.start_date) is not date:
            date_errors['start_date'] = 'must be a date'
        if reference_date is not None and type(reference_date) is not date:
            date_errors['reference_date'] = 'must be a date'
        if date_errors:
            raise PlanValidationError(date_errors)
        if (
            reference_date is not None
            and generation_input.start_date < reference_date
        ):
            raise PlanValidationError({
                'start_date': 'cannot be before the current user day'
            })
        if generation_input.mode == 'observe':
            basis_errors = {}
            if generation_input.target_basis not in (None, 'observe'):
                basis_errors['target_basis'] = (
                    'must be observe for observe plans'
                )
            if (
                generation_input.end_target_mg is not None
                or generation_input.end_target_pouches is not None
            ):
                basis_errors['target_basis'] = (
                    'observe plans cannot include a target value'
                )
            if basis_errors:
                raise PlanValidationError(basis_errors)
            return cls._generate_observe(generation_input)
        if generation_input.mode not in {'reduce', 'quit_by_date'}:
            raise PlanValidationError({'mode': 'unsupported mode'})
        if generation_input.target_basis is None:
            raise PlanValidationError({
                'target_basis': 'is required for targeted plans'
            })
        if generation_input.target_basis == 'nicotine_mg':
            if generation_input.end_target_pouches is not None:
                raise PlanValidationError({
                    'target_basis': 'cannot mix nicotine and pouch targets'
                })
            if generation_input.end_target_mg is None:
                raise PlanValidationError({
                    'end_target_mg': 'is required for nicotine-first plans'
                })
            return cls._generate_nicotine_first(generation_input)
        if generation_input.target_basis != 'legacy_pouches':
            raise PlanValidationError({
                'target_basis': 'must be nicotine_mg or legacy_pouches'
            })
        if generation_input.end_target_mg is not None:
            raise PlanValidationError({
                'target_basis': 'cannot mix nicotine and pouch targets'
            })
        if generation_input.end_target_pouches is None:
            raise PlanValidationError({'end_target_pouches': 'is required'})
        errors = {}
        for field in (
            'baseline_pouches', 'baseline_mg', 'baseline_mg_per_pouch'
        ):
            value = getattr(generation_input, field)
            if (
                not isinstance(value, Decimal)
                or not value.is_finite()
                or value <= 0
            ):
                errors[field] = 'must be a finite Decimal greater than zero'
        if generation_input.pace not in cls.DEFAULT_DURATIONS:
            errors['pace'] = 'must be gentle, steady, or focused'
        if generation_input.end_target_pouches is None:
            errors['end_target_pouches'] = 'is required'
        elif type(generation_input.end_target_pouches) is not int:
            errors['end_target_pouches'] = 'must be a whole number'
        elif generation_input.end_target_pouches < 0:
            errors['end_target_pouches'] = 'must be zero or greater'
        if (
            generation_input.duration_days is not None
            and type(generation_input.duration_days) is not int
        ):
            errors['duration_days'] = 'must be a whole number of days'
        if (
            generation_input.target_date is not None
            and type(generation_input.target_date) is not date
        ):
            errors['target_date'] = 'must be a date'
        if generation_input.mode == 'quit_by_date':
            if generation_input.target_date is None:
                errors['target_date'] = 'is required for quit-by-date plans'
            if generation_input.end_target_pouches not in (None, 0):
                errors['end_target_pouches'] = 'must be zero for quit-by-date plans'
        if errors:
            raise PlanValidationError(errors)

        baseline_pouches = generation_input.baseline_pouches
        strength = generation_input.baseline_mg_per_pouch
        start_target = int(baseline_pouches.to_integral_value(rounding=ROUND_CEILING))
        end_target = generation_input.end_target_pouches
        if end_target > start_target:
            raise PlanValidationError(
                {'end_target_pouches': 'cannot exceed the starting target'}
            )
        if generation_input.stage_targets is not None:
            stages = generation_input.stage_targets
            stage_errors = cls._validate_stages(
                stages,
                generation_input.start_date,
                start_target,
                end_target,
                strength,
            )
            if stage_errors:
                raise PlanValidationError(stage_errors)
            stages = tuple(
                StageTarget(
                    start_date=stage.start_date,
                    end_date=stage.end_date,
                    target_pouches=stage.target_pouches,
                    nicotine_ceiling_mg=stage.nicotine_ceiling_mg.quantize(
                        Decimal('0.01'), rounding=ROUND_HALF_UP
                    ),
                )
                for stage in stages
            )
            duration = (stages[-1].end_date - stages[0].start_date).days + 1
            if (
                generation_input.duration_days is not None
                and generation_input.duration_days != duration
            ):
                raise PlanValidationError({
                    'duration_days': 'is inconsistent with the explicit stages'
                })
            if (
                generation_input.target_date is not None
                and generation_input.target_date != stages[-1].end_date
            ):
                raise PlanValidationError({
                    'target_date': 'is inconsistent with the explicit stages'
                })
            minimum, maximum = cls.DURATION_RANGES[generation_input.pace]
            if not minimum <= duration <= maximum:
                raise PlanValidationError({
                    'duration_days': (
                        f'must be between {minimum} and {maximum} days for this pace'
                    )
                })
            reductions = start_target - end_target
            if duration < max(2, reductions + 1):
                raise PlanValidationError(
                    {'duration_days': 'is too short for the requested reduction'}
                )
            days = tuple(
                GeneratedPlanDay(day, stage.target_pouches,
                                 stage.nicotine_ceiling_mg.quantize(
                                     Decimal('0.01'), rounding=ROUND_HALF_UP
                                 ))
                for stage in stages
                for day in (
                    stage.start_date + timedelta(days=offset)
                    for offset in range(
                        (stage.end_date - stage.start_date).days + 1
                    )
                )
            )
            return GeneratedPlanPreview(
                days=days,
                normalized_stages=stages,
                digest=cls._digest(generation_input, days, stages),
            )
        if generation_input.mode == 'quit_by_date':
            duration = (
                generation_input.target_date - generation_input.start_date
            ).days + 1
            if duration <= 0:
                raise PlanValidationError(
                    {'target_date': 'must be on or after the start date'}
                )
            if (
                generation_input.duration_days is not None
                and generation_input.duration_days != duration
            ):
                raise PlanValidationError(
                    {'duration_days': 'is inconsistent with the selected target date'}
                )
        else:
            duration = (
                generation_input.duration_days
                if generation_input.duration_days is not None
                else cls.DEFAULT_DURATIONS[generation_input.pace]
            )
        minimum, maximum = cls.DURATION_RANGES[generation_input.pace]
        if not minimum <= duration <= maximum:
            raise PlanValidationError({
                'duration_days': (
                    f'must be between {minimum} and {maximum} days for this pace'
                )
            })
        reductions = start_target - end_target
        if duration < max(2, reductions + 1):
            raise PlanValidationError(
                {'duration_days': 'is too short for the requested reduction'}
            )
        try:
            expected_end = generation_input.start_date + timedelta(
                days=duration - 1
            )
        except OverflowError as exc:
            raise PlanValidationError({
                'start_date': 'the generated schedule exceeds the date range'
            }) from exc
        if (
            generation_input.target_date is not None
            and generation_input.target_date != expected_end
        ):
            raise PlanValidationError(
                {'target_date': 'is inconsistent with the selected duration'}
            )
        days = tuple(
            GeneratedPlanDay(
                local_date=generation_input.start_date + timedelta(days=index),
                target_pouches=(
                    start_target - (index * reductions // (duration - 1))
                ),
                nicotine_ceiling_mg=(
                    strength
                    * (start_target - (index * reductions // (duration - 1)))
                ).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP),
            )
            for index in range(duration)
        )
        stages = cls._stages_from_days(days)
        return GeneratedPlanPreview(
            days=days,
            normalized_stages=stages,
            digest=cls._digest(generation_input, days, stages),
        )

    @classmethod
    def _generate_nicotine_first(
        cls, generation_input: PlanGenerationInput
    ) -> GeneratedPlanPreview:
        errors = {}
        if generation_input.stage_targets is not None:
            errors['stage_targets'] = (
                'is supported only by the legacy pouch compatibility path'
            )
        if generation_input.pace not in cls.DEFAULT_DURATIONS:
            errors['pace'] = 'must be gentle, steady, or focused'

        baseline = generation_input.baseline_mg
        if (
            not isinstance(baseline, Decimal)
            or not baseline.is_finite()
            or baseline <= 0
            or baseline > Decimal('999999.99')
        ):
            errors['baseline_mg'] = 'must be a finite Decimal greater than zero'
        target = generation_input.end_target_mg
        if (
            not isinstance(target, Decimal)
            or not target.is_finite()
            or target < 0
            or target > Decimal('999999.99')
        ):
            errors['end_target_mg'] = (
                'must be a finite nonnegative Decimal'
            )
        for field in ('baseline_pouches', 'baseline_mg_per_pouch'):
            value = getattr(generation_input, field)
            if value is not None and (
                not isinstance(value, Decimal)
                or not value.is_finite()
                or value <= 0
            ):
                errors[field] = 'must be a finite Decimal greater than zero'
        if (
            generation_input.duration_days is not None
            and type(generation_input.duration_days) is not int
        ):
            errors['duration_days'] = 'must be a whole number of days'
        if (
            generation_input.target_date is not None
            and type(generation_input.target_date) is not date
        ):
            errors['target_date'] = 'must be a date'
        if generation_input.mode == 'quit_by_date':
            if generation_input.target_date is None:
                errors['target_date'] = 'is required for quit-by-date plans'
        if errors:
            raise PlanValidationError(errors)

        try:
            baseline = baseline.quantize(
                Decimal('0.01'), rounding=ROUND_HALF_UP
            )
        except InvalidOperation:
            raise PlanValidationError({
                'baseline_mg': 'cannot be represented at two decimal places'
            })
        try:
            target = target.quantize(
                Decimal('0.01'), rounding=ROUND_HALF_UP
            )
        except InvalidOperation:
            raise PlanValidationError({
                'end_target_mg': 'cannot be represented at two decimal places'
            })
        if baseline <= Decimal('0.00'):
            raise PlanValidationError({
                'baseline_mg': (
                    'must remain greater than zero after normalization'
                )
            })
        if generation_input.mode == 'reduce' and target >= baseline:
            raise PlanValidationError({
                'end_target_mg': 'must be lower than the baseline'
            })
        if generation_input.mode == 'quit_by_date' and target != Decimal('0.00'):
            raise PlanValidationError({
                'end_target_mg': 'must be zero for quit-by-date plans'
            })

        if generation_input.mode == 'quit_by_date':
            duration = (
                generation_input.target_date - generation_input.start_date
            ).days + 1
            if duration <= 0:
                raise PlanValidationError({
                    'target_date': 'must be on or after the start date'
                })
            if (
                generation_input.duration_days is not None
                and generation_input.duration_days != duration
            ):
                raise PlanValidationError({
                    'duration_days': (
                        'is inconsistent with the selected target date'
                    )
                })
        else:
            duration = (
                generation_input.duration_days
                if generation_input.duration_days is not None
                else cls.DEFAULT_DURATIONS[generation_input.pace]
            )
        minimum, maximum = cls.DURATION_RANGES[generation_input.pace]
        if not minimum <= duration <= maximum:
            raise PlanValidationError({
                'duration_days': (
                    f'must be between {minimum} and {maximum} days for this pace'
                )
            })
        try:
            expected_end = generation_input.start_date + timedelta(
                days=duration - 1
            )
        except OverflowError as exc:
            raise PlanValidationError({
                'start_date': 'the generated schedule exceeds the date range'
            }) from exc
        if (
            generation_input.target_date is not None
            and generation_input.target_date != expected_end
        ):
            raise PlanValidationError({
                'target_date': 'is inconsistent with the selected duration'
            })

        delta = baseline - target
        denominator = Decimal(duration - 1)
        generated_days = []
        for index in range(duration):
            if index == 0:
                ceiling = baseline
            elif index == duration - 1:
                ceiling = target
            else:
                ceiling = (
                    baseline - (delta * Decimal(index) / denominator)
                ).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
            generated_days.append(GeneratedPlanDay(
                local_date=generation_input.start_date + timedelta(days=index),
                target_pouches=None,
                nicotine_ceiling_mg=ceiling,
            ))
        days = tuple(generated_days)
        stages = cls._stages_from_days(days)
        normalized_input = replace(
            generation_input,
            baseline_mg=baseline,
            end_target_mg=target,
        )
        return GeneratedPlanPreview(
            days=days,
            normalized_stages=stages,
            digest=cls._digest(normalized_input, days, stages),
        )

    @staticmethod
    def _validate_stages(
        stages, start_date, start_target, end_target, strength
    ) -> dict[str, str]:
        if not isinstance(stages, tuple):
            return {'stage_targets': 'must be a tuple of stage targets'}
        if not stages:
            return {'stage_targets': 'must contain at least one stage'}
        if any(not isinstance(stage, StageTarget) for stage in stages):
            return {'stage_targets': 'must contain only stage targets'}
        if any(
            type(stage.start_date) is not date
            or type(stage.end_date) is not date
            or type(stage.target_pouches) is not int
            or not isinstance(stage.nicotine_ceiling_mg, Decimal)
            or not stage.nicotine_ceiling_mg.is_finite()
            for stage in stages
        ):
            return {'stage_targets': 'contains an invalid stage value'}
        if stages[0].start_date != start_date:
            return {'stage_targets': 'must begin on the selected start date'}
        if stages[0].target_pouches != start_target:
            return {'stage_targets': 'first stage must match the starting target'}
        previous = None
        for stage in stages:
            if stage.end_date < stage.start_date:
                return {'stage_targets': 'stage end dates cannot precede start dates'}
            if stage.target_pouches < 0 or stage.nicotine_ceiling_mg < 0:
                return {'stage_targets': 'stage targets cannot be negative'}
            expected_ceiling = (strength * stage.target_pouches).quantize(
                Decimal('0.01'), rounding=ROUND_HALF_UP
            )
            normalized_ceiling = stage.nicotine_ceiling_mg.quantize(
                Decimal('0.01'), rounding=ROUND_HALF_UP
            )
            if normalized_ceiling != expected_ceiling:
                return {
                    'stage_targets': (
                        'nicotine ceilings must match pouch targets and strength'
                    )
                }
            if previous is not None:
                try:
                    expected_start = previous.end_date + timedelta(days=1)
                except OverflowError:
                    return {
                        'stage_targets': (
                            'the generated schedule exceeds the date range'
                        )
                    }
                if stage.start_date != expected_start:
                    return {'stage_targets': 'stages must be contiguous'}
                if stage.target_pouches > previous.target_pouches:
                    return {'stage_targets': 'stage pouch targets cannot increase'}
            previous = stage
        if stages[-1].target_pouches != end_target:
            return {'stage_targets': 'final stage must match the end target'}
        return {}

    @classmethod
    def _generate_observe(
        cls, generation_input: PlanGenerationInput
    ) -> GeneratedPlanPreview:
        errors = {}
        if (
            generation_input.duration_days is not None
            and type(generation_input.duration_days) is not int
        ):
            errors['duration_days'] = 'must be a whole number of days'
        elif (
            generation_input.duration_days is not None
            and generation_input.duration_days != 7
        ):
            errors['duration_days'] = (
                'is inconsistent with the seven-day observe period'
            )
        try:
            expected_end = generation_input.start_date + timedelta(days=6)
        except OverflowError:
            errors['start_date'] = (
                'the seven-day observe period exceeds the date range'
            )
            expected_end = None
        if (
            expected_end is not None
            and generation_input.target_date is not None
            and generation_input.target_date != expected_end
        ):
            errors['target_date'] = (
                'is inconsistent with the seven-day observe period'
            )
        if generation_input.stage_targets is not None:
            errors['stage_targets'] = 'is not supported for observe mode'
        if errors:
            raise PlanValidationError(errors)
        days = tuple(
            GeneratedPlanDay(
                local_date=generation_input.start_date + timedelta(days=offset),
                target_pouches=None,
                nicotine_ceiling_mg=None,
            )
            for offset in range(7)
        )
        digest = cls._digest(generation_input, days, ())
        return GeneratedPlanPreview(days=days, normalized_stages=(), digest=digest)

    @staticmethod
    def _stages_from_days(
        days: tuple[GeneratedPlanDay, ...]
    ) -> tuple[StageTarget, ...]:
        stages = []
        stage_start = days[0]
        previous = days[0]
        for day in days[1:]:
            if (
                day.target_pouches != previous.target_pouches
                or day.nicotine_ceiling_mg != previous.nicotine_ceiling_mg
            ):
                stages.append(StageTarget(
                    start_date=stage_start.local_date,
                    end_date=previous.local_date,
                    target_pouches=previous.target_pouches,
                    nicotine_ceiling_mg=previous.nicotine_ceiling_mg,
                ))
                stage_start = day
            previous = day
        stages.append(StageTarget(
            start_date=stage_start.local_date,
            end_date=previous.local_date,
            target_pouches=previous.target_pouches,
            nicotine_ceiling_mg=previous.nicotine_ceiling_mg,
        ))
        return tuple(stages)

    @staticmethod
    def _digest(generation_input, days, stages) -> str:
        def canonical_decimal(value):
            if value is None:
                return None
            normalized = Decimal(value).normalize()
            return format(normalized, 'f')

        input_payload = {
            'mode': generation_input.mode,
            'start_date': days[0].local_date.isoformat(),
            'baseline_pouches': canonical_decimal(
                generation_input.baseline_pouches
            ),
            'baseline_mg': canonical_decimal(generation_input.baseline_mg),
            'baseline_mg_per_pouch': canonical_decimal(
                generation_input.baseline_mg_per_pouch
            ),
            'pace': generation_input.pace,
            'end_target_pouches': generation_input.end_target_pouches,
            'target_date': days[-1].local_date.isoformat(),
            'duration_days': len(days),
        }
        if generation_input.target_basis == 'nicotine_mg':
            input_payload.update({
                'target_basis': 'nicotine_mg',
                'end_target_mg': canonical_decimal(
                    generation_input.end_target_mg
                ),
            })
        payload = {
            'input': input_payload,
            'days': [
                {
                    'local_date': day.local_date.isoformat(),
                    'target_pouches': day.target_pouches,
                    'nicotine_ceiling_mg': (
                        format(day.nicotine_ceiling_mg, '.2f')
                        if day.nicotine_ceiling_mg is not None else None
                    ),
                }
                for day in days
            ],
            'stages': [
                {
                    'start_date': stage.start_date.isoformat(),
                    'end_date': stage.end_date.isoformat(),
                    'target_pouches': stage.target_pouches,
                    'nicotine_ceiling_mg': format(
                        stage.nicotine_ceiling_mg, '.2f'
                    ),
                }
                for stage in stages
            ],
        }
        return hashlib.sha256(
            json.dumps(payload, sort_keys=True, separators=(',', ':')).encode()
        ).hexdigest()
