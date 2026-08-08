"""Canonical parsers for API request payloads.

Every parser returns a normalized value or raises
:class:`services.api_errors.ApiValidationError` with field paths pointing at
the offending input. Parsers never coerce bools to integers, never accept
free text, and never pass unknown keys through.
"""
import re
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation, ROUND_CEILING, ROUND_HALF_UP

from services.api_errors import ApiValidationError
from services.plan_schedule import PlanGenerationInput, StageTarget

CURRENT_STEPS = ('intention', 'baseline', 'pace', 'support', 'review')

_INTENTIONS = ('reduce', 'quit_by_date', 'observe')
_BASELINE_SOURCES = ('manual', 'recent_logs', 'observe', 'legacy_goal')
_PACES = ('gentle', 'steady', 'focused')
_DIFFICULT_TIMES = (
    'morning', 'after_meals', 'work_breaks', 'afternoon', 'evening',
    'late_night',
)
_COMMON_TRIGGERS = (
    'stress', 'boredom', 'focus', 'social', 'routine', 'after_meals',
)
_REMINDER_WINDOWS = ('none', 'morning', 'afternoon', 'evening')

_DECIMAL_KEYS = ('baseline_pouches', 'baseline_mg', 'baseline_mg_per_pouch')
_DATE_KEYS = ('start_date', 'target_date')

_DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')


def _invalid(errors, path, message):
    errors.setdefault(path, []).append(message)


def _parse_enum(value, allowed, path, errors):
    if not isinstance(value, str) or value not in allowed:
        _invalid(errors, path, 'Choose one of: {}.'.format(', '.join(allowed)))
        return None
    return value


def _parse_positive_decimal(value, path, errors):
    """JSON string representing a finite value > 0, normalized to 2dp."""
    if not isinstance(value, str):
        _invalid(errors, path, 'Enter a number as text, for example "6.00".')
        return None
    try:
        parsed = Decimal(value)
    except (InvalidOperation, ValueError):
        _invalid(errors, path, 'Enter a valid number.')
        return None
    if not parsed.is_finite() or parsed <= 0:
        _invalid(errors, path, 'Enter a number greater than zero.')
        return None
    try:
        normalized = parsed.quantize(
            Decimal('0.01'), rounding=ROUND_HALF_UP
        )
    except InvalidOperation:
        _invalid(errors, path, 'Enter a valid number.')
        return None
    if normalized <= 0:
        _invalid(errors, path, 'Enter a number greater than zero.')
        return None
    return str(normalized)


def _parse_bounded_decimal(value, path, errors, *, maximum,
                           allow_zero=False):
    """Parse a persistence-bounded decimal string into a Decimal."""
    if not isinstance(value, str):
        _invalid(errors, path, 'Enter a number as text, for example "6.00".')
        return None
    try:
        parsed = Decimal(value)
    except (InvalidOperation, ValueError):
        _invalid(errors, path, 'Enter a valid number.')
        return None
    if not parsed.is_finite():
        _invalid(errors, path, 'Enter a finite number.')
        return None
    if (
        parsed < 0
        or (parsed == 0 and parsed.as_tuple().sign)
        or (not allow_zero and parsed <= 0)
    ):
        _invalid(errors, path, 'Enter a number greater than zero.')
        return None
    if parsed > maximum:
        _invalid(errors, path, 'Enter a number within the supported range.')
        return None
    try:
        normalized = parsed.quantize(
            Decimal('0.01'), rounding=ROUND_HALF_UP
        )
    except InvalidOperation:
        _invalid(errors, path, 'Enter a valid number.')
        return None
    if (
        normalized < 0
        or (parsed > 0 and normalized == 0)
        or (not allow_zero and normalized <= 0)
    ):
        _invalid(errors, path, 'Enter a number greater than zero.')
        return None
    if normalized > maximum:
        _invalid(errors, path, 'Enter a number within the supported range.')
        return None
    return normalized


def _parse_date(value, path, errors):
    if not isinstance(value, str) or not _DATE_RE.match(value):
        _invalid(errors, path, 'Use the YYYY-MM-DD date format.')
        return None
    try:
        parsed = date.fromisoformat(value)
    except ValueError:
        _invalid(errors, path, 'Enter a real calendar date.')
        return None
    return parsed.isoformat()


def _parse_int(value, minimum, maximum, path, errors):
    # bool is a subclass of int; never accept it.
    if isinstance(value, bool) or not isinstance(value, int):
        _invalid(errors, path, 'Enter a whole number.')
        return None
    if value < minimum or value > maximum:
        _invalid(errors, path,
                 'Enter a whole number from {} to {}.'.format(minimum, maximum))
        return None
    return value


def _parse_choice_list(value, allowed, path, errors):
    if not isinstance(value, list):
        _invalid(errors, path, 'Choose from the available options.')
        return None
    seen = []
    ok = True
    for item in value:
        if not isinstance(item, str) or item not in allowed or item in seen:
            _invalid(errors, path, 'Choose from the available options, once each.')
            ok = False
            break
        seen.append(item)
    return seen if ok else None


def _parse_pouch_ids(value, path, errors):
    if not isinstance(value, list) or len(value) > 10:
        _invalid(errors, path, 'Choose up to 10 pouches.')
        return None
    seen = []
    ok = True
    for item in value:
        if isinstance(item, bool) or not isinstance(item, int) or item <= 0:
            _invalid(errors, path, 'Choose from your pouch list.')
            ok = False
            break
        if item in seen:
            _invalid(errors, path, 'Remove duplicate pouch choices.')
            ok = False
            break
        seen.append(item)
    return seen if ok else None


_STAGE_KEYS = ('start_date', 'end_date', 'target_pouches',
               'nicotine_ceiling_mg')


def _parse_stage_targets(value, path, errors):
    if not isinstance(value, list) or len(value) > 84:
        _invalid(errors, path, 'Add at most 84 stages.')
        return None
    stages = []
    ok = True
    for index, item in enumerate(value):
        item_path = '{}[{}]'.format(path, index)
        if not isinstance(item, dict):
            _invalid(errors, item_path, 'Each stage must be an object.')
            ok = False
            continue
        unknown = set(item.keys()) - set(_STAGE_KEYS)
        if unknown:
            for key in sorted(unknown):
                _invalid(errors, '{}.{}'.format(item_path, key),
                         'This field is not supported.')
            ok = False
            continue
        missing = [key for key in _STAGE_KEYS if key not in item]
        if missing:
            for key in missing:
                _invalid(errors, '{}.{}'.format(item_path, key),
                         'This field is required.')
            ok = False
            continue
        stage_errors = {}
        start = _parse_date(item['start_date'],
                            '{}.start_date'.format(item_path), stage_errors)
        end = _parse_date(item['end_date'],
                          '{}.end_date'.format(item_path), stage_errors)
        target = _parse_int(item['target_pouches'], 0, 1000,
                            '{}.target_pouches'.format(item_path),
                            stage_errors)
        ceiling = _parse_nonnegative_decimal(
            item['nicotine_ceiling_mg'],
            '{}.nicotine_ceiling_mg'.format(item_path), stage_errors)
        if stage_errors:
            errors.update(stage_errors)
            ok = False
            continue
        stages.append({
            'start_date': start,
            'end_date': end,
            'target_pouches': target,
            'nicotine_ceiling_mg': ceiling,
        })
    return stages if ok else None


def _parse_nonnegative_decimal(value, path, errors):
    """Parse a draft stage ceiling, where an exact zero is valid."""
    if not isinstance(value, str):
        _invalid(errors, path, 'Enter a number as text, for example "0.00".')
        return None
    try:
        parsed = Decimal(value)
    except (InvalidOperation, ValueError):
        _invalid(errors, path, 'Enter a valid number.')
        return None
    if (
        not parsed.is_finite()
        or parsed < 0
        or (parsed == 0 and parsed.as_tuple().sign)
    ):
        _invalid(errors, path, 'Enter a nonnegative number.')
        return None
    try:
        normalized = parsed.quantize(Decimal('0.01'))
    except InvalidOperation:
        _invalid(errors, path, 'Enter a valid number.')
        return None
    if parsed > 0 and normalized == 0:
        _invalid(errors, path, 'Enter a number with at least two decimals.')
        return None
    return str(normalized)


def _parse_onboarding_target_mg(value, path, errors):
    parsed = _parse_bounded_decimal(
        value,
        path,
        errors,
        maximum=Decimal('999999.99'),
        allow_zero=True,
    )
    return None if parsed is None else format(parsed, '.2f')


_STRUCTURED_PARSERS = {
    'intention': lambda v, p, e: _parse_enum(v, _INTENTIONS, p, e),
    'baseline_source': lambda v, p, e: _parse_enum(v, _BASELINE_SOURCES, p, e),
    'baseline_pouches': _parse_positive_decimal,
    'baseline_mg': _parse_positive_decimal,
    'baseline_mg_per_pouch': _parse_positive_decimal,
    'pace': lambda v, p, e: _parse_enum(v, _PACES, p, e),
    'start_date': _parse_date,
    'target_date': _parse_date,
    'duration_days': lambda v, p, e: _parse_int(v, 1, 365, p, e),
    'end_target_pouches': lambda v, p, e: _parse_int(v, 0, 1000, p, e),
    'end_target_mg': _parse_onboarding_target_mg,
    'target_basis': lambda v, p, e: _parse_enum(
        v, ('nicotine_mg', 'legacy_pouches', 'observe'), p, e
    ),
    'stage_targets': _parse_stage_targets,
    'difficult_times': lambda v, p, e: _parse_choice_list(
        v, _DIFFICULT_TIMES, p, e),
    'common_triggers': lambda v, p, e: _parse_choice_list(
        v, _COMMON_TRIGGERS, p, e),
    'preferred_pouch_ids': _parse_pouch_ids,
    'reminder_window': lambda v, p, e: _parse_enum(
        v, _REMINDER_WINDOWS, p, e),
}


def parse_onboarding_draft_payload(body):
    """Validate and normalize a PUT /api/onboarding-draft body.

    Returns ``(current_step, structured_payload)`` with canonical values.
    Raises :class:`ApiValidationError` on any violation.
    """
    errors = {}
    if not isinstance(body, dict):
        raise ApiValidationError({'body': ['Send a JSON object.']})

    unknown = set(body.keys()) - {'current_step', 'structured_payload'}
    for key in sorted(unknown):
        _invalid(errors, key, 'This field is not supported.')

    current_step = body.get('current_step')
    if current_step not in CURRENT_STEPS:
        _invalid(errors, 'current_step',
                 'Choose one of: {}.'.format(', '.join(CURRENT_STEPS)))

    raw_payload = body.get('structured_payload')
    if 'structured_payload' not in body:
        _invalid(errors, 'structured_payload', 'This field is required.')
    elif not isinstance(raw_payload, dict):
        _invalid(errors, 'structured_payload', 'Send a JSON object.')
        raw_payload = None

    normalized = {}
    if raw_payload is not None:
        for key in sorted(set(raw_payload.keys()) - set(_STRUCTURED_PARSERS)):
            _invalid(errors, 'structured_payload.{}'.format(key),
                     'This field is not supported.')
        for key, value in raw_payload.items():
            parser = _STRUCTURED_PARSERS.get(key)
            if parser is None:
                continue
            parsed = parser(value, 'structured_payload.{}'.format(key), errors)
            if parsed is not None:
                normalized[key] = parsed

    if errors:
        raise ApiValidationError(errors)
    return current_step, normalized


_PLAN_KEYS = {
    'mode', 'baseline_source', 'baseline_pouches', 'baseline_mg',
    'baseline_mg_per_pouch', 'pace', 'start_date', 'target_date',
    'duration_days', 'target_basis', 'end_target_pouches', 'end_target_mg',
    'stage_targets',
}
_PLAN_REQUIRED_KEYS = {
    'mode', 'target_basis', 'baseline_source', 'baseline_pouches',
    'baseline_mg', 'baseline_mg_per_pouch', 'pace', 'start_date',
    'target_date', 'duration_days', 'stage_targets',
}
_PLAN_MODES = ('reduce', 'quit_by_date', 'observe')
_PLAN_BASELINE_SOURCES = ('manual', 'recent_logs', 'observe', 'legacy_goal')
_PLAN_PACES = ('gentle', 'steady', 'focused')
_PLAN_STAGE_KEYS = ('start_date', 'end_date', 'target_pouches',
                     'nicotine_ceiling_mg')
_PLAN_POUCH_MAX = Decimal('9999.99')
_PLAN_MG_MAX = Decimal('999999.99')
_PLAN_DEFAULT_DURATIONS = {'gentle': 77, 'steady': 49, 'focused': 28}


def _guard_schedule_date_range(start, duration, path, errors):
    """Reject generated windows that cannot fit Python's date range."""
    if start is None or duration is None:
        return
    try:
        start + timedelta(days=duration - 1)
    except OverflowError:
        _invalid(errors, path, 'The generated schedule exceeds the date range.')


def _parse_plan_stage_targets(value, path, errors):
    if value is None:
        return None
    if not isinstance(value, list) or len(value) > 84:
        _invalid(errors, path, 'Provide at most 84 stages, or null.')
        return None
    stages = []
    for index, item in enumerate(value):
        item_path = '{}[{}]'.format(path, index)
        if not isinstance(item, dict):
            _invalid(errors, item_path, 'Each stage must be an object.')
            continue
        unknown = set(item) - set(_PLAN_STAGE_KEYS)
        missing = set(_PLAN_STAGE_KEYS) - set(item)
        for key in sorted(unknown):
            _invalid(errors, '{}.{}'.format(item_path, key),
                     'This field is not supported.')
        for key in sorted(missing):
            _invalid(errors, '{}.{}'.format(item_path, key),
                     'This field is required.')
        if unknown or missing:
            continue
        stage_errors = {}
        start = _parse_date(item['start_date'],
                            '{}.start_date'.format(item_path), stage_errors)
        end = _parse_date(item['end_date'],
                          '{}.end_date'.format(item_path), stage_errors)
        target = _parse_int(item['target_pouches'], 0, 1000,
                            '{}.target_pouches'.format(item_path),
                            stage_errors)
        ceiling = _parse_bounded_decimal(
            item['nicotine_ceiling_mg'],
            '{}.nicotine_ceiling_mg'.format(item_path), stage_errors,
            maximum=_PLAN_MG_MAX, allow_zero=True)
        if stage_errors:
            errors.update(stage_errors)
            continue
        stages.append(StageTarget(
            start_date=date.fromisoformat(start),
            end_date=date.fromisoformat(end),
            target_pouches=target,
            nicotine_ceiling_mg=ceiling,
        ))
    for index, stage in enumerate(stages[:-1]):
        if stage.end_date == date.max:
            _invalid(
                errors,
                '{}[{}].end_date'.format(path, index),
                'The generated schedule exceeds the date range.',
            )
    return tuple(stages) if len(stages) == len(value) else None


def _parse_plan_payload(body, *, include_create):
    errors = {}
    if not isinstance(body, dict):
        raise ApiValidationError({'body': ['Send a JSON object.']})
    allowed = set(_PLAN_KEYS)
    if include_create:
        allowed.update({'preview_digest', 'activation'})
    for key in sorted(set(body) - allowed):
        _invalid(errors, key, 'This field is not supported.')
    required_keys = _PLAN_REQUIRED_KEYS | (
        {'preview_digest', 'activation'} if include_create else set()
    )
    for key in sorted(required_keys):
        if key not in body:
            _invalid(errors, key, 'This field is required.')

    def value(key):
        return body.get(key)

    mode = _parse_enum(value('mode'), _PLAN_MODES, 'mode', errors)
    target_basis = _parse_enum(
        value('target_basis'),
        ('nicotine_mg', 'legacy_pouches', 'observe'),
        'target_basis',
        errors,
    )
    source = _parse_enum(value('baseline_source'), _PLAN_BASELINE_SOURCES,
                         'baseline_source', errors)
    start_raw = value('start_date')
    start = _parse_date(start_raw, 'start_date', errors)
    target_raw = value('target_date')
    target = None if target_raw is None else _parse_date(
        target_raw, 'target_date', errors)
    duration_raw = value('duration_days')
    duration = None if duration_raw is None else _parse_int(
        duration_raw, 1, 365, 'duration_days', errors)
    end_raw = value('end_target_pouches')
    end_target = None if end_raw is None else _parse_int(
        end_raw, 0, 1000, 'end_target_pouches', errors)
    end_mg_raw = value('end_target_mg')
    end_target_mg = (
        None if end_mg_raw is None else _parse_bounded_decimal(
            end_mg_raw,
            'end_target_mg',
            errors,
            maximum=_PLAN_MG_MAX,
            allow_zero=True,
        )
    )
    baseline_pouches = (
        None if value('baseline_pouches') is None else _parse_bounded_decimal(
            value('baseline_pouches'), 'baseline_pouches', errors,
            maximum=_PLAN_POUCH_MAX)
    )
    baseline_mg = (
        None if value('baseline_mg') is None else _parse_bounded_decimal(
            value('baseline_mg'), 'baseline_mg', errors,
            maximum=_PLAN_MG_MAX)
    )
    baseline_strength = (
        None if value('baseline_mg_per_pouch') is None else _parse_bounded_decimal(
            value('baseline_mg_per_pouch'), 'baseline_mg_per_pouch', errors,
            maximum=_PLAN_MG_MAX)
    )
    pace = (
        None if value('pace') is None else _parse_enum(
            value('pace'), _PLAN_PACES, 'pace', errors)
    )
    stages = _parse_plan_stage_targets(value('stage_targets'),
                                       'stage_targets', errors)

    if mode in {'reduce', 'quit_by_date'}:
        for key, parsed in (('baseline_mg', baseline_mg), ('pace', pace)):
            if parsed is None and key not in errors:
                _invalid(errors, key, 'This field is required for targeted plans.')
        if target_basis == 'nicotine_mg':
            if 'end_target_mg' not in body or end_target_mg is None:
                if 'end_target_mg' not in errors:
                    _invalid(
                        errors,
                        'end_target_mg',
                        'This field is required for nicotine-first plans.',
                    )
            if 'end_target_pouches' in body:
                _invalid(
                    errors,
                    'end_target_pouches',
                    'Use end_target_mg for nicotine-first plans.',
                )
            if stages is not None:
                _invalid(
                    errors,
                    'stage_targets',
                    'Nicotine-first schedules are generated from the mg target.',
                )
        elif target_basis == 'legacy_pouches':
            for key, parsed in (
                ('baseline_pouches', baseline_pouches),
                ('baseline_mg_per_pouch', baseline_strength),
                ('end_target_pouches', end_target),
            ):
                if parsed is None and key not in errors:
                    _invalid(
                        errors, key,
                        'This field is required for legacy pouch compatibility.',
                    )
            if 'end_target_mg' in body:
                _invalid(
                    errors,
                    'end_target_mg',
                    'Legacy pouch compatibility uses end_target_pouches.',
                )
        elif target_basis is not None:
            _invalid(
                errors,
                'target_basis',
                'Targeted plans use nicotine_mg or legacy_pouches.',
            )
        if mode == 'quit_by_date':
            if target is None and 'target_date' not in errors:
                _invalid(errors, 'target_date',
                         'This field is required for quit-by-date plans.')
            if target_basis == 'nicotine_mg' and end_target_mg not in (
                None, Decimal('0.00')
            ):
                _invalid(errors, 'end_target_mg',
                         'Quit-by-date plans must end at 0.00 mg.')
            if target_basis == 'legacy_pouches' and end_target not in (None, 0):
                _invalid(errors, 'end_target_pouches',
                         'Quit-by-date plans must end at zero pouches.')
        if mode == 'reduce' and start is not None and stages is None:
            effective_duration = duration
            if effective_duration is None and pace in _PLAN_DEFAULT_DURATIONS:
                effective_duration = _PLAN_DEFAULT_DURATIONS[pace]
            _guard_schedule_date_range(
                date.fromisoformat(start), effective_duration,
                'start_date', errors,
            )
        if (
            baseline_pouches is not None
            and baseline_strength is not None
        ):
            start_target = int(
                baseline_pouches.to_integral_value(rounding=ROUND_CEILING)
            )
            generated_ceiling = (
                baseline_strength * start_target
            ).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
            if generated_ceiling > _PLAN_MG_MAX:
                _invalid(
                    errors,
                    'baseline_mg_per_pouch',
                    'The generated nicotine ceiling exceeds the supported range.',
                )
    elif mode == 'observe':
        if target_basis is not None and target_basis != 'observe':
            _invalid(errors, 'target_basis',
                     'Observe plans must use the observe target basis.')
        for key, parsed in (
            ('baseline_pouches', baseline_pouches),
            ('baseline_mg', baseline_mg),
            ('baseline_mg_per_pouch', baseline_strength),
            ('pace', pace),
            ('end_target_pouches', end_target),
            ('end_target_mg', end_target_mg),
        ):
            if parsed is not None:
                _invalid(errors, key, 'Observe plans do not use this field.')
        if source is not None and source != 'observe':
            _invalid(errors, 'baseline_source',
                     'Observe plans must use the observe baseline source.')
        if stages is not None:
            _invalid(errors, 'stage_targets',
                     'Observe plans do not use stage targets.')
        if duration is not None and duration != 7:
            _invalid(errors, 'duration_days',
                     'Observe plans always last seven days.')
        if start is not None:
            observe_start = date.fromisoformat(start)
            _guard_schedule_date_range(
                observe_start, 7, 'start_date', errors
            )
            if target is not None and 'start_date' not in errors:
                expected = observe_start + timedelta(days=6)
                if date.fromisoformat(target) != expected:
                    _invalid(
                        errors,
                        'target_date',
                        'Observe plans always end seven days after start.',
                    )

    preview_digest = None
    activation = None
    if include_create:
        digest = value('preview_digest')
        if (not isinstance(digest, str)
                or re.fullmatch(r'[0-9a-f]{64}', digest) is None):
            _invalid(errors, 'preview_digest',
                     'Enter the 64-character lowercase preview digest.')
        else:
            preview_digest = digest
        activation = _parse_enum(value('activation'), ('draft', 'activate'),
                                 'activation', errors)

    if errors:
        raise ApiValidationError(errors)
    generation_input = PlanGenerationInput(
        mode=mode,
        target_basis=target_basis,
        start_date=date.fromisoformat(start),
        baseline_pouches=baseline_pouches,
        baseline_mg=baseline_mg,
        baseline_mg_per_pouch=baseline_strength,
        pace=pace,
        end_target_pouches=end_target,
        end_target_mg=end_target_mg,
        target_date=None if target is None else date.fromisoformat(target),
        duration_days=duration,
        stage_targets=stages,
    )
    if include_create:
        return generation_input, source, preview_digest, activation
    return generation_input, source


def parse_plan_preview_payload(body):
    return _parse_plan_payload(body, include_create=False)


def parse_plan_create_payload(body):
    return _parse_plan_payload(body, include_create=True)


_REVISION_CHANGE_KEYS = {
    'pace', 'target_date', 'duration_days', 'target_basis',
    'end_target_pouches', 'end_target_mg',
    'stage_targets',
}
_NICOTINE_REVISION_CHANGE_KEYS = {
    'pace', 'target_date', 'duration_days', 'target_basis', 'end_target_mg',
}
_LEGACY_REVISION_CHANGE_KEYS = {
    'pace', 'target_date', 'duration_days', 'target_basis',
    'end_target_pouches', 'stage_targets',
}


def _parse_revision_changes(value, path, errors):
    if not isinstance(value, dict):
        _invalid(errors, path, 'Send a JSON object.')
        return None
    if not value:
        _invalid(errors, path, 'Choose at least one change.')
        return None
    if 'target_basis' not in value:
        _invalid(
            errors,
            '{}.target_basis'.format(path),
            'This field is required for every revision.',
        )
    changes = {}
    for key in sorted(set(value) - _REVISION_CHANGE_KEYS):
        _invalid(errors, '{}.{}'.format(path, key),
                 'This field is not supported.')
    for key, raw in value.items():
        field_path = '{}.{}'.format(path, key)
        if key not in _REVISION_CHANGE_KEYS:
            continue
        if key == 'pace':
            parsed = _parse_enum(raw, _PLAN_PACES, field_path, errors)
        elif key == 'target_date':
            parsed = _parse_date(raw, field_path, errors)
        elif key == 'duration_days':
            parsed = _parse_int(raw, 1, 365, field_path, errors)
        elif key == 'end_target_pouches':
            parsed = _parse_int(raw, 0, 1000, field_path, errors)
        elif key == 'end_target_mg':
            parsed = _parse_bounded_decimal(
                raw, field_path, errors,
                maximum=_PLAN_MG_MAX, allow_zero=True,
            )
        elif key == 'target_basis':
            parsed = _parse_enum(
                raw, ('nicotine_mg', 'legacy_pouches'), field_path, errors
            )
        else:
            parsed = _parse_plan_stage_targets(raw, field_path, errors)
        if parsed is not None:
            if key == 'target_date':
                parsed = date.fromisoformat(parsed)
            changes[key] = parsed
    target_basis = changes.get('target_basis')
    allowed_for_basis = (
        _NICOTINE_REVISION_CHANGE_KEYS
        if target_basis == 'nicotine_mg'
        else _LEGACY_REVISION_CHANGE_KEYS
        if target_basis == 'legacy_pouches'
        else _REVISION_CHANGE_KEYS
    )
    for key in sorted(set(value) & (_REVISION_CHANGE_KEYS - allowed_for_basis)):
        _invalid(
            errors,
            '{}.{}'.format(path, key),
            'This field is not supported for {} revisions.'.format(
                target_basis
            ),
        )
    return changes


def _parse_revision_outer(body, *, include_apply):
    errors = {}
    if not isinstance(body, dict):
        raise ApiValidationError({'body': ['Send a JSON object.']})
    required = {'effective_date', 'changes'}
    if include_apply:
        required.update({'preview_digest', 'reason', 'note'})
    allowed = required
    for key in sorted(set(body) - allowed):
        _invalid(errors, key, 'This field is not supported.')
    for key in sorted(required):
        if key not in body:
            _invalid(errors, key, 'This field is required.')
    effective_raw = body.get('effective_date')
    effective = _parse_date(effective_raw, 'effective_date', errors)
    changes = _parse_revision_changes(body.get('changes'), 'changes', errors)
    digest = None
    reason = None
    note = None
    if include_apply:
        raw_digest = body.get('preview_digest')
        if (not isinstance(raw_digest, str)
                or re.fullmatch(r'[0-9a-f]{64}', raw_digest) is None):
            _invalid(errors, 'preview_digest',
                     'Enter the 64-character lowercase preview digest.')
        else:
            digest = raw_digest
        reason = _parse_enum(
            body.get('reason'),
            ('user_edit', 'difficulty_adjustment', 'other'),
            'reason', errors,
        )
        raw_note = body.get('note')
        if raw_note is not None and not isinstance(raw_note, str):
            _invalid(errors, 'note', 'Enter a note as text or null.')
        elif isinstance(raw_note, str):
            note = raw_note.strip() or None
            if len(raw_note.strip()) > 2000:
                _invalid(errors, 'note', 'Use 2,000 characters or fewer.')
    if errors:
        raise ApiValidationError(errors)
    parsed_effective = date.fromisoformat(effective)
    if include_apply:
        return parsed_effective, changes, digest, reason, note
    return parsed_effective, changes


def parse_revision_preview_payload(body):
    return _parse_revision_outer(body, include_apply=False)


def parse_revision_apply_payload(body):
    return _parse_revision_outer(body, include_apply=True)


def parse_pause_payload(body):
    if body is None:
        return None
    errors = {}
    if not isinstance(body, dict):
        raise ApiValidationError({'body': ['Send a JSON object.']})
    for key in sorted(set(body) - {'reason'}):
        _invalid(errors, key, 'This field is not supported.')
    reason = body.get('reason')
    if reason is not None and not isinstance(reason, str):
        _invalid(errors, 'reason', 'Enter a reason as text or null.')
        reason = None
    elif isinstance(reason, str):
        reason = reason.strip() or None
        if len(reason or '') > 255:
            _invalid(errors, 'reason', 'Use 255 characters or fewer.')
    if errors:
        raise ApiValidationError(errors)
    return reason


def parse_resume_preview_payload(body):
    errors = {}
    if not isinstance(body, dict):
        raise ApiValidationError({'body': ['Send a JSON object.']})
    if set(body) != {'resume_date'}:
        for key in sorted(set(body) - {'resume_date'}):
            _invalid(errors, key, 'This field is not supported.')
        if 'resume_date' not in body:
            _invalid(errors, 'resume_date', 'This field is required.')
    value = _parse_date(body.get('resume_date'), 'resume_date', errors)
    if errors:
        raise ApiValidationError(errors)
    return date.fromisoformat(value)


def parse_resume_apply_payload(body):
    errors = {}
    if not isinstance(body, dict):
        raise ApiValidationError({'body': ['Send a JSON object.']})
    required = {'resume_date', 'preview_digest'}
    for key in sorted(set(body) - required):
        _invalid(errors, key, 'This field is not supported.')
    for key in sorted(required - set(body)):
        _invalid(errors, key, 'This field is required.')
    resume_raw = _parse_date(body.get('resume_date'), 'resume_date', errors)
    digest = body.get('preview_digest')
    if (not isinstance(digest, str)
            or re.fullmatch(r'[0-9a-f]{64}', digest) is None):
        _invalid(errors, 'preview_digest',
                 'Enter the 64-character lowercase preview digest.')
        digest = None
    if errors:
        raise ApiValidationError(errors)
    return date.fromisoformat(resume_raw), digest
