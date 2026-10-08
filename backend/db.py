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
    conn.execute(
        "UPDATE complaints SET status=?, official_reply=? WHERE id=?",
        (status, official_reply, complaint_id),
    )
    conn.commit()
    conn.close()


def add_live_reading(flow_in, flow_out, diff_pct, classification, confidence, valve_closed):
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