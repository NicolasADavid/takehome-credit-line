#!/usr/bin/env python3
"""Retention by experiment group from data/users.csv.

Members joined on different days, so "still open at the snapshot" favors late
joiners. This reports both that raw number and fixed-window retention: among
members who joined at least N days before the snapshot, the share whose account
was still open N days after joining.

Streams the file row by row; only aggregates are kept in memory.

Usage:
    python3 analysis/retention_by_group.py [--users data/users.csv] [--windows 7 14 30 60]
"""

import argparse
import csv
import math
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

SNAPSHOT = date(2026, 8, 25)
GROUPS = ("control", "treatment")


def parse_args():
    root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--users", type=Path, default=root / "data" / "users.csv")
    parser.add_argument("--windows", type=int, nargs="+", default=[7, 14, 30, 60])
    return parser.parse_args()


def diff_ci(retained_t, n_t, retained_c, n_c, z=1.96):
    """Treatment minus control retention, with a normal-approximation 95% CI."""
    p_t, p_c = retained_t / n_t, retained_c / n_c
    se = math.sqrt(p_t * (1 - p_t) / n_t + p_c * (1 - p_c) / n_c)
    diff = p_t - p_c
    return diff, diff - z * se, diff + z * se


def main():
    args = parse_args()
    windows = sorted(args.windows)

    total = defaultdict(int)
    open_at_snapshot = defaultdict(int)
    eligible = defaultdict(lambda: defaultdict(int))  # window -> group -> members
    retained = defaultdict(lambda: defaultdict(int))  # window -> group -> still open
    skipped = 0

    with args.users.open(newline="") as f:
        for row in csv.DictReader(f):
            group = row["experiment_group"]
            if group not in GROUPS:
                skipped += 1
                continue
            joined = date.fromisoformat(row["joined_ts"][:10])
            closed = row["account_closed_ts"]
            closed = date.fromisoformat(closed[:10]) if closed else None

            total[group] += 1
            if closed is None:
                open_at_snapshot[group] += 1

            for n in windows:
                if joined + timedelta(days=n) > SNAPSHOT:
                    continue  # not observed for the full window
                eligible[n][group] += 1
                if closed is None or closed > joined + timedelta(days=n):
                    retained[n][group] += 1

    print(f"Snapshot: {SNAPSHOT}")
    print(f"Members: " + ", ".join(f"{g}={total[g]:,}" for g in GROUPS))
    share_t = total["treatment"] / max(1, sum(total.values()))
    print(f"Treatment share: {share_t:.2%} (expected ~50%)")
    if skipped:
        print(f"Skipped {skipped:,} rows with an unknown experiment_group")
    print()

    header = f"{'Metric':<22}{'Control':>18}{'Treatment':>18}{'Diff (pp)':>12}{'95% CI (pp)':>22}"
    print(header)
    print("-" * len(header))

    def report(label, r_c, n_c, r_t, n_t):
        if not n_c or not n_t:
            print(f"{label:<22}{'(no eligible members)':>18}")
            return
        diff, lo, hi = diff_ci(r_t, n_t, r_c, n_c)
        print(
            f"{label:<22}{r_c / n_c:>18.2%}{r_t / n_t:>18.2%}"
            f"{diff * 100:>+12.2f}{f'[{lo * 100:+.2f}, {hi * 100:+.2f}]':>22}"
            f"   n={n_c:,} / {n_t:,}"
        )

    report(
        "Open at snapshot",
        open_at_snapshot["control"], total["control"],
        open_at_snapshot["treatment"], total["treatment"],
    )
    for n in windows:
        report(
            f"{n}-day retention",
            retained[n]["control"], eligible[n]["control"],
            retained[n]["treatment"], eligible[n]["treatment"],
        )


if __name__ == "__main__":
    main()
