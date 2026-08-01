"""Deterministic, non-medical coaching for Today."""

from services.api_types import CoachingAction, CoachingMessage


class CoachingService:
    """Select supportive copy from explicit Today states only."""

    @classmethod
    def message_for_today(
        cls,
        *,
        status: str,
        has_unresolved_craving: bool = False,
        check_in_eligible: bool = False,
        **_: object,
    ) -> CoachingMessage:
        if status == "exceeded":
            return CoachingMessage(
                key="plan_exceeded",
                headline="Plan exceeded",
                body="One day does not erase your progress. Keep the record honest and choose a useful next step.",
                actions=(
                    CoachingAction(
                        key="keep_logging",
                        label="Keep logging",
                        href="/today#quick-log",
                    ),
                    CoachingAction(
                        key="reflect",
                        label="Reflect on today",
                        href="/today#check-in",
                    ),
                    CoachingAction(
                        key="review_plan",
                        label="Review the plan",
                        href="/journey",
                    ),
                ),
            )
        if has_unresolved_craving:
            return CoachingMessage(
                key="unresolved_craving",
                headline="Check in with this craving",
                body="Notice what changed, then record the outcome when you are ready.",
                actions=(
                    CoachingAction(
                        key="continue_craving",
                        label="Continue craving support",
                        href="/today#craving",
                    ),
                ),
            )
        if status == "met":
            return CoachingMessage(
                key="target_met",
                headline="Today's target is met",
                body="Keep logging if the day changes; the record stays useful.",
                actions=(
                    CoachingAction(
                        key="keep_logging",
                        label="Keep logging",
                        href="/today#quick-log",
                    ),
                ),
            )
        if check_in_eligible:
            return CoachingMessage(
                key="end_of_day_reflection",
                headline="A short reflection may help",
                body="Capture what made today easier or harder while it is fresh.",
                actions=(
                    CoachingAction(
                        key="reflect",
                        label="Reflect on today",
                        href="/today#check-in",
                    ),
                ),
            )
        if status in {"neutral", "unknown"}:
            return CoachingMessage(
                key="neutral_tracking",
                headline="Track the day as it is",
                body="Each honest entry makes your patterns easier to understand.",
                actions=(
                    CoachingAction(
                        key="log_nicotine",
                        label="Log nicotine use",
                        href="/today#quick-log",
                    ),
                ),
            )
        if status in {"on_track", "approaching"}:
            return CoachingMessage(
                key="early_on_track",
                headline="You are on pace",
                body="Keep the next choice simple and continue logging honestly.",
                actions=(
                    CoachingAction(
                        key="log_nicotine",
                        label="Log nicotine use",
                        href="/today#quick-log",
                    ),
                ),
            )
        raise ValueError(f"unsupported Today coaching status: {status!r}")
