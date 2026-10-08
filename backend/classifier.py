"""
classifier.py -- Rule-based Normal / Leak / Theft / Burst classifier.
"""
from dataclasses import dataclass


@dataclass
class Classification:
    label: str
    confidence: float


def classify_event(diff_pct: float, onset: str, duration_steps: int) -> Classification:
    """
    diff_pct       : 0-100, e.g. 35.0 means flow_out is 35% lower than flow_in
    onset          : "sudden" or "gradual"
    duration_steps : number of consecutive anomalous readings observed so far
    """

    # Burst is checked FIRST because a 60%+ flow loss is never sensor noise.
    # Waiting 2 extra ticks (the confirmation rule below) would delay the
    # most urgent event class by up to 8 seconds at a 4s tick interval.
    # Burst is immediate.
    if diff_pct >= 60:
        confidence = min(0.99, 0.7 + diff_pct / 200)
        return Classification("Burst", round(confidence, 2))

    # For the smaller mismatch classes (Leak/Theft), 1 or 2 anomalous readings
    # could just be transient noise. Require 3 consecutive ticks to confirm.
    if duration_steps < 3:
        return Classification("Normal", round(1 - diff_pct / 100, 2))

    # Within sensor noise tolerance -> normal
    if diff_pct < 8:
        return Classification("Normal", round(1 - diff_pct / 8, 2))

    # Moderate mismatch: onset speed differentiates theft from leak
    if onset == "sudden":
        confidence = min(0.97, 0.55 + diff_pct / 150 + duration_steps * 0.02)
        return Classification("Theft", round(confidence, 2))
    else:
        confidence = min(0.95, 0.5 + diff_pct / 150 + duration_steps * 0.015)
        return Classification("Leak", round(confidence, 2))


def diff_pct_from_flows(flow_in: float, flow_out: float) -> float:
    if flow_in <= 0:
        return 0.0
    return max(0.0, (flow_in - flow_out) / flow_in * 100)


if __name__ == "__main__":
    tests = [
        (2, "gradual", 5, "Normal"),
        (35, "sudden", 4, "Theft"),
        (25, "gradual", 8, "Leak"),
        (85, "sudden", 3, "Burst"),
        (40, "sudden", 1, "Normal"),
    ]
    for diff_pct, onset, duration, expected in tests:
        r = classify_event(diff_pct, onset, duration)
        print(f"{diff_pct:>3}% {onset:<8} dur={duration} -> {r.label} expected={expected}")