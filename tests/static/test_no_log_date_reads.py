"""AST guard: no code below routes/, services/, or models/ may read the
deprecated ``Log.log_date`` column.

Allowed by design:
- Store assignments such as ``log.log_date = value`` (back-compat writes).
- The model declaration ``log_date = db.Column(...)``.
- Serializer dictionary keys such as ``{"log_date": computed_local_date}``
  when the value does not itself read ``.log_date``.
- Comments, arbitrary strings, and similarly named fields (``log_dates``).
- Local simple assignment ``log_date = value``.
"""

import ast
import re
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCAN_DIRS = ("routes", "services", "models")

STRING_QUERY_FUNCS = {"order_by", "group_by", "text", "column"}
REFLECTIVE_FUNCS = {"getattr", "setattr", "attrgetter"}
LOG_DATE_TOKEN = re.compile(r"\blog_date\b")


def _func_name(func: ast.expr) -> str | None:
    if isinstance(func, ast.Attribute):
        return func.attr
    if isinstance(func, ast.Name):
        return func.id
    return None


def find_violations(tree: ast.AST) -> list[tuple[int, str]]:
    """Return ``(lineno, kind)`` for every forbidden log_date read."""
    violations: list[tuple[int, str]] = []
    for node in ast.walk(tree):
        # Any attribute read named log_date, regardless of receiver.
        if (
            isinstance(node, ast.Attribute)
            and node.attr == "log_date"
            and isinstance(node.ctx, ast.Load)
        ):
            violations.append((node.lineno, "attribute-read"))
            continue

        # Augmented assignment to log_date (attribute or bare name).
        if isinstance(node, ast.AugAssign):
            target = node.target
            if (isinstance(target, ast.Attribute) and target.attr == "log_date") or (
                isinstance(target, ast.Name) and target.id == "log_date"
            ):
                violations.append((node.lineno, "augassign-log_date"))
            continue

        if isinstance(node, ast.Subscript):
            # vars(obj)["log_date"] or obj.__dict__["log_date"]
            key = node.slice
            if isinstance(key, ast.Constant) and key.value == "log_date":
                value = node.value
                if (
                    isinstance(value, ast.Call)
                    and isinstance(value.func, ast.Name)
                    and value.func.id == "vars"
                ) or (isinstance(value, ast.Attribute) and value.attr == "__dict__"):
                    violations.append((node.lineno, "namespace-dict-read"))
            continue

        if not isinstance(node, ast.Call):
            continue

        name = _func_name(node.func)
        if name is None:
            continue

        # .filter_by(log_date=...)
        if name == "filter_by" and any(kw.arg == "log_date" for kw in node.keywords):
            violations.append((node.lineno, "filter-by-kwarg"))
            continue

        # f(**{"log_date": ...}) literal double-star mappings.
        for kw in node.keywords:
            if kw.arg is None and isinstance(kw.value, ast.Dict):
                for key in kw.value.keys:
                    if isinstance(key, ast.Constant) and key.value == "log_date":
                        violations.append((node.lineno, "star-mapping-kwarg"))
                        break

        # String references passed to order_by/group_by/text/column.
        if name in STRING_QUERY_FUNCS:
            for sub in ast.walk(node):
                if (
                    isinstance(sub, ast.Constant)
                    and isinstance(sub.value, str)
                    and LOG_DATE_TOKEN.search(sub.value)
                ):
                    violations.append((node.lineno, "string-reference"))
                    break

        # getattr/setattr/attrgetter targeting exactly "log_date".
        if name in REFLECTIVE_FUNCS and any(
            isinstance(arg, ast.Constant) and arg.value == "log_date"
            for arg in node.args
        ):
            violations.append((node.lineno, "reflective-read"))

    return violations


def scan_source(source: str) -> list[tuple[int, str]]:
    return find_violations(ast.parse(source))


# ---------------------------------------------------------------------------
# Forbidden-pattern canaries
# ---------------------------------------------------------------------------

FORBIDDEN_CASES = [
    ("x = log.log_date", "attribute-read"),
    ("x = Log.log_date >= week_ago", "attribute-read"),
    ("x = duplicate.log_date", "attribute-read"),
    ("log.log_date += 1", "augassign-log_date"),
    ("log_date += 1", "augassign-log_date"),
    ("Log.query.filter_by(log_date=today)", "filter-by-kwarg"),
    ('create_log(**{"log_date": value, "user_id": 1})', "star-mapping-kwarg"),
    ('query.order_by("log_date")', "string-reference"),
    ('query.order_by(desc("log_date"))', "string-reference"),
    ('query.group_by("log_date, log_time")', "string-reference"),
    ('db.session.execute(text("WHERE log_date = :d"))', "string-reference"),
    ('column("log_date")', "string-reference"),
    ('getattr(log, "log_date")', "reflective-read"),
    ('setattr(log, "log_date", value)', "reflective-read"),
    ('sorted(logs, key=attrgetter("log_date"))', "reflective-read"),
    ('vars(log)["log_date"]', "namespace-dict-read"),
    ('log.__dict__["log_date"]', "namespace-dict-read"),
]


@pytest.mark.parametrize("source,kind", FORBIDDEN_CASES)
def test_forbidden_patterns_are_flagged(source: str, kind: str) -> None:
    violations = scan_source(source)
    assert violations, f"no violations found in: {source}"
    assert kind in {k for _, k in violations}


# ---------------------------------------------------------------------------
# Allowed-pattern canaries
# ---------------------------------------------------------------------------

ALLOWED_CASES = [
    # Back-compat Store assignment.
    "log.log_date = utc_datetime.date()",
    # Model column declaration.
    "log_date = db.Column(db.Date, default=date.today, nullable=False)",
    # Local simple assignment.
    "log_date = datetime.strptime(raw, '%Y-%m-%d').date()",
    # Serializer key whose value does not read .log_date.
    "payload = {'log_date': computed_local_date.isoformat()}",
    # Comments and arbitrary strings mentioning log_date.
    'help_text = "log_date is deprecated; do not read it"  # log.log_date',
    # Similarly named fields must not be flagged.
    "x = log.log_dates\ny = log_dates",
    # Unrelated query strings.
    'query.order_by("log_time").group_by("user_id")',
    'query.order_by("log_dates")',
    'db.session.execute(text("SELECT log_dates FROM t"))',
    # Unrelated keyword filters.
    "Log.query.filter_by(user_id=1)",
    # Double-star mapping without the log_date key.
    'create_log(**{"log_time": value})',
    # Reflective access to other attributes.
    'getattr(log, "log_time")',
    'sorted(logs, key=attrgetter("log_time"))',
    # Namespace dict reads of other keys.
    'vars(log)["log_time"]',
    'log.__dict__["log_time"]',
]


@pytest.mark.parametrize("source", ALLOWED_CASES)
def test_allowed_patterns_are_not_flagged(source: str) -> None:
    assert scan_source(source) == []


# ---------------------------------------------------------------------------
# Repository guard
# ---------------------------------------------------------------------------

def _iter_scanned_files() -> list[Path]:
    files: list[Path] = []
    for dirname in SCAN_DIRS:
        base = REPO_ROOT / dirname
        files.extend(sorted(base.rglob("*.py")))
    return files


def test_repository_has_no_log_date_reads() -> None:
    violations: list[str] = []
    for path in _iter_scanned_files():
        source = path.read_text(encoding="utf-8")
        for lineno, kind in find_violations(ast.parse(source)):
            rel = path.relative_to(REPO_ROOT)
            violations.append(f"{rel}:{lineno}:{kind}")
    assert violations == [], "deprecated log_date reads remain:\n" + "\n".join(
        violations
    )
