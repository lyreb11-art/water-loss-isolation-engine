"""
mqtt_bridge.py -- Real-time MQTT Sensor & Hardware Bridge for Water Loss Isolation Engine.

This script bridges ESP32 physical flow sensors / solenoid valves with the FastAPI backend.
It can:
  1. Subscribe to MQTT topics (e.g. 'waterloss/hardware/sensor') from ESP32 or MQTT brokers.
  2. Parse sensor payloads (flow_in, flow_out, valve_closed).
  3. Classify anomalies (Normal, Leak, Theft, Burst) using threshold rules.
  4. Write readings to SQLite db and/or send to backend REST API (/api/live).
  5. Run in standalone simulation mode to feed live hardware telemetry into the app.

Usage:
    # Run in live MQTT listener mode:
    python mqtt_bridge.py

    # Run in self-contained simulation mode (generates live test telemetry):
    python mqtt_bridge.py --simulate

    # Custom broker:
    python mqtt_bridge.py --broker broker.hivemq.com --port 1883
"""

import argparse
import json
import random
import sys
import time
import requests
import paho.mqtt.client as mqtt
import db

# Default Configuration
DEFAULT_BROKER = "broker.hivemq.com"
DEFAULT_PORT = 1883
DEFAULT_SENSOR_TOPIC = "waterloss/hardware/sensor"
DEFAULT_VALVE_TOPIC = "waterloss/hardware/valve"
BACKEND_URL = "http://localhost:8000/api/live"


def classify_flow_mismatch(flow_in: float, flow_out: float, valve_closed: bool = False):
    """Calculates diff_pct, classification, and confidence score."""
    if valve_closed:
        return 0.0, "Isolated", 1.0

    if flow_in <= 0:
        return 0.0, "Normal", 0.99

    diff_pct = max(0.0, ((flow_in - flow_out) / flow_in) * 100.0)

    if diff_pct < 5.0:
        classification = "Normal"
        confidence = 0.98 - (diff_pct * 0.01)
    elif diff_pct < 18.0:
        classification = "Leak"
        confidence = 0.85 + (diff_pct * 0.005)
    elif diff_pct < 35.0:
        classification = "Theft"
        confidence = 0.88 + (diff_pct * 0.002)
    else:
        classification = "Burst"
        confidence = 0.95

    return round(diff_pct, 2), classification, round(min(0.99, confidence), 2)


def process_and_store_reading(flow_in: float, flow_out: float, valve_closed: bool = False):
    """Classifies flow reading and stores it in database & sends to backend API."""
    diff_pct, classification, confidence = classify_flow_mismatch(flow_in, flow_out, valve_closed)

    # 1. Store directly in DB
    try:
        db.add_live_reading(
            flow_in=flow_in,
            flow_out=flow_out,
            diff_pct=diff_pct,
            classification=classification,
            confidence=confidence,
            valve_closed=valve_closed,
        )
    except Exception as e:
        print(f"[WARN] DB insert warning: {e}")

    # 2. Post to backend REST API if running
    payload = {
        "flow_in": flow_in,
        "flow_out": flow_out,
        "diff_pct": diff_pct,
        "classification": classification,
        "confidence": confidence,
        "valve_closed": valve_closed,
    }
    try:
        res = requests.post(BACKEND_URL, json=payload, timeout=2)
        if res.status_code == 200:
            print(f"[OK] Posted telemetry to backend: Flow In={flow_in}L/m | Out={flow_out}L/m | Diff={diff_pct}% | {classification}")
    except Exception:
        print(f"[INFO] DB saved locally. Backend API at {BACKEND_URL} not running.")

    return payload


# --- MQTT Callback Handlers ---
def on_connect(client, userdata, flags, rc, properties=None):
    if rc == 0:
        print(f"[OK] Connected to MQTT Broker successfully.")
        topic = userdata.get("topic", DEFAULT_SENSOR_TOPIC)
        client.subscribe(topic)
        print(f"[MQTT] Subscribed to topic: {topic}")
    else:
        print(f"[FAIL] Connection failed with code {rc}")


def on_message(client, userdata, msg):
    try:
        payload_str = msg.payload.decode("utf-8")
        print(f"[MQTT] Message on [{msg.topic}]: {payload_str}")
        data = json.loads(payload_str)

        flow_in = float(data.get("flow_in", 0))
        flow_out = float(data.get("flow_out", 0))
        valve_closed = bool(data.get("valve_closed", False))

        process_and_store_reading(flow_in, flow_out, valve_closed)
    except Exception as e:
        print(f"[ERROR] Error processing MQTT message: {e}")


def run_mqtt_listener(broker: str, port: int, topic: str):
    """Connects to MQTT Broker and listens for messages continuously."""
    db.init_db()
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, userdata={"topic": topic})
    client.on_connect = on_connect
    client.on_message = on_message

    print(f"[START] Connecting to MQTT Broker at {broker}:{port}...")
    try:
        client.connect(broker, port, 60)
        client.loop_forever()
    except KeyboardInterrupt:
        print("\n[STOP] Stopping MQTT listener.")
        client.disconnect()
    except Exception as e:
        print(f"[ERROR] Could not connect to MQTT broker: {e}")


def run_simulator(broker: str = None, port: int = None, topic: str = None):
    """Simulates physical hardware sending ESP32 sensor telemetry every 3 seconds."""
    db.init_db()
    print("[START] Starting Hardware Telemetry Simulator...")
    print("Press Ctrl+C to stop.\n")

    # If broker is provided, also publish to MQTT broker
    mqtt_client = None
    if broker:
        try:
            mqtt_client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
            mqtt_client.connect(broker, port, 60)
            mqtt_client.loop_start()
            print(f"[MQTT] Simulator publishing to MQTT [{broker}:{port}] -> {topic}")
        except Exception as e:
            print(f"[WARN] Could not connect to MQTT broker ({e}). Running REST/DB simulator only.")

    scenarios = ["normal", "normal", "normal", "leak", "theft", "burst"]
    valve_closed = False

    try:
        while True:
            current_mode = random.choice(scenarios)
            base_flow = round(random.uniform(40.0, 50.0), 2)

            if valve_closed:
                flow_in = 0.0
                flow_out = 0.0
            elif current_mode == "normal":
                flow_in = base_flow
                flow_out = round(flow_in * random.uniform(0.97, 0.995), 2)
            elif current_mode == "leak":
                flow_in = base_flow
                flow_out = round(flow_in * random.uniform(0.85, 0.93), 2)
            elif current_mode == "theft":
                flow_in = base_flow
                flow_out = round(flow_in * random.uniform(0.70, 0.82), 2)
            else:  # burst
                flow_in = base_flow
                flow_out = round(flow_in * random.uniform(0.40, 0.60), 2)

            # Store & post
            payload = process_and_store_reading(flow_in, flow_out, valve_closed)

            # Publish to MQTT if connected
            if mqtt_client:
                mqtt_client.publish(topic or DEFAULT_SENSOR_TOPIC, json.dumps(payload))

            time.sleep(3.0)

    except KeyboardInterrupt:
        print("\n[STOP] Stopping Hardware Simulator.")
        if mqtt_client:
            mqtt_client.loop_stop()
            mqtt_client.disconnect()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Water Loss Hardware MQTT & Telemetry Bridge")
    parser.add_argument("--simulate", action="store_true", help="Run in self-contained hardware simulation mode")
    parser.add_argument("--broker", type=str, default=DEFAULT_BROKER, help=f"MQTT broker host (default: {DEFAULT_BROKER})")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"MQTT broker port (default: {DEFAULT_PORT})")
    parser.add_argument("--topic", type=str, default=DEFAULT_SENSOR_TOPIC, help=f"MQTT topic (default: {DEFAULT_SENSOR_TOPIC})")

    args = parser.parse_args()

    if args.simulate:
        run_simulator(broker=args.broker, port=args.port, topic=args.topic)
    else:
        run_mqtt_listener(broker=args.broker, port=args.port, topic=args.topic)
