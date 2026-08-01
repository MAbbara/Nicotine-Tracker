"""Service contracts for ownership-scoped, idempotent nicotine logs."""

from datetime import datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy import event, text
from sqlalchemy.exc import IntegrityError

from extensions import db
from models import Craving, Log, Pouch, User
from services.log_service import (
    CravingLinkConflictError,
    CravingNotFoundError,
    CustomProductInput,
    CreateLogInput,
    LogNotFoundError,
    LogService,
    LogValidationError,
    assign_log_product,
)


def _selected_pouch_input(pouch_id, *, client_event_id):
    occurred_at = datetime(2026, 7, 30, 12, 0, tzinfo=timezone.utc)
    return CreateLogInput(
        client_event_id=client_event_id,
        pouch_id=pouch_id,
        custom_product=None,
        quantity=1,
        occurred_at_utc=occurred_at,
        occurred_at_local=occurred_at,
        timezone="UTC",
        notes=None,
        craving_id=None,
    )


def test_exact_client_event_replay_returns_original_without_duplicate(
    app, db_session, test_user, test_pouch
):
    payload = _selected_pouch_input(
        test_pouch.id,
        client_event_id="018f3f5c-68af-7e4d-bf5d-0123456789ab",
    )

    first = LogService.create_idempotent(test_user.id, payload)
    replay = LogService.create_idempotent(test_user.id, payload)

    assert first.created is True
    assert replay.created is False
    assert replay.log.id == first.log.id
    assert db_session.query(Log).filter_by(user_id=test_user.id).count() == 1


def test_null_client_event_ids_create_independent_rows(
    app, db_session, test_user, test_pouch
):
    payload = _selected_pouch_input(test_pouch.id, client_event_id=None)

    first = LogService.create_idempotent(test_user.id, payload)
    second = LogService.create_idempotent(test_user.id, payload)

    assert first.created is True
    assert second.created is True
    assert second.log.id != first.log.id
    assert db_session.query(Log).filter_by(user_id=test_user.id).count() == 2


def test_separate_users_may_reuse_the_same_client_event_id(
    app, db_session, test_user, test_pouch
):
    other_user = User(
        email="other-log-owner@example.com",
        email_verified=True,
        timezone="UTC",
    )
    other_user.set_password("password123")
    db_session.add(other_user)
    db_session.flush()
    other_pouch = Pouch(
        brand="Other owner pouch",
        nicotine_mg="8.00",
        is_default=False,
        created_by=other_user.id,
    )
    db_session.add(other_pouch)
    db_session.commit()
    event_id = "018f3f5c-68af-7e4d-bf5d-0123456789ab"

    first = LogService.create_idempotent(
        test_user.id,
        _selected_pouch_input(test_pouch.id, client_event_id=event_id),
    )
    second = LogService.create_idempotent(
        other_user.id,
        _selected_pouch_input(other_pouch.id, client_event_id=event_id),
    )

    assert first.created is True
    assert second.created is True
    assert first.log.user_id == test_user.id
    assert second.log.user_id == other_user.id
    assert first.log.id != second.log.id


def test_foreign_pouch_is_rejected_with_non_oracular_validation(
    app, db_session, test_user
):
    other_user = User(
        email="foreign-pouch-owner@example.com",
        email_verified=True,
        timezone="UTC",
    )
    other_user.set_password("password123")
    db_session.add(other_user)
    db_session.flush()
    foreign_pouch = Pouch(
        brand="Private product",
        nicotine_mg="12.00",
        is_default=False,
        created_by=other_user.id,
    )
    db_session.add(foreign_pouch)
    db_session.commit()

    with pytest.raises(LogValidationError) as error:
        LogService.create_idempotent(
            test_user.id,
            _selected_pouch_input(
                foreign_pouch.id,
                client_event_id="118f3f5c-68af-7e4d-bf5d-0123456789ab",
            ),
        )

    assert error.value.field_errors == {
        "pouch_id": ["Choose a pouch available to your account."]
    }
    assert db_session.query(Log).filter_by(user_id=test_user.id).count() == 0


def test_owned_used_nicotine_craving_is_linked_in_the_log_mutation(
    app, db_session, test_user, test_pouch
):
    craving = Craving(
        user_id=test_user.id,
        craving_time=datetime(2026, 7, 30, 11, 55),
        intensity=7,
        outcome="used_nicotine",
    )
    db_session.add(craving)
    db_session.commit()
    payload = _selected_pouch_input(
        test_pouch.id,
        client_event_id="218f3f5c-68af-7e4d-bf5d-0123456789ab",
    )
    payload = CreateLogInput(
        **{**payload.__dict__, "craving_id": craving.id}
    )

    result = LogService.create_idempotent(test_user.id, payload)

    db_session.refresh(craving)
    assert result.created is True
    assert craving.linked_log_id == result.log.id
    assert craving.outcome == "used_nicotine"


def test_foreign_and_missing_cravings_share_one_not_found_result(
    app, db_session, test_user, test_pouch
):
    other_user = User(
        email="foreign-craving-owner@example.com",
        email_verified=True,
        timezone="UTC",
    )
    other_user.set_password("password123")
    db_session.add(other_user)
    db_session.flush()
    foreign = Craving(
        user_id=other_user.id,
        craving_time=datetime(2026, 7, 30, 11, 55),
        intensity=6,
        outcome="used_nicotine",
    )
    db_session.add(foreign)
    db_session.commit()
    base = _selected_pouch_input(
        test_pouch.id,
        client_event_id="318f3f5c-68af-7e4d-bf5d-0123456789ab",
    )

    errors = []
    for craving_id in (foreign.id, foreign.id + 1000):
        payload = CreateLogInput(
            **{**base.__dict__, "craving_id": craving_id}
        )
        with pytest.raises(CravingNotFoundError) as error:
            LogService.create_idempotent(test_user.id, payload)
        errors.append(str(error.value))

    assert errors == ["That craving does not exist."] * 2
    assert db_session.query(Log).filter_by(user_id=test_user.id).count() == 0
    db_session.refresh(foreign)
    assert foreign.linked_log_id is None


def test_craving_must_already_have_used_nicotine_outcome(
    app, db_session, test_user, test_pouch
):
    craving = Craving(
        user_id=test_user.id,
        craving_time=datetime(2026, 7, 30, 11, 55),
        intensity=5,
        outcome="resisted",
    )
    db_session.add(craving)
    db_session.commit()
    base = _selected_pouch_input(
        test_pouch.id,
        client_event_id="418f3f5c-68af-7e4d-bf5d-0123456789ab",
    )
    payload = CreateLogInput(
        **{**base.__dict__, "craving_id": craving.id}
    )

    with pytest.raises(LogValidationError) as error:
        LogService.create_idempotent(test_user.id, payload)

    assert error.value.field_errors == {
        "craving_id": ["Choose a craving marked as nicotine used."]
    }
    assert db_session.query(Log).filter_by(user_id=test_user.id).count() == 0
    db_session.refresh(craving)
    assert craving.linked_log_id is None


def test_craving_linked_to_a_different_log_is_a_conflict(
    app, db_session, test_user, test_pouch
):
    prior = LogService.create_idempotent(
        test_user.id,
        _selected_pouch_input(
            test_pouch.id,
            client_event_id="518f3f5c-68af-7e4d-bf5d-0123456789ab",
        ),
    ).log
    craving = Craving(
        user_id=test_user.id,
        craving_time=datetime(2026, 7, 30, 11, 55),
        intensity=8,
        outcome="used_nicotine",
        linked_log_id=prior.id,
    )
    db_session.add(craving)
    db_session.commit()
    base = _selected_pouch_input(
        test_pouch.id,
        client_event_id="618f3f5c-68af-7e4d-bf5d-0123456789ab",
    )
    payload = CreateLogInput(
        **{**base.__dict__, "craving_id": craving.id}
    )

    with pytest.raises(CravingLinkConflictError):
        LogService.create_idempotent(test_user.id, payload)

    assert db_session.query(Log).filter_by(user_id=test_user.id).count() == 1
    db_session.refresh(craving)
    assert craving.linked_log_id == prior.id


def test_competing_craving_claim_rolls_back_the_losing_log(
    app, db_session, test_user, test_pouch, monkeypatch
):
    craving = Craving(
        user_id=test_user.id,
        craving_time=datetime(2026, 7, 30, 11, 55),
        intensity=8,
        outcome="used_nicotine",
    )
    db_session.add(craving)
    db_session.commit()
    original_execute = db.session.execute

    class LostClaim:
        rowcount = 0

    def lose_conditional_claim(statement, *args, **kwargs):
        if (
            getattr(statement, "is_update", False)
            and getattr(getattr(statement, "table", None), "name", None)
            == Craving.__tablename__
        ):
            return LostClaim()
        return original_execute(statement, *args, **kwargs)

    monkeypatch.setattr(db.session, "execute", lose_conditional_claim)
    payload = _selected_pouch_input(
        test_pouch.id,
        client_event_id="f18f3f5c-68af-7e4d-bf5d-0123456789ab",
    )
    payload = CreateLogInput(
        **{**payload.__dict__, "craving_id": craving.id}
    )

    with pytest.raises(CravingLinkConflictError):
        LogService.create_idempotent(test_user.id, payload)

    assert db_session.query(Log).filter_by(user_id=test_user.id).count() == 0
    db_session.expire_all()
    assert db_session.get(Craving, craving.id).linked_log_id is None


def test_unique_race_rolls_back_and_returns_the_scoped_winner(
    app, db_session, test_user, test_pouch, monkeypatch
):
    event_id = "718f3f5c-68af-7e4d-bf5d-0123456789ab"
    payload = _selected_pouch_input(
        test_pouch.id,
        client_event_id=event_id,
    )
    original_commit = db.session.commit
    original_rollback = db.session.rollback
    calls = {"commit": 0, "rollback": 0, "winner_id": None}

    def racing_commit():
        calls["commit"] += 1
        raise IntegrityError("INSERT INTO log", {}, Exception("duplicate"))

    def rollback_then_publish_winner():
        calls["rollback"] += 1
        original_rollback()
        winner = Log(
            user_id=test_user.id,
            client_event_id=event_id,
            log_date=datetime(2026, 7, 30).date(),
            log_time=datetime(2026, 7, 30, 12, 0),
            quantity=1,
        )
        assign_log_product(winner, pouch_id=test_pouch.id)
        db.session.add(winner)
        original_commit()
        calls["winner_id"] = winner.id

    monkeypatch.setattr(db.session, "commit", racing_commit)
    monkeypatch.setattr(db.session, "rollback", rollback_then_publish_winner)

    result = LogService.create_idempotent(test_user.id, payload)

    assert result.created is False
    assert result.log.id == calls["winner_id"]
    assert calls == {"commit": 1, "rollback": 1, "winner_id": result.log.id}
    assert db_session.query(Log).filter_by(
        user_id=test_user.id,
        client_event_id=event_id,
    ).count() == 1


def test_integrity_error_is_reraised_without_a_scoped_event_winner(
    app, db_session, test_user, test_pouch, monkeypatch
):
    event_id = "818f3f5c-68af-7e4d-bf5d-0123456789ab"
    other_user = User(
        email="integrity-other-owner@example.com",
        email_verified=True,
        timezone="UTC",
    )
    other_user.set_password("password123")
    db_session.add(other_user)
    db_session.flush()
    foreign_winner = Log(
        user_id=other_user.id,
        client_event_id=event_id,
        log_date=datetime(2026, 7, 30).date(),
        log_time=datetime(2026, 7, 30, 12, 0),
        quantity=1,
    )
    db_session.add(foreign_winner)
    db_session.commit()
    failure = IntegrityError(
        "INSERT INTO log", {}, Exception("unrelated integrity failure")
    )
    original_rollback = db.session.rollback
    calls = {"rollback": 0}

    def failing_commit():
        raise failure

    def counted_rollback():
        calls["rollback"] += 1
        original_rollback()

    monkeypatch.setattr(db.session, "commit", failing_commit)
    monkeypatch.setattr(db.session, "rollback", counted_rollback)

    with pytest.raises(IntegrityError) as caught:
        LogService.create_idempotent(
            test_user.id,
            _selected_pouch_input(test_pouch.id, client_event_id=event_id),
        )

    assert caught.value is failure
    assert calls == {"rollback": 1}
    assert db_session.query(Log).filter_by(user_id=test_user.id).count() == 0


def test_owned_and_global_pouches_snapshot_authoritative_product_values(
    app, db_session, test_user, test_pouch
):
    global_pouch = Pouch(
        brand="Global product",
        nicotine_mg="6.50",
        is_default=True,
        created_by=None,
    )
    db_session.add(global_pouch)
    db_session.commit()

    owned_result = LogService.create_idempotent(
        test_user.id,
        _selected_pouch_input(
            test_pouch.id,
            client_event_id="918f3f5c-68af-7e4d-bf5d-0123456789ab",
        ),
    )
    global_result = LogService.create_idempotent(
        test_user.id,
        _selected_pouch_input(
            global_pouch.id,
            client_event_id="a18f3f5c-68af-7e4d-bf5d-0123456789ab",
        ),
    )

    assert (
        owned_result.log.product_brand_snapshot,
        str(owned_result.log.nicotine_mg_snapshot),
    ) == ("Test Brand", "4.00")
    assert (
        global_result.log.product_brand_snapshot,
        str(global_result.log.nicotine_mg_snapshot),
    ) == ("Global product", "6.50")

    test_pouch.brand = "Changed owned product"
    test_pouch.nicotine_mg = "20.00"
    global_pouch.brand = "Changed global product"
    global_pouch.nicotine_mg = "30.00"
    db_session.commit()
    db_session.refresh(owned_result.log)
    db_session.refresh(global_result.log)

    assert (
        owned_result.log.product_brand_snapshot,
        str(owned_result.log.nicotine_mg_snapshot),
    ) == ("Test Brand", "4.00")
    assert (
        global_result.log.product_brand_snapshot,
        str(global_result.log.nicotine_mg_snapshot),
    ) == ("Global product", "6.50")


def test_delete_treats_foreign_and_missing_logs_as_not_found(
    app, db_session, test_user
):
    other_user = User(
        email="foreign-log-delete-owner@example.com",
        email_verified=True,
        timezone="UTC",
    )
    other_user.set_password("password123")
    db_session.add(other_user)
    db_session.flush()
    foreign_log = Log(
        user_id=other_user.id,
        log_date=datetime(2026, 7, 30).date(),
        log_time=datetime(2026, 7, 30, 12, 0),
        quantity=1,
    )
    db_session.add(foreign_log)
    db_session.commit()

    messages = []
    for log_id in (foreign_log.id, foreign_log.id + 1000):
        with pytest.raises(LogNotFoundError) as error:
            LogService.delete_owned(test_user.id, log_id)
        messages.append(str(error.value))

    assert messages == ["That log does not exist."] * 2
    assert db_session.get(Log, foreign_log.id) is not None


def test_delete_explicitly_clears_owned_craving_link_before_log_delete(
    app, db_session, test_user, test_pouch
):
    db_session.execute(text("PRAGMA foreign_keys=ON"))
    db_session.commit()
    log = LogService.create_idempotent(
        test_user.id,
        _selected_pouch_input(
            test_pouch.id,
            client_event_id="b18f3f5c-68af-7e4d-bf5d-0123456789ab",
        ),
    ).log
    craving = Craving(
        user_id=test_user.id,
        craving_time=datetime(2026, 7, 30, 11, 55),
        intensity=8,
        outcome="used_nicotine",
        linked_log_id=log.id,
    )
    db_session.add(craving)
    db_session.commit()
    statements = []

    def capture_sql(conn, cursor, statement, parameters, context, executemany):
        statements.append(" ".join(statement.lower().split()))

    event.listen(db.engine, "before_cursor_execute", capture_sql)
    try:
        LogService.delete_owned(test_user.id, log.id)
    finally:
        event.remove(db.engine, "before_cursor_execute", capture_sql)

    db_session.expire_all()
    preserved = db_session.get(Craving, craving.id)
    assert db_session.get(Log, log.id) is None
    assert preserved is not None
    assert preserved.outcome == "used_nicotine"
    assert preserved.linked_log_id is None
    update_index = next(
        index
        for index, statement in enumerate(statements)
        if statement.startswith("update craving set linked_log_id")
    )
    delete_index = next(
        index
        for index, statement in enumerate(statements)
        if statement.startswith("delete from log")
    )
    assert update_index < delete_index


def test_delete_requires_one_owned_row_to_win_the_mutation(
    app, db_session, test_user, test_pouch, monkeypatch
):
    log = LogService.create_idempotent(
        test_user.id,
        _selected_pouch_input(
            test_pouch.id,
            client_event_id="018f4f5c-68af-7e4d-bf5d-0123456789ab",
        ),
    ).log
    original_execute = db.session.execute

    class LostDelete:
        rowcount = 0

    def lose_owned_delete(statement, *args, **kwargs):
        if (
            getattr(statement, "is_delete", False)
            and getattr(getattr(statement, "table", None), "name", None)
            == Log.__tablename__
        ):
            return LostDelete()
        return original_execute(statement, *args, **kwargs)

    monkeypatch.setattr(db.session, "execute", lose_owned_delete)

    with pytest.raises(LogNotFoundError):
        LogService.delete_owned(test_user.id, log.id)

    db_session.expire_all()
    assert db_session.get(Log, log.id) is not None


@pytest.mark.parametrize(
    "pouch_id, custom_product",
    [
        (1, CustomProductInput(brand="Custom", nicotine_mg=Decimal("6.00"))),
        (None, None),
    ],
)
def test_service_requires_exactly_one_product_source(
    app, db_session, test_user, test_pouch, pouch_id, custom_product
):
    resolved_pouch_id = test_pouch.id if pouch_id is not None else None
    base = _selected_pouch_input(
        resolved_pouch_id,
        client_event_id="c18f3f5c-68af-7e4d-bf5d-0123456789ab",
    )
    payload = CreateLogInput(
        **{**base.__dict__, "custom_product": custom_product}
    )

    with pytest.raises(LogValidationError) as error:
        LogService.create_idempotent(test_user.id, payload)

    assert error.value.field_errors == {
        "product": ["Choose one pouch or enter one custom product."]
    }
    assert db_session.query(Log).filter_by(user_id=test_user.id).count() == 0


def test_successful_create_and_delete_each_commit_exactly_once(
    app, db_session, test_user, test_pouch, monkeypatch
):
    original_commit = db.session.commit
    commits = []

    def counted_commit():
        commits.append("commit")
        return original_commit()

    monkeypatch.setattr(db.session, "commit", counted_commit)
    created = LogService.create_idempotent(
        test_user.id,
        _selected_pouch_input(
            test_pouch.id,
            client_event_id="d18f3f5c-68af-7e4d-bf5d-0123456789ab",
        ),
    )
    assert commits == ["commit"]

    commits.clear()
    LogService.delete_owned(test_user.id, created.log.id)
    assert commits == ["commit"]


def test_duplicate_replay_performs_no_commit(
    app, db_session, test_user, test_pouch, monkeypatch
):
    payload = _selected_pouch_input(
        test_pouch.id,
        client_event_id="e18f3f5c-68af-7e4d-bf5d-0123456789ab",
    )
    created = LogService.create_idempotent(test_user.id, payload)

    def forbidden_commit():
        raise AssertionError("duplicate replay must not commit")

    monkeypatch.setattr(db.session, "commit", forbidden_commit)

    replay = LogService.create_idempotent(test_user.id, payload)

    assert replay.created is False
    assert replay.log.id == created.log.id
