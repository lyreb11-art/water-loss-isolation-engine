"""
db.py -- shared SQLite layer.
Stores: citizen complaints, live hardware readings, synthetic events.
"""
import os
import sqlite3
from datetime import datetime, timezone

DB_PATH = "waterloss.db"


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_conn()
    cur = conn.cursor()

    cur.execute("""
        CREATE TABLE IF NOT EXISTS complaints (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            zone TEXT NOT NULL,
            name TEXT,
            message TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'Open',
            created_at TEXT NOT NULL,
            official_reply TEXT
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS live_readings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            flow_in REAL NOT NULL,
            flow_out REAL NOT NULL,
            diff_pct REAL NOT NULL,
            classification TEXT NOT NULL,
            confidence REAL NOT NULL,
            valve_closed INTEGER NOT NULL DEFAULT 0
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS synthetic_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            edge TEXT NOT NULL,
            zone TEXT NOT NULL,
            diff_pct REAL NOT NULL,
            classification TEXT NOT NULL,
            confidence REAL NOT NULL
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            actor TEXT NOT NULL,
            action TEXT NOT NULL,
            edge TEXT,
            reason TEXT
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS work_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            complaint_id INTEGER NOT NULL,
            action_type TEXT NOT NULL,
            notes TEXT,
            metadata TEXT,
            logged_by TEXT,
            logged_at TEXT NOT NULL,
            FOREIGN KEY (complaint_id) REFERENCES complaints(id)
        )
    """)

    # Add lifecycle columns to complaints if they don't exist (SQLite safe pattern)
    for col, typ in [
        ("stage", "TEXT DEFAULT 'reported'"),
        ("dispatched_at", "TEXT"),
        ("onsite_at", "TEXT"),
        ("resolved_at", "TEXT"),
        ("assigned_depot", "TEXT"),
    ]:
        try:
            cur.execute(f"ALTER TABLE complaints ADD COLUMN {col} {typ}")
        except sqlite3.OperationalError:
            pass

    conn.commit()
    conn.close()


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def add_complaint(zone, name, message):
    conn = get_conn()
    conn.execute(
        "INSERT INTO complaints (zone, name, message, status, created_at) VALUES (?,?,?,?,?)",
        (zone, name, message, "Open", now_iso()),
    )
    conn.commit()
    conn.close()


def list_complaints():
    conn = get_conn()
    rows = conn.execute("SELECT * FROM complaints ORDER BY id DESC").fetchall()
    conn.close()
    return rows


def update_complaint(complaint_id, status, official_reply=None):
    conn = get_conn()
    now = now_iso()
    if status == "Resolved":
        conn.execute(
            """UPDATE complaints 
               SET status=?, official_reply=?, stage='resolved',
                   resolved_at=COALESCE(resolved_at, ?),
                   dispatched_at=COALESCE(dispatched_at, ?),
                   onsite_at=COALESCE(onsite_at, ?)
               WHERE id=?""",
            (status, official_reply, now, now, now, complaint_id),
        )
        # Log worklog if not already resolved
        conn.execute(
            """INSERT INTO work_logs (complaint_id, action_type, notes, metadata, logged_by, logged_at)
               VALUES (?, 'resolved', ?, '{}', 'admin', ?)""",
            (complaint_id, official_reply or "Work completed and resolved", now),
        )
    elif status == "In Progress":
        conn.execute(
            """UPDATE complaints 
               SET status=?, official_reply=?, stage=CASE WHEN stage='reported' THEN 'dispatched' ELSE stage END,
                   dispatched_at=COALESCE(dispatched_at, ?)
               WHERE id=?""",
            (status, official_reply, now, complaint_id),
        )
        conn.execute(
            """INSERT INTO work_logs (complaint_id, action_type, notes, metadata, logged_by, logged_at)
               VALUES (?, 'crew_dispatched', ?, '{}', 'admin', ?)""",
            (complaint_id, official_reply or "Crew dispatched to zone", now),
        )
    else:
        conn.execute(
            "UPDATE complaints SET status=?, official_reply=?, stage='reported' WHERE id=?",
            (status, official_reply, complaint_id),
        )
    conn.commit()
    conn.close()


_last_idle_insert = 0.0
_last_was_active = False


def add_live_reading(flow_in, flow_out, diff_pct, classification, confidence, valve_closed):
    global _last_idle_insert, _last_was_active
    import time
    now = time.time()

    is_active = (flow_in > 0.05 or flow_out > 0.05 or bool(valve_closed))

    # Throttle repetitive idle zero readings so they don't bury active flow events
    if not is_active:
        if _last_was_active:
            _last_was_active = False
            _last_idle_insert = now
        elif now - _last_idle_insert < 15.0:
            return
        else:
            _last_idle_insert = now
    else:
        _last_was_active = True

    conn = get_conn()
    conn.execute(
        """INSERT INTO live_readings
           (timestamp, flow_in, flow_out, diff_pct, classification, confidence, valve_closed)
           VALUES (?,?,?,?,?,?,?)""",
        (now_iso(), flow_in, flow_out, diff_pct, classification, confidence, int(valve_closed)),
    )
    conn.commit()
    conn.close()


def latest_live_readings(limit=50):
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM live_readings ORDER BY id DESC LIMIT ?", (limit,)
    ).fetchall()
    conn.close()
    return rows


def latest_active_live_reading():
    conn = get_conn()
    row = conn.execute(
        """SELECT * FROM live_readings 
           WHERE flow_in > 0.05 OR flow_out > 0.05 
           ORDER BY id DESC LIMIT 1"""
    ).fetchone()
    conn.close()
    return row


def add_synthetic_event(edge, zone, diff_pct, classification, confidence):
    conn = get_conn()
    conn.execute(
        """INSERT INTO synthetic_events
           (timestamp, edge, zone, diff_pct, classification, confidence)
           VALUES (?,?,?,?,?,?)""",
        (now_iso(), edge, zone, diff_pct, classification, confidence),
    )
    conn.commit()
    conn.close()


def latest_synthetic_events(limit=20):
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM synthetic_events ORDER BY id DESC LIMIT ?", (limit,)
    ).fetchall()
    conn.close()
    return rows


def add_audit(actor, action, edge=None, reason=None):
    conn = get_conn()
    conn.execute(
        "INSERT INTO audit_log (timestamp, actor, action, edge, reason) VALUES (?,?,?,?,?)",
        (now_iso(), actor, action, edge, reason),
    )
    conn.commit()
    conn.close()


def latest_audit(limit=20):
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM audit_log ORDER BY id DESC LIMIT ?", (limit,)
    ).fetchall()
    conn.close()
    return rows


if __name__ == "__main__":
    init_db()
    print(f"Database initialised at {DB_PATH}")