"""
train_model.py -- trains a Random Forest on the generated dataset.
Saves model.joblib next to this file.
"""

import os
import pandas as pd
import joblib

from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, confusion_matrix

HERE = os.path.dirname(__file__)
DATASET = os.path.join(HERE, "dataset.csv")
MODEL = os.path.join(HERE, "model.joblib")


def main():
    df = pd.read_csv(DATASET)

    FEATURES = [
        "diff_pct",
        "diff_pct_lag1",
        "diff_pct_lag3",
        "slope",
        "duration_steps",
        "flow_in_norm",
    ]

    X = df[FEATURES]
    y = df["label"]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    model = RandomForestClassifier(
        n_estimators=200, max_depth=10, random_state=42, n_jobs=-1
    )
    model.fit(X_train, y_train)

    y_pred = model.predict(X_test)

    print("=== Classification report ===")
    print(classification_report(y_test, y_pred))

    print("=== Confusion matrix ===")
    labels = sorted(y.unique())
    cm = confusion_matrix(y_test, y_pred, labels=labels)
    print("Rows = actual, Columns = predicted:", labels)
    for label, row in zip(labels, cm):
        print(f"{label:>8}: {row}")

    print("\n=== Feature importance ===")
    for name, imp in zip(FEATURES, model.feature_importances_):
        print(f"{name:>16}: {imp:.3f}")

    joblib.dump({"model": model, "features": FEATURES}, MODEL)
    print(f"\nSaved model to {MODEL}")


if __name__ == "__main__":
    main()