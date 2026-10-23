#!/usr/bin/env python3
"""Break down the treatment effect using data/requests.csv joined to data/users.csv.

Answers:
  1. Data integrity: requests that shouldn't exist or look inconsistent.
  2. Funnel: who requests, how often, and how often they're approved.
  3. Retention by request outcome (treatment segments vs. the whole control group).
  4. Retention by headroom (max_eligible - starting_limit), treatment vs. control.
     Headroom is fixed at signup, so this comparison is still randomized.
  5. Decline reasons by how soon after joining the request was made.
  6. Approval rate by requested limit relative to max eligible.
  7. What happens after a decline: retries, later approvals, days until closing.

Segments in (3) are based on behavior after assignment, so they show
association, not cause. (4) is the causal cut.

Streams both files; keeps one small tuple per treatment member and per request.

Usage:
    python3 analysis/requests_breakdown.py [--users data/users.csv] [--requests data/requests.csv]
"""

import argparse
import csv
import math
from collections import Counter, defaultdict
from datetime import date, timedelta
from pathlib import Path

SNAPSHOT = date(2026, 8, 25)
WINDOWS = (7, 14, 30, 60)
EARLY_DAYS = 14


def parse_args():
    root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--users", type=Path, default=root / "data" / "users.csv")
    parser.add_argument("--requests", type=Path, default=root / "data" / "requests.csv")
    return parser.parse_args()


def to_date(value):
    return date.fromisoformat(value[:10]) if value else None


def retained(joined, closed, n):
    """True/False if retained n days after joining, None if not observed that long."""
    end = joined + timedelta(days=n)
    if end > SNAPSHOT:
        return None
    return closed is None or closed > end


def headroom_bucket(start, max_eligible):
    headroom = max_eligible - start
    if headroom <= 0:
        return "$0"
    if headroom <= 50_000:
        return "$1-500"
    if headroom <= 150_000:
        return "$501-1,500"
    return "$1,501+"


def days_bucket(days):
    if days < 0:
        return "before join"
    for upper, label in ((3, "0-3"), (7, "4-7"), (14, "8-14"), (30, "15-30")):
        if days <= upper:
            return label
    return "31+"


def ratio_bucket(requested, max_eligible):
    if requested > max_eligible:
        return "> max"
    if requested == max_eligible:
        return "= max"
    ratio = requested / max_eligible
    if ratio <= 0.5:
        return "<= 50% of max"
    if ratio <= 0.75:
        return "51-75% of max"
    return "76-99% of max"


class Retention:
    """Retained / observed counts per segment and window."""

    def __init__(self):
        self.observed = defaultdict(Counter)
        self.kept = defaultdict(Counter)

    def add(self, segment, joined, closed):
        for n in WINDOWS:
            outcome = retained(joined, closed, n)
            if outcome is None:
                continue
            self.observed[segment][n] += 1
            self.kept[segment][n] += outcome

    def rate(self, segment, n):
        observed = self.observed[segment][n]
        return (self.kept[segment][n] / observed, observed) if observed else (None, 0)


def pct(part, whole):
    return f"{part / whole:.1%}" if whole else "-"


def print_retention(title, retention, segments, baseline=None):
    print(f"\n## {title}")
    header = f"{'Segment':<52}" + "".join(f"{f'{n}d':>16}" for n in WINDOWS)
    print(header)
    print("-" * len(header))
    for segment in segments:
        cells = []
        for n in WINDOWS:
            rate, observed = retention.rate(segment, n)
            if rate is None:
                cells.append(f"{'-':>16}")
                continue
            cell = f"{rate:.1%}"
            if baseline and segment != baseline:
                base, base_n = retention.rate(baseline, n)
                if base is not None:
                    se = math.sqrt(rate * (1 - rate) / observed + base * (1 - base) / base_n)
                    sig = "*" if abs(rate - base) > 1.96 * se else " "
                    cell += f" ({(rate - base) * 100:+.1f}){sig}"
            cells.append(f"{cell:>16}")
        print(f"{segment:<52}" + "".join(cells))
    print("n per window: " + "; ".join(
        f"{s}: " + "/".join(f"{retention.rate(s, n)[1]:,}" for n in WINDOWS) for s in segments
    ))
    if baseline:
        print(f"(pp vs. {baseline}; * = outside 95% CI)")


def print_table(title, rows, columns):
    print(f"\n## {title}")
    widths = [max(len(str(c)), *(len(str(r[i])) for r in rows)) + 2 for i, c in enumerate(columns)]
    print("".join(f"{c:<{w}}" for c, w in zip(columns, widths)))
    print("-" * sum(widths))
    for row in rows:
        print("".join(f"{str(v):<{w}}" for v, w in zip(row, widths)))


def main():
    args = parse_args()

    # Pass 1: users. Keep treatment members; control only needs aggregates and ids.
    treatment = {}  # user_id -> (joined, closed, start, max_eligible)
    control_ids = set()
    headroom_retention = Retention()
    group_retention = Retention()

    with args.users.open(newline="") as f:
        for row in csv.DictReader(f):
            joined, closed = to_date(row["joined_ts"]), to_date(row["account_closed_ts"])
            start = int(row["starting_limit_cents"])
            max_eligible = int(row["max_eligible_limit_cents"])
            group = row["experiment_group"]
            bucket = headroom_bucket(start, max_eligible)
            headroom_retention.add(f"{group} | headroom {bucket}", joined, closed)
            if group == "treatment":
                treatment[row["user_id"]] = (joined, closed, start, max_eligible)
            elif group == "control":
                control_ids.add(row["user_id"])
                group_retention.add("control (all)", joined, closed)

    # Pass 2: requests, grouped by member.
    by_user = defaultdict(list)  # user_id -> [(ts, decision, reason, requested)]
    issues = Counter()
    with args.requests.open(newline="") as f:
        for row in csv.DictReader(f):
            uid = row["user_id"]
            if uid in control_ids:
                issues["request from a control member"] += 1
                continue
            if uid not in treatment:
                issues["request from an unknown member"] += 1
                continue
            by_user[uid].append((
                row["requested_ts"], row["decision"], row["decline_reason"],
                int(row["requested_limit_cents"]),
            ))

    early_retention = Retention()
    reason_by_timing = defaultdict(Counter)  # days bucket -> outcome/reason -> count
    ratio_outcomes = defaultdict(Counter)  # ratio bucket -> decision -> count
    request_counts = Counter()
    decline_to_close = Counter()
    first_declined = retried = later_approved = 0
    total_requests = approved_requests = 0

    for uid, (joined, closed, start, max_eligible) in treatment.items():
        requests = sorted(by_user.get(uid, []))
        request_counts[min(len(requests), 5)] += 1

        for ts, decision, reason, requested in requests:
            day = to_date(ts)
            total_requests += 1
            approved_requests += decision == "APPROVED"
            if day < joined:
                issues["request before joining"] += 1
            if closed and day > closed:
                issues["request after account closed"] += 1
            if requested <= start:
                issues["requested limit <= starting limit"] += 1
            if decision == "APPROVED" and requested > max_eligible:
                issues["approved above max eligible"] += 1
            if decision == "DECLINED" and not reason:
                issues["decline with no reason"] += 1
            outcome = reason if decision == "DECLINED" else "APPROVED"
            reason_by_timing[days_bucket((day - joined).days)][outcome] += 1
            ratio_outcomes[ratio_bucket(requested, max_eligible)][decision] += 1

        # Overall segment: outcome of the member's first request ever.
        if not requests:
            segment = "treatment: never requested"
        elif requests[0][1] == "APPROVED":
            segment = "treatment: first request approved"
        else:
            segment = f"treatment: first declined ({requests[0][2]})"
        group_retention.add(segment, joined, closed)

        # Early segment: first-request outcome within EARLY_DAYS of joining.
        early = [r for r in requests if (to_date(r[0]) - joined).days < EARLY_DAYS]
        if not early:
            early_segment = f"no request in first {EARLY_DAYS}d"
        elif early[0][1] == "APPROVED":
            early_segment = f"approved in first {EARLY_DAYS}d"
        else:
            early_segment = f"declined in first {EARLY_DAYS}d"
        early_retention.add(early_segment, joined, closed)

        if requests and requests[0][1] == "DECLINED":
            first_declined += 1
            retried += len(requests) > 1
            later_approved += any(r[1] == "APPROVED" for r in requests[1:])

        if closed and requests:
            before_close = [r for r in requests if to_date(r[0]) <= closed]
            if before_close and before_close[-1][1] == "DECLINED":
                gap = (closed - to_date(before_close[-1][0])).days
                decline_to_close[days_bucket(gap)] += 1

    early_retention.observed["control (all)"] = group_retention.observed["control (all)"]
    early_retention.kept["control (all)"] = group_retention.kept["control (all)"]

    # Output
    print(f"Snapshot: {SNAPSHOT}")
    print(f"Treatment members: {len(treatment):,}   Control members: {len(control_ids):,}")

    print("\n## 1. Data integrity")
    if issues:
        for issue, count in issues.most_common():
            print(f"{issue:<40}{count:>10,}")
    else:
        print("No issues found")

    requesters = len(treatment) - request_counts[0]
    print("\n## 2. Funnel")
    print(f"Treatment members who requested: {requesters:,} ({pct(requesters, len(treatment))})")
    print(f"Requests: {total_requests:,}   Approved: {pct(approved_requests, total_requests)}")
    print("Requests per member: " + ", ".join(
        f"{'5+' if k == 5 else k}: {pct(v, len(treatment))}" for k, v in sorted(request_counts.items())
    ))

    segments = ["control (all)", "treatment: never requested", "treatment: first request approved"]
    segments += sorted(s for s in group_retention.observed if s.startswith("treatment: first declined"))
    print_retention("3a. Retention by first-request outcome", group_retention, segments, "control (all)")
    print_retention(
        f"3b. Retention by outcome in the first {EARLY_DAYS} days", early_retention,
        ["control (all)", f"no request in first {EARLY_DAYS}d",
         f"approved in first {EARLY_DAYS}d", f"declined in first {EARLY_DAYS}d"],
        "control (all)",
    )

    print("\n## 4. Retention by headroom (randomized comparison)")
    for bucket in ("$0", "$1-500", "$501-1,500", "$1,501+"):
        print_retention(
            f"headroom {bucket}", headroom_retention,
            [f"control | headroom {bucket}", f"treatment | headroom {bucket}"],
            f"control | headroom {bucket}",
        )

    outcomes = ["APPROVED", "INSUFFICIENT_PAYMENT_HISTORY", "UTILIZATION_TOO_HIGH", "NEW_CREDIT_LINES"]
    timing_order = ["before join", "0-3", "4-7", "8-14", "15-30", "31+"]
    rows = []
    for bucket in timing_order:
        counts = reason_by_timing.get(bucket)
        if not counts:
            continue
        total = sum(counts.values())
        rows.append([bucket, f"{total:,}"] + [pct(counts[o], total) for o in outcomes])
    print_table("5. Request outcome by days since joining", rows, ["Days", "Requests"] + outcomes)

    rows = []
    for bucket in ("<= 50% of max", "51-75% of max", "76-99% of max", "= max", "> max"):
        counts = ratio_outcomes.get(bucket)
        if not counts:
            continue
        total = sum(counts.values())
        rows.append([bucket, f"{total:,}", pct(counts["APPROVED"], total)])
    print_table("6. Approval rate by requested limit vs. max eligible", rows,
                ["Requested", "Requests", "Approved"])

    print("\n## 7. After a decline")
    print(f"Members whose first request was declined: {first_declined:,}")
    print(f"  requested again: {pct(retried, first_declined)}")
    print(f"  later approved:  {pct(later_approved, first_declined)}")
    total_closed = sum(decline_to_close.values())
    print(f"Closed accounts whose last request before closing was a decline: {total_closed:,}")
    for bucket in ("0-3", "4-7", "8-14", "15-30", "31+"):
        print(f"  closed {bucket} days after the decline: {pct(decline_to_close[bucket], total_closed)}")


if __name__ == "__main__":
    main()
