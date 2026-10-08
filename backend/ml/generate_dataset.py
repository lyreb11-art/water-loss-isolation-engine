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
        duration = 0

    elif event_type == "leak":
        severity = random.uniform(0.10, 0.35)
        growth = random.uniform(0.005, 0.03)
        onset_at = random.randint(1, 3)
        for t in range(random.randint(5, 20)):
            if t < onset_at:
                history.append(random.uniform(0, 2))
            else:
                sev = min(severity + growth * (t - onset_at), 0.5)
                history.append(sev * 100 + random.uniform(-1, 1))
        duration = len([d for d in history if d > 8])

    elif event_type == "theft":
        severity = random.uniform(0.20, 0.50)
        for t in range(random.randint(4, 12)):
            if t < 1:
                history.append(random.uniform(0, 2))
            else:
                history.append(severity * 100 + random.uniform(-2, 2))
        duration = len([d for d in history if d > 8])

    elif event_type == "burst":
        severity = random.uniform(0.65, 0.98)
        for t in range(random.randint(3, 8)):
            if t < 1:
                history.append(random.uniform(0, 2))
            else:
                history.append(severity * 100 + random.uniform(-3, 3))
        duration = len([d for d in history if d > 8])

    diff_pct = history[-1]
    diff_pct_lag1 = history[-2] if len(history) >= 2 else diff_pct
    diff_pct_lag3 = history[-4] if len(history) >= 4 else diff_pct_lag1
    slope = (diff_pct - diff_pct_lag3) / 3.0
    flow_in_norm = base_flow / 100.0

    label = {"normal": "Normal", "leak": "Leak",
             "theft": "Theft", "burst": "Burst"}[event_type]

    return {
        "diff_pct": round(diff_pct, 2),
        "diff_pct_lag1": round(diff_pct_lag1, 2),
        "diff_pct_lag3": round(diff_pct_lag3, 2),
        "slope": round(slope, 3),
        "duration_steps": duration,
        "flow_in_norm": round(flow_in_norm, 3),
        "label": label,
    }


def main():
    rows = []
    for event_type in ["normal", "leak", "theft", "burst"]:
        for _ in range(N_PER_CLASS):
            rows.append(simulate_scenario(event_type))

    random.shuffle(rows)

    with open(OUTPUT_PATH, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

    print(f"Wrote {len(rows)} rows to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()