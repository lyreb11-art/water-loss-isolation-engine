"""
generate_dataset.py
Builds a labeled dataset by simulating thousands of scenarios with
randomized severity, onset speed, and duration.

The features extracted here are the SAME rolling-window features the
classifier sees at inference time. Nothing depends on _onset metadata
that the injector writes -- the model must infer event type from the
time-series shape alone. This is what makes the ML layer non-circular.

Output: backend/ml/dataset.csv
"""

import csv
import os
import random

OUTPUT_PATH = os.path.join(os.path.dirname(__file__), "dataset.csv")
N_PER_CLASS = 1500


def simulate_scenario(event_type):
    base_flow = random.uniform(20, 40)
    history = []

    if event_type == "normal":
        for _ in range(random.randint(4, 15)):
            noise = random.uniform(-2, 2)
            history.append(max(0.0, noise))

    elif event_type == "leak":
        # Gradual onset: starts small and develops slowly over multiple ticks
        start_sev = random.uniform(0.04, 0.12)
        growth = random.uniform(0.01, 0.03)
        onset_at = random.randint(1, 3)
        for t in range(random.randint(6, 20)):
            if t < onset_at:
                history.append(random.uniform(0, 2))
            else:
                sev = min(start_sev + growth * (t - onset_at), 0.45)
                history.append(sev * 100 + random.uniform(-1, 1))

    elif event_type == "theft":
        # Sudden onset: jumps immediately to moderate/high loss (15% - 55%)
        severity = random.uniform(0.18, 0.55)
        for t in range(random.randint(4, 12)):
            if t < 1:
                history.append(random.uniform(0, 2))
            else:
                history.append(severity * 100 + random.uniform(-2, 2))

    elif event_type == "burst":
        # Massive sudden onset: jumps immediately to > 60% loss
        severity = random.uniform(0.60, 0.99)
        for t in range(random.randint(3, 8)):
            if t < 1:
                history.append(random.uniform(0, 2))
            else:
                history.append(severity * 100 + random.uniform(-3, 3))

    # Sample features at MULTIPLE points in the history, not just the last tick.
    # This ensures the model learns both transition ticks (high slope) and steady-state ticks.
    rows = []
    label = {"normal": "Normal", "leak": "Leak",
             "theft": "Theft", "burst": "Burst"}[event_type]

    for end in range(3, len(history) + 1):
        window = history[:end]
        diff_pct = window[-1]
        diff_pct_lag1 = window[-2] if len(window) >= 2 else diff_pct
        diff_pct_lag3 = window[-4] if len(window) >= 4 else diff_pct_lag1
        slope = (diff_pct - diff_pct_lag3) / 3.0
        duration_steps = len([d for d in window if d > 8])
        flow_in_norm = base_flow / 100.0

        rows.append({
            "diff_pct": round(diff_pct, 2),
            "diff_pct_lag1": round(diff_pct_lag1, 2),
            "diff_pct_lag3": round(diff_pct_lag3, 2),
            "slope": round(slope, 3),
            "duration_steps": duration_steps,
            "flow_in_norm": round(flow_in_norm, 3),
            "label": label,
        })

    return rows


def main():
    rows = []
    for event_type in ["normal", "leak", "theft", "burst"]:
        for _ in range(N_PER_CLASS):
            rows.extend(simulate_scenario(event_type))

    random.shuffle(rows)

    with open(OUTPUT_PATH, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

    print(f"Wrote {len(rows)} rows to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()