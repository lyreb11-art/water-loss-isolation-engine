/*
 * ESP32 Water Loss Isolation Engine - Dual Flow Sensor Firmware
 * =============================================================
 * Connections:
 *   Flow Sensor 1 (Inlet)  signal -> D18
 *   Flow Sensor 2 (Outlet) signal -> D19
 *   Relay IN               -> D23   (relay VCC -> VIN, relay GND -> GND)
 *   Buzzer +               -> D5    (buzzer - -> GND)
 *   Green LED +            -> D21   (through resistor, - to GND)
 *   Red LED +              -> D22   (through resistor, - to GND)
 *
 * Pump power:
 *   Buck OUT+ -> toggle switch -> relay COM
 *   Relay NC  -> pump red wire (+)
 *   Buck OUT- -> pump black wire (-)
 *
 * Relay (confirmed by your test):
 *   Relay ON  (green LED on relay) -> pump STOPS
 *   Relay OFF                      -> pump RUNS
 *
 * Thresholds:
 *   Normal : loss < 2%      -> GREEN LED
 *   Leak   : loss 2-10%     -> RED LED only
 *   Theft  : loss > 10%     -> RED LED + Buzzer + Relay ON (pump stops)
 *
 * START THE PUMP WITH THE THEFT TAP (blue valve) CLOSED.
 * The first ~10 seconds of flow are used to learn the sensor difference.
 *
 * Shutdown is LATCHED. Send MQTT "RESET" or press the ESP32 EN button.
 */

#include <WiFi.h>
#include <PubSubClient.h>

// enum is at the top so the Arduino IDE finds it
enum SystemState {
  STATE_STARTUP,
  STATE_IDLE,
  STATE_NORMAL,
  STATE_LEAK,
  STATE_ISOLATED
};

// ==========================================
// 1. WiFi & MQTT CONFIGURATION
// ==========================================
const char* WIFI_SSID     = "AK";
const char* WIFI_PASSWORD = "12345678";

const char* MQTT_BROKER   = "broker.hivemq.com";
const int   MQTT_PORT     = 1883;

const char* TOPIC_SENSOR  = "waterloss/hardware/sensor";
const char* TOPIC_VALVE   = "waterloss/hardware/valve";

// ==========================================
// 2. PIN DEFINITIONS
// ==========================================
const int PIN_FLOW_INLET  = 18;
const int PIN_FLOW_OUTLET = 19;
const int PIN_RELAY       = 23;
const int PIN_BUZZER      = 5;
const int PIN_LED_GREEN   = 21;
const int PIN_LED_RED     = 22;

// Relay turns ON when the pin is pulled LOW, OFF when the pin is released.
void relayCutPower() {            // relay ON -> pump stops
  pinMode(PIN_RELAY, OUTPUT);
  digitalWrite(PIN_RELAY, LOW);
}

void relayNormal() {              // relay OFF -> pump runs
  pinMode(PIN_RELAY, INPUT);
}

// ==========================================
// 3. CALIBRATION & THRESHOLDS
// ==========================================
// Both sensors use the same value. This only affects the L/min numbers shown.
// Theft detection uses the ratio between the sensors, learned automatically.
const float CALIBRATION_INLET  = 15.0;
const float CALIBRATION_OUTLET = 15.0;

const float NORMAL_RATIO = 0.98;   // above this = Normal (< 2% loss)
const float THEFT_RATIO  = 0.90;   // below this = Theft  (> 10% loss)
// between 0.90 and 0.98 = Leak

const float MIN_ACTIVE_FLOW = 0.8;  // L/min

// Baseline learning
const int   BASELINE_SAMPLES      = 8;    // seconds of steady flow to learn from
const unsigned long MIN_BASELINE_PULSES = 15;  // min pulses/second on BOTH sensors
float pulseScale     = 1.0;   // outlet pulses are multiplied by this
bool  baselineReady  = false;
float baselineSum    = 0.0;
float baselineMin    = 0.0;
float baselineMax    = 0.0;
int   baselineCount  = 0;

// CHANGED: sane range for the learned inlet/outlet pulse ratio (tap CLOSED)
const float BASELINE_MIN_SCALE = 0.40;
const float BASELINE_MAX_SCALE = 0.70;

// ==========================================
// 4. RUNTIME STATE
// ==========================================
volatile unsigned long pulseCountInlet  = 0;
volatile unsigned long pulseCountOutlet = 0;

const float EMA_ALPHA = 0.4;
float emaFlowIn  = 0.0;
float emaFlowOut = 0.0;
bool  emaInitialized = false;

unsigned long previousMillis = 0;
const unsigned long SAMPLE_INTERVAL_MS = 1000;

SystemState currentState = STATE_STARTUP;
bool isolationLatched = false;

WiFiClient espClient;
PubSubClient client(espClient);

// ==========================================
// 5. INTERRUPTS
// ==========================================
void IRAM_ATTR pulseCounterInlet()  { pulseCountInlet++; }
void IRAM_ATTR pulseCounterOutlet() { pulseCountOutlet++; }

// ==========================================
// 6. BUZZER
// ==========================================
void soundAlarm(bool enable) {
  digitalWrite(PIN_BUZZER, enable ? HIGH : LOW);
}

// ==========================================
// 7. LEDs
// ==========================================
void setLEDs(bool green, bool red) {
  digitalWrite(PIN_LED_GREEN, green ? HIGH : LOW);
  digitalWrite(PIN_LED_RED, red ? HIGH : LOW);
}

// Boot self-test so you can see the LEDs and buzzer work
void selfTest() {
  Serial.println("[SELFTEST] Green LED...");
  digitalWrite(PIN_LED_GREEN, HIGH); delay(800); digitalWrite(PIN_LED_GREEN, LOW);
  Serial.println("[SELFTEST] Red LED...");
  digitalWrite(PIN_LED_RED, HIGH);   delay(800); digitalWrite(PIN_LED_RED, LOW);
  Serial.println("[SELFTEST] Buzzer...");
  digitalWrite(PIN_BUZZER, HIGH);    delay(300); digitalWrite(PIN_BUZZER, LOW);
  Serial.println("[SELFTEST] Done.");
}

// ==========================================
// 8. STATE TRANSITIONS
// ==========================================
void enterState(SystemState newState) {
  if (newState == currentState) return;

  currentState = newState;
  switch (newState) {

    case STATE_STARTUP:
      setLEDs(false, false);
      soundAlarm(false);
      if (!isolationLatched) relayNormal();
      Serial.println("[STATE] -> STARTUP (learning sensor baseline, LEDs OFF)");
      break;

    case STATE_IDLE:
      setLEDs(false, false);
      soundAlarm(false);
      if (!isolationLatched) relayNormal();
      Serial.println("[STATE] -> IDLE (pump off, all LEDs OFF)");
      break;

    case STATE_NORMAL:
      setLEDs(true, false);
      soundAlarm(false);
      if (!isolationLatched) relayNormal();
      Serial.println("[STATE] -> NORMAL (Green LED ON, diff < 2%)");
      break;

    case STATE_LEAK:
      setLEDs(false, true);
      soundAlarm(false);
      if (!isolationLatched) relayNormal();
      Serial.println("[STATE] -> LEAK (Red LED ON, buzzer OFF, diff 2-10%)");
      break;

    case STATE_ISOLATED:
      setLEDs(false, true);
      soundAlarm(true);
      isolationLatched = true;
      relayCutPower();
      Serial.println("\n****************************************************");
      Serial.println(">>> [THEFT] PUMP CUT! Outlet < 90% of inlet (>10% loss).");
      Serial.println(">>> RED LED ON + Buzzer ON + Relay ON.");
      Serial.println(">>> Send MQTT 'RESET' to restore pump power.");
      Serial.println("****************************************************\n");
      break;
  }
}

// ==========================================
// 9. MQTT COMMANDS
// ==========================================
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String message = "";
  for (unsigned int i = 0; i < length; i++) {
    message += (char)payload[i];
  }
  Serial.print("[MQTT RECEIVED] Topic: ");
  Serial.print(topic);
  Serial.print(" | Message: ");
  Serial.println(message);

  if (String(topic) == TOPIC_VALVE) {
    if (message.indexOf("CLOSE") >= 0 || message.indexOf("SHUT") >= 0) {
      enterState(STATE_ISOLATED);
      Serial.println(">>> [MQTT] Remote CLOSE command -> Pump ISOLATED.");
    }
    else if (message.indexOf("RESET") >= 0) {
      isolationLatched = false;
      baselineReady = false;
      baselineCount = 0;
      baselineSum = 0.0;
      relayNormal();
      soundAlarm(false);
      enterState(STATE_STARTUP);
      Serial.println(">>> [MQTT] RESET command -> Isolation cleared, relearning baseline.");
    }
    else if (message.indexOf("OPEN") >= 0 || message.indexOf("false") >= 0) {
      if (!isolationLatched) {
        enterState(baselineReady ? STATE_NORMAL : STATE_STARTUP);
        Serial.println(">>> [MQTT] OPEN command (not latched).");
      } else {
        Serial.println(">>> [MQTT] OPEN ignored - isolation is LATCHED. Send 'RESET' to clear.");
      }
    }
  }
}

// ==========================================
// 10. SETUP
// ==========================================
void connectWiFi();

void setup() {
  relayNormal();   // relay OFF first (pump runs)

  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_LED_GREEN, OUTPUT);
  pinMode(PIN_LED_RED, OUTPUT);

  digitalWrite(PIN_BUZZER, LOW);
  digitalWrite(PIN_LED_GREEN, LOW);
  digitalWrite(PIN_LED_RED, LOW);

  Serial.begin(115200);
  delay(300);
  Serial.println("\n==============================================");
  Serial.println("   Water Loss Isolation Engine - ESP32 Boot   ");
  Serial.println("==============================================");

  selfTest();   // green LED, red LED, then buzzer beep

  Serial.println("[BOOT] Relay OFF (pump runs).");

  pinMode(PIN_FLOW_INLET, INPUT_PULLUP);
  pinMode(PIN_FLOW_OUTLET, INPUT_PULLUP);

  attachInterrupt(digitalPinToInterrupt(PIN_FLOW_INLET), pulseCounterInlet, CHANGE);
  attachInterrupt(digitalPinToInterrupt(PIN_FLOW_OUTLET), pulseCounterOutlet, CHANGE);

  client.setServer(MQTT_BROKER, MQTT_PORT);
  client.setCallback(mqttCallback);
  client.setBufferSize(512);
  client.setKeepAlive(15);

  connectWiFi();

  currentState = STATE_STARTUP;
  Serial.println("[READY] Start the pump with the theft tap CLOSED.");
  Serial.println("[READY] Learning sensor baseline for ~10 seconds of flow...");
  Serial.print("[CONFIG] Normal: >=");
  Serial.print(NORMAL_RATIO * 100, 0);
  Serial.print("% | Leak: 90-98% | Theft: <");
  Serial.print(THEFT_RATIO * 100, 0);
  Serial.println("%");
}

void connectWiFi() {
  Serial.print("\n[WIFI] Connecting to: ");
  Serial.println(WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 15) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WIFI] Connected!");
    Serial.print("[WIFI] IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\n[WIFI WARN] Not connected. Local detection still active.");
  }
}

void checkMQTT() {
  if (WiFi.status() != WL_CONNECTED) return;

  if (!client.connected()) {
    static unsigned long lastMqttAttempt = 0;
    unsigned long now = millis();
    if (now - lastMqttAttempt >= 6000) {
      lastMqttAttempt = now;
      String clientId = "ESP32_WL_" + String(random(0xffff), HEX);
      Serial.print("[MQTT] Connecting... ");
      if (client.connect(clientId.c_str())) {
        Serial.println("CONNECTED!");
        client.subscribe(TOPIC_VALVE);
        Serial.print("[MQTT] Subscribed: ");
        Serial.println(TOPIC_VALVE);
      } else {
        Serial.print("FAILED (rc=");
        Serial.print(client.state());
        Serial.println("). Retry in 6s.");
      }
    }
  } else {
    client.loop();
  }
}

void checkWiFi() {
  if (WiFi.status() != WL_CONNECTED) {
    static unsigned long lastWifiAttempt = 0;
    unsigned long now = millis();
    if (now - lastWifiAttempt >= 12000) {
      lastWifiAttempt = now;
      Serial.println("[WIFI] Reconnecting...");
      WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    }
  }
}

// ==========================================
// 11. MAIN LOOP
// ==========================================
void loop() {
  checkWiFi();
  checkMQTT();

  unsigned long currentMillis = millis();
  if (currentMillis - previousMillis < SAMPLE_INTERVAL_MS) return;

  unsigned long elapsedTime = currentMillis - previousMillis;
  previousMillis = currentMillis;

  noInterrupts();
  unsigned long pulses1 = pulseCountInlet;
  unsigned long pulses2 = pulseCountOutlet;
  pulseCountInlet  = 0;
  pulseCountOutlet = 0;
  interrupts();

  // Outlet pulses are corrected by the learned baseline scale
  float elapsedSec  = (float)elapsedTime / 1000.0;
  float rawFlowIn   = ((float)pulses1 / elapsedSec) / CALIBRATION_INLET;
  float rawFlowOut  = (((float)pulses2 * pulseScale) / elapsedSec) / CALIBRATION_OUTLET;

  if (!emaInitialized) {
    emaFlowIn  = rawFlowIn;
    emaFlowOut = rawFlowOut;
    emaInitialized = true;
  } else {
    emaFlowIn  = EMA_ALPHA * rawFlowIn  + (1.0 - EMA_ALPHA) * emaFlowIn;
    emaFlowOut = EMA_ALPHA * rawFlowOut + (1.0 - EMA_ALPHA) * emaFlowOut;
  }

  float flowIn  = emaFlowIn;
  float flowOut = emaFlowOut;

  float outletRatio = 1.0;
  float diffPct     = 0.0;
  if (flowIn > 0.1) {
    outletRatio = flowOut / flowIn;
    diffPct     = (1.0 - outletRatio) * 100.0;
    if (diffPct < 0.0) diffPct = 0.0;
  }

  bool flowActive = (flowIn > MIN_ACTIVE_FLOW || flowOut > MIN_ACTIVE_FLOW);
  String status   = "startup";

  // ---------------- STATE MACHINE ----------------
  if (isolationLatched) {
    setLEDs(false, true);
    soundAlarm(true);
    relayCutPower();
    currentState = STATE_ISOLATED;
    status = "isolated";

  } else {
    switch (currentState) {

      // Learn the inlet/outlet pulse ratio while water flows normally
      case STATE_STARTUP:
        if (pulses1 >= MIN_BASELINE_PULSES && pulses2 >= MIN_BASELINE_PULSES) {
          float r = (float)pulses1 / (float)pulses2;   // inlet / outlet

          if (baselineCount == 0) {
            baselineMin = r;
            baselineMax = r;
            baselineSum = 0.0;
          }
          if (r < baselineMin) baselineMin = r;
          if (r > baselineMax) baselineMax = r;
          baselineSum += r;
          baselineCount++;

          Serial.print("[BASELINE] Sample ");
          Serial.print(baselineCount);
          Serial.print("/");
          Serial.print(BASELINE_SAMPLES);
          Serial.print(" ratio=");
          Serial.println(r, 3);

          if (baselineMax / baselineMin > 1.25) {
            Serial.println("[BASELINE] Flow unsteady, restarting...");
            baselineCount = 0;
            baselineSum = 0.0;
          } else if (baselineCount >= BASELINE_SAMPLES) {
            // CHANGED: reject a baseline that looks wrong (e.g. tap was open)
            float candidate = baselineSum / (float)baselineCount;
            if (candidate < BASELINE_MIN_SCALE || candidate > BASELINE_MAX_SCALE) {
              Serial.print("[BASELINE] Rejected, ratio ");
              Serial.print(candidate, 3);
              Serial.println(" looks wrong. Close the theft tap and press EN.");
              baselineCount = 0;
              baselineSum = 0.0;
            } else {
              pulseScale = candidate;
              baselineReady = true;
              emaInitialized = false;   // restart the filter with the new scale
              Serial.print("[BASELINE] Learned. Outlet scale = ");
              Serial.println(pulseScale, 3);
              enterState(STATE_NORMAL);
            }
          }
        } else {
          baselineCount = 0;
          baselineSum = 0.0;
        }
        status = "startup";
        break;

      case STATE_IDLE:
        if (flowActive) {
          baselineReady = false;
          baselineCount = 0;
          baselineSum = 0.0;
          enterState(STATE_STARTUP);
        }
        status = "idle";
        break;

      case STATE_NORMAL:
        if (!flowActive) {
          enterState(STATE_IDLE);
          status = "idle";
        } else if (outletRatio < THEFT_RATIO) {
          Serial.print(">>> [THEFT] Outlet ratio: ");
          Serial.print(outletRatio * 100.0, 1);
          Serial.print("% (diff: ");
          Serial.print(diffPct, 1);
          Serial.println("%) ISOLATING PUMP!");
          enterState(STATE_ISOLATED);
          status = "isolated";
        } else if (outletRatio < NORMAL_RATIO) {
          Serial.print(">>> [LEAK] Outlet ratio: ");
          Serial.print(outletRatio * 100.0, 1);
          Serial.print("% (diff: ");
          Serial.print(diffPct, 1);
          Serial.println("%) Red LED ON, pump still running.");
          enterState(STATE_LEAK);
          status = "leak";
        } else {
          status = "normal";
        }
        break;

      case STATE_LEAK:
        if (!flowActive) {
          enterState(STATE_IDLE);
          status = "idle";
        } else if (outletRatio < THEFT_RATIO) {
          Serial.print(">>> [LEAK->THEFT] Outlet ratio: ");
          Serial.print(outletRatio * 100.0, 1);
          Serial.println("% ISOLATING PUMP!");
          enterState(STATE_ISOLATED);
          status = "isolated";
        } else if (outletRatio >= NORMAL_RATIO) {
          Serial.println(">>> [RECOVERED] Back to normal flow.");
          enterState(STATE_NORMAL);
          status = "normal";
        } else {
          status = "leak";
        }
        break;

      case STATE_ISOLATED:
        status = "isolated";
        break;
    }
  }

  // ---------------- SERIAL OUTPUT ----------------
  Serial.print("[FLOW] In: ");
  Serial.print(flowIn, 2);
  Serial.print(" L/m (");
  Serial.print(pulses1);
  Serial.print("p) | Out: ");
  Serial.print(flowOut, 2);
  Serial.print(" L/m (");
  Serial.print(pulses2);
  Serial.print("p) | Diff: ");
  Serial.print(diffPct, 1);
  Serial.print("% | Ratio: ");
  Serial.print(outletRatio * 100.0, 1);
  Serial.print("% | State: ");
  Serial.println(status);

  // ---------------- MQTT JSON ----------------
  String jsonPayload = "{";
  jsonPayload += "\"flow_in\":"    + String(flowIn, 2)  + ",";
  jsonPayload += "\"flow_out\":"   + String(flowOut, 2) + ",";
  jsonPayload += "\"diff_pct\":"   + String(diffPct, 1) + ",";
  jsonPayload += "\"outlet_ratio\":" + String(outletRatio * 100.0, 1) + ",";
  jsonPayload += "\"valve_closed\":" + String(isolationLatched ? "true" : "false") + ",";
  jsonPayload += "\"status\":\""    + status + "\"";
  jsonPayload += "}";

  Serial.print("[DATA] ");
  Serial.println(jsonPayload);

  if (client.connected()) {
    if (client.publish(TOPIC_SENSOR, jsonPayload.c_str())) {
      Serial.print("  -> [MQTT PUBLISHED] ");
      Serial.println(jsonPayload);
    }
  }
}