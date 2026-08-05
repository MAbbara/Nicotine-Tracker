from flask import Blueprint, render_template, request, redirect, url_for, flash, current_app, jsonify, session, after_this_request
from datetime import datetime, time
from datetime import date
from dataclasses import dataclass
from typing import Any, Mapping
import pytz
from models import User, Log, Pouch
from services import add_log_entry, add_bulk_logs  # use service layer for log creation
from services.log_service import (
    CreateLogInput,
    LogService,
    LogValidationError,
    group_logs_by_effective_day,
    has_custom_product_input,
    parse_nicotine_strength,
    summarize_logs,
)
from services.api_errors import (
    ApiValidationError,
    error_response,
    internal_error_response,
    not_found_response,
    validation_error_response,
)
from services.serializers import _parse_client_event_id
from services.timezone_service import (
    get_current_user_time,
    get_user_day_window,
    resolve_timezone,
    to_naive_utc,
)
from services.pouch_service import get_sorted_pouches
from extensions import db
from routes.auth import login_required, get_current_user
from sqlalchemy import desc


import re

# Specify the template folder for logging-related templates
logging_bp = Blueprint('logging', __name__, template_folder='../templates/logging')

LOGBOOK_HISTORY_FRAGMENT_VERSION = 'logbook-history-v1'
_QUICK_ADD_KEYS = {'pouch_id', 'quantity', 'client_event_id', 'view'}
_QUICK_ADD_VIEW_KEYS = {'page', 'q', 'from_date', 'to_date'}


def _available_pouch_for_user(user_id, pouch_id):
    """Return a default or user-owned pouch without crossing tenant scope."""
    return Pouch.query.filter(
        Pouch.id == pouch_id,
        db.or_(Pouch.is_default, Pouch.created_by == user_id),
    ).first()


def _parse_quick_add_request(data):
    if not isinstance(data, dict) or set(data) != _QUICK_ADD_KEYS:
        raise ValueError('invalid request shape')
    pouch_id = data.get('pouch_id')
    quantity = data.get('quantity')
    if (
        isinstance(pouch_id, bool)
        or not isinstance(pouch_id, int)
        or pouch_id <= 0
        or isinstance(quantity, bool)
        or not isinstance(quantity, int)
        or not 1 <= quantity <= 100
    ):
        raise ValueError('invalid mutation values')
    view = data.get('view')
    if not isinstance(view, dict) or set(view) != _QUICK_ADD_VIEW_KEYS:
        raise ValueError('invalid view shape')
    page = view.get('page')
    query = view.get('q')
    from_date = view.get('from_date')
    to_date = view.get('to_date')
    if (
        isinstance(page, bool)
        or not isinstance(page, int)
        or page <= 0
        or not isinstance(query, str)
        or len(query) > 80
        or not isinstance(from_date, str)
        or not isinstance(to_date, str)
    ):
        raise ValueError('invalid view values')
    for value in (from_date, to_date):
        if not value:
            continue
        try:
            datetime.strptime(value, '%Y-%m-%d')
        except ValueError:
            raise ValueError('invalid view date') from None
    client_event_id = _parse_client_event_id(data.get('client_event_id'))
    if client_event_id is None:
        raise ApiValidationError({
            'client_event_id': ['Use a canonical hyphenated UUID.'],
        })
    return pouch_id, quantity, client_event_id, {
        'page': page,
        'q': query.strip(),
        'from_date': from_date,
        'to_date': to_date,
    }


def _is_legacy_quick_add_request(data):
    return (
        isinstance(data, dict)
        and 'pouch_id' in data
        and 'client_event_id' not in data
        and 'view' not in data
    )


def _legacy_quick_add_response(user, data):
    pouch_id = data.get('pouch_id')
    quantity = data.get('quantity', 1)
    if (
        isinstance(pouch_id, bool)
        or not isinstance(pouch_id, int)
        or pouch_id <= 0
        or isinstance(quantity, bool)
        or not isinstance(quantity, int)
        or not 1 <= quantity <= 100
    ):
        return jsonify({'success': False, 'error': 'Invalid data'})
    if has_custom_product_input(
        data.get('custom_brand'), data.get('custom_nicotine_mg')
    ):
        return jsonify({
            'success': False,
            'error': 'Cannot combine an existing pouch with custom product fields',
        })
    pouch = _available_pouch_for_user(user.id, pouch_id)
    if pouch is None:
        return jsonify({'success': False, 'error': 'Pouch not found'})
    instant = datetime.now(pytz.UTC)
    resolved_timezone = resolve_timezone(user.timezone)
    try:
        LogService.create_idempotent(user.id, CreateLogInput(
            client_event_id=None,
            pouch_id=pouch.id,
            custom_product=None,
            quantity=quantity,
            occurred_at_utc=instant,
            occurred_at_local=instant.astimezone(resolved_timezone),
            timezone=resolved_timezone.zone,
            notes=None,
            craving_id=None,
        ))
    except Exception:
        db.session.rollback()
        current_app.logger.exception('Deprecated quick add failed before commit')
        return jsonify({'success': False, 'error': 'Server error'})
    return jsonify({
        'success': True,
        'message': 'Log saved.',
    })


@dataclass(frozen=True)
class LogbookHistoryContext:
    logs: Any
    grouped_logs: dict
    daily_totals: dict
    filters: dict
    user_timezone: str

    def as_template_context(self):
        return {
            'logs': self.logs,
            'grouped_logs': self.grouped_logs,
            'daily_totals': self.daily_totals,
            'filters': self.filters,
            'user_timezone': self.user_timezone,
            'fragment_version': LOGBOOK_HISTORY_FRAGMENT_VERSION,
        }


def build_logbook_history_context(user, raw_filters: Mapping) -> LogbookHistoryContext:
    """Build the one authoritative filtered and paginated Logbook history."""
    raw_page = raw_filters.get('page', 1)
    try:
        page = max(1, int(raw_page))
    except (TypeError, ValueError):
        page = 1
    per_page = current_app.config.get('LOGS_PER_PAGE', 20)
    search_query = str(raw_filters.get('q', '') or '').strip()[:80]
    from_date_value = str(raw_filters.get('from_date', '') or '').strip()
    to_date_value = str(raw_filters.get('to_date', '') or '').strip()

    resolved_timezone = resolve_timezone(user.timezone)
    preferences = user.preferences
    reset_time = (
        preferences.daily_reset_time
        if preferences and preferences.daily_reset_time
        else time.min
    )
    query = Log.query.filter_by(user_id=user.id)
    if search_query:
        pattern = f'%{search_query}%'
        query = query.filter(db.or_(
            Log.notes.ilike(pattern),
            Log.product_brand_snapshot.ilike(pattern),
            Log.custom_brand.ilike(pattern),
            Log.pouch.has(Pouch.brand.ilike(pattern)),
        ))

    def local_boundary(value, *, end=False):
        if not value:
            return None
        try:
            local_date = datetime.strptime(value, '%Y-%m-%d').date()
        except ValueError:
            return None
        window = get_user_day_window(
            resolved_timezone.zone, local_date, reset_time
        )
        boundary = window.end_utc if end else window.start_utc
        return to_naive_utc(boundary)

    from_boundary = local_boundary(from_date_value)
    to_boundary = local_boundary(to_date_value, end=True)
    if from_date_value and from_boundary is None:
        flash('The starting date filter was ignored because it is invalid.', 'error')
        from_date_value = ''
    if to_date_value and to_boundary is None:
        flash('The ending date filter was ignored because it is invalid.', 'error')
        to_date_value = ''
    if from_boundary is not None:
        query = query.filter(Log.log_time >= from_boundary)
    if to_boundary is not None:
        query = query.filter(Log.log_time < to_boundary)

    logs = query.order_by(
        desc(Log.log_time), desc(Log.created_at), desc(Log.id)
    ).paginate(page=page, per_page=per_page, error_out=False)
    grouped_logs = group_logs_by_effective_day(
        logs.items, resolved_timezone, reset_time
    )
    displayed_windows = [
        get_user_day_window(resolved_timezone.zone, date_key, reset_time)
        for date_key in grouped_logs
    ]
    complete_grouped_logs = {}
    if displayed_windows:
        displayed_day_predicates = [
            db.and_(
                Log.log_time >= to_naive_utc(window.start_utc),
                Log.log_time < to_naive_utc(window.end_utc),
            )
            for window in displayed_windows
        ]
        complete_day_rows = query.filter(
            db.or_(*displayed_day_predicates)
        ).all()
        complete_grouped_logs = group_logs_by_effective_day(
            complete_day_rows, resolved_timezone, reset_time
        )
    daily_totals = {}
    for date_key in grouped_logs:
        summary = summarize_logs(complete_grouped_logs.get(date_key, []))
        daily_totals[date_key] = {
            'pouches': summary['total_pouches'],
            'mg': summary['total_mg'],
            'unknown_strength_count': summary['unknown_strength_count'],
        }
    return LogbookHistoryContext(
        logs=logs,
        grouped_logs=grouped_logs,
        daily_totals=daily_totals,
        filters={
            'q': search_query,
            'from_date': from_date_value,
            'to_date': to_date_value,
        },
        user_timezone=user.timezone,
    )

@logging_bp.route('/add', methods=['GET', 'POST'])
@login_required
def add_log():
    """Add a single log entry"""
    try:
        user = get_current_user()
        if not user:
            current_app.logger.error('Add log error: No current user found')
            return redirect(url_for('auth.login'))
        
        if request.method == 'POST':

            current_app.logger.debug(f"Form data: {request.form.to_dict()}")
            current_app.logger.debug(f"User timezone: {user.timezone}")
            current_app.logger.debug(f"Session timezone: {session.get('user_timezone')}")
            # Get form data
            log_date_str = request.form.get('log_date', date.today().isoformat())
            log_time_str = request.form.get('log_time', '')
            pouch_id = request.form.get('pouch_id')
            custom_brand = request.form.get('custom_brand', '').strip()
            custom_nicotine_mg = request.form.get('custom_nicotine_mg')
            quantity = request.form.get('quantity', 1, type=int)
            notes = request.form.get('notes', '').strip()
            
            # Validation
            if quantity <= 0:
                flash('Quantity must be greater than 0.', 'error')
                return redirect(url_for('logging.view_logs', open_add_modal=1))
            
            # Get timezone info from frontend (if available)
            frontend_timezone = request.form.get('user_timezone')
            
            # Always use server-side timezone conversion for consistency
            try:
                log_date = datetime.strptime(log_date_str, '%Y-%m-%d').date()
            except ValueError:
                flash('Invalid date format.', 'error')
                return redirect(url_for('logging.view_logs', open_add_modal=1))
            
            # Parse time (optional, in user's timezone)
            log_time = None
            if log_time_str:
                try:
                    log_time = datetime.strptime(log_time_str, '%H:%M').time()
                except ValueError:
                    flash('Invalid time format. Use HH:MM format.', 'error')
                    return redirect(url_for('logging.view_logs', open_add_modal=1))
            
            # Use the frontend timezone if provided, otherwise fall back to user's configured timezone
            effective_timezone = frontend_timezone if frontend_timezone else user.timezone
            
            current_app.logger.debug(f"Using timezone: {effective_timezone} (frontend: {frontend_timezone}, user: {user.timezone})")
            
            # Use service layer to create log entry
            try:
                # Validate and process pouch selection
                if pouch_id and pouch_id != 'custom':
                    if has_custom_product_input(custom_brand, custom_nicotine_mg):
                        flash(
                            'Cannot combine a selected pouch with custom product fields.',
                            'error',
                        )
                        return redirect(
                            url_for('logging.view_logs', open_add_modal=1)
                        )
                    pouch = _available_pouch_for_user(user.id, pouch_id)
                    if not pouch:
                        flash('Selected pouch not found.', 'error')

                        return redirect(url_for('logging.view_logs', open_add_modal=1))
                    # Always use server-side timezone conversion
                    add_log_entry(
                        user_id=user.id,
                        log_date=log_date,
                        log_time=log_time,
                        quantity=quantity,
                        notes=notes,
                        pouch_id=pouch.id,
                        user_timezone=effective_timezone
                    )
                elif custom_brand and custom_nicotine_mg:
                    try:
                        add_log_entry(
                            user_id=user.id,
                            log_date=log_date,
                            log_time=log_time,
                            quantity=quantity,
                            notes=notes,
                            custom_brand=custom_brand,
                            custom_nicotine_mg=custom_nicotine_mg,
                            user_timezone=effective_timezone
                        )
                    except ValueError:
                        flash('Invalid nicotine content. Enter a positive number with up to two decimals.', 'error')
                        return redirect(url_for('logging.view_logs', open_add_modal=1))
                else:
                    flash('Please select a pouch or enter custom details.', 'error')
                    return redirect(url_for('logging.view_logs', open_add_modal=1))

                current_app.logger.info(f'Log entry added for user {user.email}: {quantity} pouches')
                flash('Log entry added successfully!', 'success')
                return redirect(url_for('logging.view_logs'))
            except Exception as e:
                current_app.logger.error(f'Add log error: {e}')
                flash('An error occurred while adding the log entry.', 'error')
                return redirect(url_for('logging.view_logs', open_add_modal=1))
        
        # GET request - redirect to unified log view with modal open
        return redirect(url_for('logging.view_logs', open_add_modal=1))

        
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f'Add log error: {e}')
        flash('An error occurred while adding the log entry.', 'error')
        return redirect(url_for('logging.view_logs', open_add_modal=1))

@logging_bp.route('/bulk', methods=['GET', 'POST'])
@login_required
def bulk_add():
    """Add multiple log entries at once"""
    try:
        user = get_current_user()
        _, account_today, _ = get_current_user_time(user.timezone)

        if request.method == 'POST':
            bulk_text = request.form.get('bulk_text', '').strip()
            log_date_str = request.form.get('log_date', '').strip()

            if not bulk_text:
                flash('Please enter bulk log data.', 'error')
                return render_template('bulk_add.html', today=account_today)

            if log_date_str:
                try:
                    log_date = datetime.strptime(
                        log_date_str, '%Y-%m-%d'
                    ).date()
                except ValueError:
                    flash('Invalid date format.', 'error')
                    return render_template('bulk_add.html', today=account_today)
            else:
                log_date = account_today

            entries = parse_bulk_text(bulk_text)
            if not entries:
                flash('No valid entries found in bulk text.', 'error')
                return render_template('bulk_add.html', today=account_today)

            try:
                added_count = add_bulk_logs(
                    user_id=user.id,
                    entries=entries,
                    log_date=log_date,
                    user_timezone=user.timezone,
                )
                if added_count > 0:
                    current_app.logger.info(
                        'Bulk log entries added for user %s: %s entries',
                        user.email,
                        added_count,
                    )
                    flash(
                        f'Successfully added {added_count} log entries!',
                        'success',
                    )
                else:
                    flash('No entries could be processed.', 'error')
                return redirect(url_for('logging.view_logs'))
            except Exception as e:
                current_app.logger.error(f'Bulk add error: {e}')
                flash('An error occurred during bulk entry.', 'error')
                return render_template('bulk_add.html', today=account_today)

        return render_template('bulk_add.html', today=account_today)

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f'Bulk add error: {e}')
        flash('An error occurred during bulk entry.', 'error')
        return render_template('bulk_add.html', today=date.today())

def parse_bulk_text(text):
    """Parse bulk text input into log entries"""
    entries = []
    lines = text.strip().split('\n')
    
    for line in lines:
        line = line.strip()
        if not line:
            continue
        
        try:
            # Pattern: "5 pouches at 09:00" or "3 ZYN 6mg at 14:30"
            # More flexible patterns
            patterns = [
                r'(\d+)\s+pouches?\s+at\s+(\d{1,2}):(\d{2})',
                r'(\d+)\s+([^0-9]+?)\s+(\d+(?:\.\d+)?)mg\s+at\s+(\d{1,2}):(\d{2})',
                r'(\d+)\s+([^0-9]+?)\s+at\s+(\d{1,2}):(\d{2})',
                r'(\d+)\s+pouches?',
                r'(\d+)\s+([^0-9]+?)\s+(\d+(?:\.\d+)?)mg',
            ]
            
            entry = None
            
            for pattern in patterns:
                match = re.search(pattern, line, re.IGNORECASE)
                if match:
                    groups = match.groups()
                    
                    if len(groups) == 3 and ':' in line:  # quantity pouches at time
                        quantity, hour, minute = groups
                        entry = {
                            'quantity': int(quantity),
                            'time': time(int(hour), int(minute))
                        }
                    elif len(groups) == 5:  # quantity brand mg at time
                        quantity, brand, nicotine_mg, hour, minute = groups
                        entry = {
                            'quantity': int(quantity),
                            'brand': brand.strip(),
                            'nicotine_mg': parse_nicotine_strength(nicotine_mg),
                            'time': time(int(hour), int(minute))
                        }
                    elif len(groups) == 4:  # quantity brand at time
                        quantity, brand, hour, minute = groups
                        entry = {
                            'quantity': int(quantity),
                            'brand': brand.strip(),
                            'time': time(int(hour), int(minute))
                        }
                    elif len(groups) == 1:  # just quantity
                        quantity = groups[0]
                        entry = {
                            'quantity': int(quantity)
                        }
                    elif len(groups) == 3 and 'mg' in line:  # quantity brand mg
                        quantity, brand, nicotine_mg = groups
                        entry = {
                            'quantity': int(quantity),
                            'brand': brand.strip(),
                            'nicotine_mg': parse_nicotine_strength(nicotine_mg)
                        }
                    
                    break
            
            if entry:
                entries.append(entry)
                
        except (ValueError, IndexError):
            # Skip invalid lines
            continue
    
    return entries

@logging_bp.route('/view')
@login_required
def view_logs():
    """View log history"""
    try:
        user = get_current_user()
        open_add_modal = request.args.get('open_add_modal') == '1'
        default_pouches, user_pouches = get_sorted_pouches(user)
        quick_add_pouches = (default_pouches + user_pouches)[:6]
        resolved_timezone = resolve_timezone(user.timezone)
        local_now = datetime.now(pytz.UTC).astimezone(resolved_timezone)
        today = local_now.date().isoformat()
        current_time = local_now.time().strftime('%H:%M')
        history = build_logbook_history_context(user, request.args)
        if request.args.get('fragment') == 'history':
            return render_template(
                'logging/_history.html',
                **history.as_template_context(),
            )
        return render_template('view_logs.html',
                             **history.as_template_context(),
                             default_pouches=default_pouches,
                             user_pouches=user_pouches,
                             quick_add_pouches=quick_add_pouches,
                             today=today,
                             current_time=current_time,
                             open_add_modal=open_add_modal,
                             user=user)
        
    except Exception as e:
        current_app.logger.error(f'View logs error: {e}')
        flash('An error occurred while loading logs.', 'error')
        return render_template(
            'view_logs.html',
            logs=None,
            grouped_logs={},
            daily_totals={},
            filters={'q': '', 'from_date': '', 'to_date': ''},
            user_timezone=None,
            default_pouches=[],
            user_pouches=[],
            quick_add_pouches=[],
            today=date.today().isoformat(),
            current_time=datetime.now().time().strftime('%H:%M'),
            open_add_modal=False,
            user=None
        )

@logging_bp.route('/edit/<int:log_id>', methods=['GET', 'POST'])
@login_required
def edit_log(log_id):
    """Edit a log entry"""
    try:
        user = get_current_user()
        log_entry = Log.query.filter_by(id=log_id, user_id=user.id).first()
        
        if not log_entry:
            flash('Log entry not found.', 'error')
            return redirect(url_for('logging.view_logs'))
        
        if request.method == 'POST':
            # Update log entry
            log_date_str = request.form.get('log_date')
            log_time_str = request.form.get('log_time', '')
            quantity = request.form.get('quantity', 1, type=int)
            notes = request.form.get('notes', '').strip()
            
            # Validation
            if quantity <= 0:
                flash('Quantity must be greater than 0.', 'error')
                return render_template('edit_log.html', log=log_entry, user_timezone=user.timezone)
            
            # Parse date (in user's timezone)
            try:
                user_date = datetime.strptime(log_date_str, '%Y-%m-%d').date()
            except ValueError:
                flash('Invalid date format.', 'error')
                return render_template('edit_log.html', log=log_entry, user_timezone=user.timezone)
            
            # Parse time (optional, in user's timezone)
            user_time = None
            if log_time_str:
                try:
                    user_time = datetime.strptime(log_time_str, '%H:%M').time()
                except ValueError:
                    flash('Invalid time format. Use HH:MM format.', 'error')
                    return render_template('edit_log.html', log=log_entry, user_timezone=user.timezone)
            
            # Keep the original instant when the rendered minute was not
            # changed; otherwise a notes-only edit would discard seconds.
            from services.timezone_service import convert_user_time_to_utc
            if user_time is not None:
                existing_local = log_entry.get_user_datetime(user.timezone)
                same_rendered_minute = (
                    existing_local.date() == user_date
                    and existing_local.hour == user_time.hour
                    and existing_local.minute == user_time.minute
                )
                if same_rendered_minute:
                    utc_datetime = log_entry.log_time
                else:
                    utc_datetime, _, _ = convert_user_time_to_utc(
                        user.timezone, user_date, user_time
                    )
            else:
                # Use current time if no time specified
                _, current_date, current_time = get_current_user_time(user.timezone)
                utc_datetime, _, _ = convert_user_time_to_utc(user.timezone, user_date, current_time)
            
            log_entry.log_date = utc_datetime.date()  # Keep for backward compatibility
            log_entry.log_time = utc_datetime  # Store complete UTC datetime
            
            log_entry.quantity = quantity
            log_entry.notes = notes
            
            db.session.commit()
            
            current_app.logger.info(f'Log entry updated for user {user.email}: log_id {log_id}')
            flash('Log entry updated successfully!', 'success')
            return redirect(url_for('logging.view_logs'))
        
        return render_template('edit_log.html', log=log_entry, user_timezone=user.timezone)
        
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f'Edit log error: {e}')
        flash('An error occurred while editing the log entry.', 'error')
        return redirect(url_for('logging.view_logs'))

@logging_bp.route('/delete/<int:log_id>', methods=['POST'])
@login_required
def delete_log(log_id):
    """Delete a log entry"""
    try:
        user = get_current_user()
        log_entry = Log.query.filter_by(id=log_id, user_id=user.id).first()
        
        if not log_entry:
            flash('Log entry not found.', 'error')
            return redirect(url_for('logging.view_logs'))
        
        db.session.delete(log_entry)
        db.session.commit()
        
        current_app.logger.info(f'Log entry deleted for user {user.email}: log_id {log_id}')
        flash('Log entry deleted successfully!', 'success')
        
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f'Delete log error: {e}')
        flash('An error occurred while deleting the log entry.', 'error')
    
    return redirect(url_for('logging.view_logs'))

@logging_bp.route('/api/quick_add', methods=['POST'])
@login_required
def quick_add_api():
    """Create one idempotent usual-product log and rebuild server history."""
    @after_this_request
    def advertise_canonical_successor(response):
        response.headers['Deprecation'] = 'true'
        response.headers['Link'] = '</api/logs>; rel="successor-version"'
        return response

    data = request.get_json(silent=True)
    user = get_current_user()
    if _is_legacy_quick_add_request(data):
        return _legacy_quick_add_response(user, data)
    try:
        pouch_id, quantity, client_event_id, raw_view = (
            _parse_quick_add_request(data)
        )
    except ApiValidationError as exc:
        return validation_error_response(exc)
    except ValueError:
        return error_response(
            400,
            'invalid_request',
            'Send a valid usual-product log request.',
        )
    pouch = _available_pouch_for_user(user.id, pouch_id)
    if pouch is None:
        return not_found_response()
    instant = datetime.now(pytz.UTC)
    resolved_timezone = resolve_timezone(user.timezone)
    payload = CreateLogInput(
        client_event_id=client_event_id,
        pouch_id=pouch.id,
        custom_product=None,
        quantity=quantity,
        occurred_at_utc=instant,
        occurred_at_local=instant.astimezone(resolved_timezone),
        timezone=resolved_timezone.zone,
        notes=None,
        craving_id=None,
    )
    try:
        result = LogService.create_idempotent(user.id, payload)
    except LogValidationError as exc:
        return validation_error_response(ApiValidationError(exc.field_errors))
    except Exception:
        db.session.rollback()
        current_app.logger.exception('Logbook quick add failed before commit')
        return internal_error_response()

    try:
        history = build_logbook_history_context(user, raw_view)
        history_html = render_template(
            'logging/_history.html',
            **history.as_template_context(),
        )
    except Exception:
        db.session.rollback()
        current_app.logger.exception(
            'Logbook history refresh failed after quick add commit'
        )
        return jsonify({
            'success': True,
            'message': (
                'Log saved, but history could not refresh. '
                'Reload when convenient.'
            ),
            'new_log_id': result.log.id,
            'created': result.created,
            'history_html': None,
            'fragment_version': LOGBOOK_HISTORY_FRAGMENT_VERSION,
            'visible': False,
            'history_refresh_failed': True,
        }), 201 if result.created else 200
    visible = any(log.id == result.log.id for log in history.logs.items)
    message = (
        'Log saved.'
        if visible
        else 'Log saved. It is outside the current view.'
    )
    return jsonify({
        'success': True,
        'message': message,
        'new_log_id': result.log.id,
        'created': result.created,
        'history_html': history_html,
        'fragment_version': LOGBOOK_HISTORY_FRAGMENT_VERSION,
        'visible': visible,
    }), 201 if result.created else 200
