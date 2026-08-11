"""Deterministic, stateless brand-group assignment for spreading the
automatic status-check workload across multiple runs instead of hitting
every brand every time.

No brand -> group table is persisted anywhere: a brand's group is a pure
function of its own (tab, brand) name, and which group is "active" for a
given run is a pure function of the current date. Both recompute the same
way every time, so a failed or skipped cron run never leaves stale state
to clean up, and a brand added tomorrow is assigned a group automatically
the first time it's ever queried -- no manual registration step, ever.
"""
import hashlib
from datetime import date
from typing import Optional

NUM_GROUPS = 3

# Any fixed Monday works as the anchor for the weekly rotation -- it only
# has to be stable across runs, not meaningful. Chosen arbitrarily.
_EPOCH = date(2026, 1, 5)


def brand_group_index(tab: str, brand: str) -> int:
    """Deterministic group (0..NUM_GROUPS-1) for a (tab, brand) pair.

    Uses hashlib, not Python's built-in hash() -- hash() on strings is
    randomized per-process (PYTHONHASHSEED) unless explicitly disabled,
    which would silently reassign every brand's group on every single
    script invocation instead of keeping it stable run to run.
    """
    key = f"{(tab or '').strip().lower()}::{(brand or '').strip().lower()}"
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()
    return int(digest, 16) % NUM_GROUPS


def active_group_index(today: Optional[date] = None) -> int:
    """Which group (0..NUM_GROUPS-1) is due to run, computed purely from
    the current date -- no stored cursor, so a missed or failed run just
    resumes on the correct group next time with no recovery step."""
    d = today or date.today()
    weeks_since_epoch = (d - _EPOCH).days // 7
    return weeks_since_epoch % NUM_GROUPS


def in_active_group(tab: str, brand: str, today: Optional[date] = None) -> bool:
    """True if this (tab, brand) pair's assigned group is the one active
    for `today` (defaults to the real current date)."""
    return brand_group_index(tab, brand) == active_group_index(today)
