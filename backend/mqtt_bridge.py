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
import threading
import time
import requests
import paho.mqtt.client as mqtt
import db

try:
    import serial
    import serial.tools.list_ports
    HAS_SERIAL = True
except ImportError:
    HAS_SERIAL = False

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(line_buffering=True)

# Default Configuration
DEFAULT_BROKER = "broker.hivemq.com"
DEFAULT_PORT = 1883
DEFAULT_SENSOR_TOPIC = "waterloss/hardware/sensor"
DEFAULT_VALVE_TOPIC = "waterloss/hardware/valve"
BACKEND_URL = "http://localhost:8000/api/live"


def classify_flow_mismatch(flow_in: float, flow_out: float, valve_closed: bool = False,
                           status: str = None):
    """Classifies flow reading. Thresholds match ESP32 firmware exactly:
      - Normal : diff <  2%  (outlet >= 98% of inlet)  -> GREEN LED
      - Leak   : diff 2-10%  (outlet 90-98% of inlet)  -> RED LED, pump running
      - Theft  : diff > 10%  (outlet <  90% of inlet)  -> RED LED + Buzzer + Relay TRIPS
    """
    # If firmware already classified it, trust that directly
    if status == "isolated":
        return 0.0, "Isolated", 1.0
    if status == "leak":
        diff_pct = max(0.0, ((flow_in - flow_out) / flow_in) * 100.0) if flow_in > 0 else 0.0
        return round(diff_pct, 2), "Leak", 0.95
    if status == "theft" or (valve_closed and status not in (None, "normal")):
        diff_pct = max(0.0, ((flow_in - flow_out) / flow_in) * 100.0) if flow_in > 0 else 0.0
        return round(diff_pct, 2), "Theft", 0.97

    if valve_closed:
        return 0.0, "Isolated", 1.0

    if flow_in <= 0.05 and flow_out <= 0.05:
        return 0.0, "Normal", 0.99

    if flow_in <= 0:
        return 0.0, "Normal", 0.99

    # diff % = how much outlet is BELOW inlet
    diff_pct = max(0.0, ((flow_in - flow_out) / flow_in) * 100.0)

    if diff_pct < 2.0:
        classification = "Normal"
        confidence = 0.99
    elif diff_pct < 10.0:
        classification = "Leak"
        confidence = 0.93
    else:
        classification = "Theft"
        confidence = 0.97

    return round(diff_pct, 2), classification, round(min(0.99, confidence), 2)


_last_idle_time = 0.0

def process_and_store_reading(flow_in: float, flow_out: float, valve_closed: bool = False):
    """Classifies flow reading and stores it in database & sends to backend API."""
    global _last_idle_time
    now = time.time()

    # If completely idle (0.0, 0.0), record a heartbeat only once every 4 seconds
    # When active flow is detected, record EVERY reading instantly!
    is_idle = (flow_in <= 0.05 and flow_out <= 0.05 and not valve_closed)
    if is_idle:
        if now - _last_idle_time < 4.0:
            return None
        _last_idle_time = now

    diff_pct, classification, confidence = classify_flow_mismatch(flow_in, flow_out, valve_closed)

    payload = {
        "flow_in": flow_in,
        "flow_out": flow_out,
        "diff_pct": diff_pct,
        "classification": classification,
        "confidence": confidence,
        "valve_closed": valve_closed,
    }

    # Post to backend REST API (main.py's /api/live will persist to DB, preventing duplicate rows)
    posted = False
    try:
        res = requests.post(BACKEND_URL, json=payload, timeout=2)
        if res.status_code == 200:
            posted = True
            print(f"[OK] Telemetry -> Flow IN: {flow_in:.1f} L/m | OUT: {flow_out:.1f} L/m | Diff: {diff_pct:.1f}% | {classification}")
    except Exception:
        pass

    # If backend API is not running, save directly to local SQLite database
    if not posted:
        try:
            db.add_live_reading(
                flow_in=flow_in,
                flow_out=flow_out,
                diff_pct=diff_pct,
                classification=classification,
                confidence=confidence,
                valve_closed=valve_closed,
            )
            print(f"[LOCAL DB] Saved to DB -> Flow IN: {flow_in:.1f} L/m | OUT: {flow_out:.1f} L/m | Diff: {diff_pct:.1f}%")
        except Exception as e:
            print(f"[WARN] DB insert warning: {e}")

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


def run_serial_reader():
    """Reads telemetry lines from ESP32 USB COM port directly."""
    if not HAS_SERIAL:
        print("[SERIAL] pyserial not available, USB direct mode disabled.")
        return

    print("[SERIAL] Starting USB Serial listener thread (auto-scanning for ESP32)...")
    while True:
        target_port = None
        try:
            ports = list(serial.tools.list_ports.comports())
            for p in ports:
                desc = (p.description or "").lower()
                # Match Silicon Labs CP210x, CH340, USB-to-UART, or COM5
                if "cp210" in desc or "ch340" in desc or "uart" in desc or p.device == "COM5":
                    target_port = p.device
                    break

            if not target_port and ports:
                for p in ports:
                    if "bluetooth" not in (p.description or "").lower():
                        target_port = p.device
                        break

            if not target_port:
                time.sleep(3)
                continue

            with serial.Serial(target_port, 115200, timeout=1.5) as ser:
                print(f"[SERIAL OK] Connected directly to ESP32 on {target_port} (115200 baud)!")
                while True:
                    raw = ser.readline()
                    if not raw:
                        continue
                    line = raw.decode("utf-8", errors="ignore").strip()
                    if not line:
                        continue

                    # Look for [DATA] {...} or standalone JSON
                    data_str = None
                    if "[DATA]" in line:
                        data_str = line.split("[DATA]", 1)[1].strip()
                    elif line.startswith("{") and "flow_in" in line:
                        data_str = line

                    if data_str:
                        try:
                            d = json.loads(data_str)
                            flow_in = float(d.get("flow_in", 0))
                            flow_out = float(d.get("flow_out", 0))
                            valve_closed = bool(d.get("valve_closed", False))
                            process_and_store_reading(flow_in, flow_out, valve_closed)
                        except Exception:
                            pass
        except serial.SerialException:
            # Port busy (e.g. Arduino Serial Monitor open) or disconnected
            time.sleep(2)
        except Exception as e:
            time.sleep(2)


def run_mqtt_listener(broker: str, port: int, topic: str, use_serial: bool = False):
    """Connects to MQTT Broker and listens for messages continuously."""
    db.init_db()

    # Start background USB Serial auto-scanner ONLY if explicitly requested
    if use_serial and HAS_SERIAL:
        serial_thread = threading.Thread(target=run_serial_reader, daemon=True)
        serial_thread.start()
        print("[BRIDGE] USB Serial reader enabled (locks COM port).")
    else:
        print("[BRIDGE] Pure MQTT mode active. COM ports remain free for Arduino IDE!")

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

    parser.add_argument("--serial", action="store_true", help="Also attach to USB COM port (warning: locks COM port from Arduino IDE)")

    args = parser.parse_args()

    if args.simulate:
        run_simulator(broker=args.broker, port=args.port, topic=args.topic)
    else:
        run_mqtt_listener(broker=args.broker, port=args.port, topic=args.topic, use_serial=args.serial)
