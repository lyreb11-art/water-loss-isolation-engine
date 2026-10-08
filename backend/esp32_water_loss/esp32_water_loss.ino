/*
 * ESP32 Water Loss Detection Engine - Dual Flow Sensor Firmware
 * -------------------------------------------------------------
 * Hardware Connections:
 *  - Flow Sensor 1 (Inlet):  Signal (Yellow) -> GPIO 18 (D18)
 *  - Flow Sensor 2 (Outlet): Signal (Yellow) -> GPIO 19 (D19)
 *  - Relay Module:           IN -> GPIO 23 (D23)
 *  - Active Buzzer:          +  -> GPIO 5  (D5)
 *  - All VCC / Red Wires:    -> Breadboard Red (+) Rail (5V / VIN)
 *  - All GND / Black Wires:  -> Breadboard Blue (-) Rail (GND)
 */

#include <WiFi.h>
#include <PubSubClient.h>

// ==========================================
// 1. WiFi & MQTT CONFIGURATION
// ==========================================
// REPLACE WITH YOUR PHONE HOTSPOT OR HOME WIFI
const char* WIFI_SSID     = "AK";
const char* WIFI_PASSWORD = "12345678";

// HiveMQ Public Broker (matches your Python mqtt_bridge.py)
const char* MQTT_BROKER   = "broker.hivemq.com";
const int   MQTT_PORT     = 1883;

// Topics
const char* TOPIC_SENSOR  = "waterloss/hardware/sensor";
const char* TOPIC_VALVE   = "waterloss/hardware/valve";

// ==========================================
// 2. PIN DEFINITIONS
// ==========================================
const int PIN_FLOW_INLET  = 18;  // Flow Sensor 1 Signal (D18)
const int PIN_FLOW_OUTLET = 19;  // Flow Sensor 2 Signal (D19)
const int PIN_RELAY       = 23;  // Relay IN (D23)
const int PIN_BUZZER      = 5;   // Buzzer + (D5)

// ==========================================
// 3. VARIABLES & INTERRUPT COUNTERS
// ==========================================
volatile unsigned long pulseCountInlet  = 0;
volatile unsigned long pulseCountOutlet = 0;

// Calibration factor: YF-S201 produces ~7.5 pulses per second per L/min
const float CALIBRATION_FACTOR = 7.5; 

unsigned long previousMillis = 0;
const unsigned long INTERVAL = 1000; // Sample every 1 second

bool valveClosed = false;

WiFiClient espClient;
PubSubClient client(espClient);

// Interrupt Service Routines (count pulses on rising edge)
void IRAM_ATTR pulseCounterInlet() {
  pulseCountInlet++;
}

void IRAM_ATTR pulseCounterOutlet() {
  pulseCountOutlet++;
}

// ==========================================
// 4. MQTT CALLBACK (REMOTE SHUTOFF COMMANDS)
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
    if (message.indexOf("CLOSE") >= 0 || message.indexOf("true") >= 0 || message.indexOf("SHUT") >= 0) {
      valveClosed = true;
      digitalWrite(PIN_RELAY, HIGH);  // Trigger relay to isolate line
      digitalWrite(PIN_BUZZER, HIGH); // Alarm sounds
      Serial.println(">>> [ACTION] REMOTE VALVE SHUTOFF TRIGGERED! Relay ON, Buzzer ON.");
    } else if (message.indexOf("OPEN") >= 0 || message.indexOf("false") >= 0) {
      valveClosed = false;
      digitalWrite(PIN_RELAY, LOW);
      digitalWrite(PIN_BUZZER, LOW);
      Serial.println(">>> [ACTION] VALVE RESET TO OPEN. Relay OFF, Buzzer OFF.");
    }
  }
}

// ==========================================
// 5. SETUP
// ==========================================
void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n==============================================");
  Serial.println("   Water Loss Isolation Engine - ESP32 Boot   ");
  Serial.println("==============================================");

  // Setup Outputs
  pinMode(PIN_RELAY, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  digitalWrite(PIN_RELAY, LOW);   // Normal open state
  digitalWrite(PIN_BUZZER, LOW);  // Buzzer silent

  // Setup Sensor Inputs with Pullup
  pinMode(PIN_FLOW_INLET, INPUT_PULLUP);
  pinMode(PIN_FLOW_OUTLET, INPUT_PULLUP);

  // Attach Interrupts to count turbine pulses
  attachInterrupt(digitalPinToInterrupt(PIN_FLOW_INLET), pulseCounterInlet, RISING);
  attachInterrupt(digitalPinToInterrupt(PIN_FLOW_OUTLET), pulseCounterOutlet, RISING);

  // Connect to WiFi
  connectWiFi();

  // Setup MQTT
  client.setServer(MQTT_BROKER, MQTT_PORT);
  client.setCallback(mqttCallback);

  Serial.println("[READY] System initialized. Ready to measure flow.");
}

void connectWiFi() {
  Serial.print("[WIFI] Connecting to ");
  Serial.print(WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int retries = 0;
  while (WiFi.status() != WL_CONNECTED && retries < 20) {
    delay(500);
    Serial.print(".");
    retries++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WIFI] Connected! IP Address: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\n[WIFI WARNING] WiFi connection timed out. Will retry in loop.");
  }
}

void reconnectMQTT() {
  while (!client.connected()) {
    Serial.print("[MQTT] Attempting connection to HiveMQ...");
    String clientId = "ESP32-WaterLoss-" + String(random(0xffff), HEX);
    if (client.connect(clientId.c_str())) {
      Serial.println(" Connected!");
      client.subscribe(TOPIC_VALVE);
      Serial.print("[MQTT] Subscribed to valve command topic: ");
      Serial.println(TOPIC_VALVE);
    } else {
      Serial.print(" Failed, rc=");
      Serial.print(client.state());
      Serial.println(" Retrying in 2 seconds...");
      delay(2000);
      break;
    }
  }
}

// ==========================================
// 6. MAIN LOOP
// ==========================================
void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }

  if (!client.connected()) {
    reconnectMQTT();
  }
  client.loop();

  unsigned long currentMillis = millis();
  if (currentMillis - previousMillis >= INTERVAL) {
    previousMillis = currentMillis;

    // Grab pulse counts safely
    noInterrupts();
    unsigned long pulses1 = pulseCountInlet;
    unsigned long pulses2 = pulseCountOutlet;
    pulseCountInlet = 0;
    pulseCountOutlet = 0;
    interrupts();

    // Calculate flow rate in Liters/minute
    // Flow Rate (L/min) = (Pulses per second) / 7.5
    float flowRate1 = ((float)pulses1) / CALIBRATION_FACTOR;
    float flowRate2 = ((float)pulses2) / CALIBRATION_FACTOR;

    // Detect mismatch %
    float diffPct = 0.0;
    if (flowRate1 > 0.05) {
      diffPct = ((flowRate1 - flowRate2) / flowRate1) * 100.0;
      if (diffPct < 0) diffPct = 0;
    }

    // Local buzzer alarm if severe mismatch (> 20% loss)
    if (flowRate1 > 0.1 && diffPct > 20.0 && !valveClosed) {
      digitalWrite(PIN_BUZZER, HIGH); // Alarm ON
    } else if (!valveClosed) {
      digitalWrite(PIN_BUZZER, LOW);  // Alarm OFF
    }

    // Print to Serial Monitor
    Serial.print("[FLOW] Inlet: ");
    Serial.print(flowRate1, 2);
    Serial.print(" L/min | Outlet: ");
    Serial.print(flowRate2, 2);
    Serial.print(" L/min | Mismatch: ");
    Serial.print(diffPct, 1);
    Serial.println("%");

    // Publish JSON to MQTT topic
    // Expected format: {"flow_in": 3.4, "flow_out": 2.1, "valve_closed": false}
    String jsonPayload = "{";
    jsonPayload += "\"flow_in\":" + String(flowRate1, 2) + ",";
    jsonPayload += "\"flow_out\":" + String(flowRate2, 2) + ",";
    jsonPayload += "\"valve_closed\":" + String(valveClosed ? "true" : "false");
    jsonPayload += "}";

    if (client.connected()) {
      client.publish(TOPIC_SENSOR, jsonPayload.c_str());
      Serial.print("  -> Published to [");
      Serial.print(TOPIC_SENSOR);
      Serial.print("]: ");
      Serial.println(jsonPayload);
    }
  }
}
