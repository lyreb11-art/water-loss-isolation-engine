import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchLiveReadings, addLiveReading, controlValve } from '../api'
import { calculateFinancialLoss, generateAIDiagnosis } from '../utils/aiDiagnostics'

export default function HardwareLive() {
  const nav = useNavigate()
  const [readings, setReadings] = useState([])
  const [loading, setLoading] = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [filterActiveOnly, setFilterActiveOnly] = useState(false)
  const [lastActiveServer, setLastActiveServer] = useState(null)
  const [lastUpdated, setLastUpdated] = useState('')
  const [toast, setToast] = useState('')

  // USB Web Serial connection state (for direct COM5 connection)
  const [serialConnected, setSerialConnected] = useState(false)
  const [swapSensors, setSwapSensors] = useState(false)
  const serialPortRef = useRef(null)
  const serialReaderRef = useRef(null)

  // Form states for manual or preset trigger
  const [customFlowIn, setCustomFlowIn] = useState('20.0')
  const [customFlowOut, setCustomFlowOut] = useState('19.5')
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Fetch readings from backend
  async function loadLiveReadings() {
    try {
      const data = await fetchLiveReadings(50)
      if (data && data.readings) {
        setReadings(data.readings)
        if (data.latest_active) {
          setLastActiveServer(data.latest_active)
        }
        setLastUpdated(new Date().toLocaleTimeString())
      }
    } catch (err) {
      console.error('Failed to fetch live readings:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadLiveReadings()
  }, [])

  // Auto-refresh interval (every 1 second for live hardware telemetry)
  useEffect(() => {
    if (!autoRefresh) return
    const interval = setInterval(() => {
      loadLiveReadings()
    }, 1000)
    return () => clearInterval(interval)
  }, [autoRefresh])

  // Latest reading & most recent active flow event
  const latest = readings.length > 0 ? readings[0] : null
  const latestActive = (readings.find((r) => r.flow_in > 0.05 || r.flow_out > 0.05)) || lastActiveServer || null
  const valveClosed = latest ? Boolean(latest.valve_closed) : false

  // Filtered readings for table
  const displayedReadings = filterActiveOnly
    ? readings.filter((r) => r.flow_in > 0.05 || r.flow_out > 0.05)
    : readings

  // Financial & AI diagnosis calculations for latest hardware telemetry
  const financial = latest ? calculateFinancialLoss(latest.diff_pct, latest.flow_in) : calculateFinancialLoss(0, 0)
  const diagnosis = latest ? generateAIDiagnosis(latest) : null

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 3500)
  }

  // Web Serial connect/disconnect logic
  async function connectSerial() {
    if (!('serial' in navigator)) {
      showToast('⚠️ Web Serial not supported in this browser. Please use Chrome or Edge.')
      return
    }
    try {
      const port = await navigator.serial.requestPort()
      await port.open({ baudRate: 115200 })
      serialPortRef.current = port
      setSerialConnected(true)
      showToast('✅ USB Serial connected (115200 baud)!')
      readSerialLoop(port)
    } catch (err) {
      if (err.name === 'NotFoundError') return
      showToast('⚠️ Port busy: Close Arduino IDE Serial Monitor first!')
      console.error(err)
    }
  }

  async function disconnectSerial() {
    try {
      if (serialReaderRef.current) {
        await serialReaderRef.current.cancel()
      }
      if (serialPortRef.current) {
        await serialPortRef.current.close()
      }
    } catch (e) {
      console.warn(e)
    }
    setSerialConnected(false)
    showToast('🔌 USB Serial disconnected')
  }

  async function readSerialLoop(port) {
    const textDecoder = new TextDecoderStream()
    port.readable.pipeTo(textDecoder.writable).catch(() => {})
    const reader = textDecoder.readable.getReader()
    serialReaderRef.current = reader

    let buffer = ''
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += value
        const lines = buffer.split('\n')
        buffer = lines.pop()

        for (const line of lines) {
          const trimmed = line.trim()
          let dataStr = null
          if (trimmed.includes('[DATA]')) {
            dataStr = trimmed.split('[DATA]')[1].trim()
          } else if (trimmed.startsWith('{') && trimmed.includes('flow_in')) {
            dataStr = trimmed
          }

          if (dataStr) {
            try {
              const d = JSON.parse(dataStr)
              const fi = parseFloat(d.flow_in) || 0
              const fo = parseFloat(d.flow_out) || 0
              const diff = parseFloat(d.diff_pct) || 0
              const vc = Boolean(d.valve_closed)

              let classification = 'Normal'
              let confidence = 0.98
              if (vc) {
                classification = 'Isolated'
                confidence = 1.0
              } else if (d.status === 'isolated') {
                classification = 'Isolated'
                confidence = 1.0
              } else if (d.status === 'critical' || diff >= 50) {
                classification = 'Burst'
                confidence = 0.96
              } else if (d.status === 'leak' || diff >= 30) {
                classification = 'Theft'
                confidence = 0.93
              } else if (diff >= 15) {
                classification = 'Leak'
                confidence = 0.91
              }

              const newRow = {
                id: Date.now(),
                timestamp: new Date().toISOString(),
                flow_in: fi,
                flow_out: fo,
                diff_pct: diff,
                classification,
                confidence,
                valve_closed: vc ? 1 : 0,
              }

              setReadings((prev) => [newRow, ...prev.slice(0, 49)])
              if (fi > 0.05 || fo > 0.05) {
                setLastActiveServer(newRow)
              }
              setLastUpdated(new Date().toLocaleTimeString())
              addLiveReading(newRow).catch(() => {})
            } catch (jsonErr) {}
          }
        }
      }
    } catch (err) {
      console.warn('Serial loop ended:', err)
    } finally {
      setSerialConnected(false)
    }
  }

  // Handle manual or preset reading injection
  async function handleSendReading(flowInVal, flowOutVal, valveState = false, scenarioName = '') {
    setIsSubmitting(true)
    try {
      const rawIn = parseFloat(flowInVal) || 0
      const rawOut = parseFloat(flowOutVal) || 0
      const flowIn = swapSensors ? rawOut : rawIn
      const flowOut = swapSensors ? rawIn : rawOut

      // Symmetrical difference calculation
      const baseFlow = Math.max(flowIn, flowOut)
      const diffPct = baseFlow > 0 ? (Math.abs(flowIn - flowOut) / baseFlow) * 100 : 0

      let classification = 'Normal'
      let confidence = 0.98
      let finalValveClosed = valveState

      if (valveState) {
        classification = 'Isolated'
        confidence = 1.0
      } else if (diffPct >= 50) {
        classification = 'Burst'
        confidence = 0.96
        finalValveClosed = true
      } else if (diffPct >= 30) {
        classification = 'Theft'
        confidence = 0.93
        finalValveClosed = true // Auto-isolate pump on Theft (>= 30% loss)
      } else if (diffPct >= 15) {
        classification = 'Leak'
        confidence = 0.91
      }

      // Optimistic UI update for instant button responsiveness
      const newRow = {
        id: Date.now(),
        timestamp: new Date().toISOString(),
        flow_in: flowIn,
        flow_out: finalValveClosed ? 0.0 : flowOut,
        diff_pct: parseFloat(diffPct.toFixed(2)),
        classification,
        confidence,
        valve_closed: finalValveClosed ? 1 : 0,
      }
      setReadings((prev) => [newRow, ...prev.slice(0, 49)])
      if (flowIn > 0.05 || flowOut > 0.05) {
        setLastActiveServer(newRow)
      }
      setLastUpdated(new Date().toLocaleTimeString())

      // If anomaly reaches theft threshold, automatically trip the physical pump relay!
      if (finalValveClosed && !valveState) {
        try {
          await controlValve(true)
        } catch (e) {}
      }

      await addLiveReading({
        flow_in: flowIn,
        flow_out: finalValveClosed ? 0.0 : flowOut,
        diff_pct: parseFloat(diffPct.toFixed(2)),
        classification,
        confidence,
        valve_closed: finalValveClosed,
      })

      if (finalValveClosed && !valveState) {
        showToast(`🚨 AUTO-ISOLATION: ${classification} threshold reached (${diffPct.toFixed(1)}%)! Main Pump Power Halted.`)
      } else {
        showToast(scenarioName ? `✅ Sent preset: ${scenarioName}` : '✅ Reading posted successfully!')
      }
      await loadLiveReadings()
    } catch (err) {
      showToast('⚠️ Failed to post reading to backend API')
    } finally {
      setIsSubmitting(false)
    }
  }

  // Handle Pump Relay Toggle
  async function handleToggleValve() {
    const nextState = !valveClosed
    const curIn = latest ? latest.flow_in : 40.0
    const curOut = nextState ? 0.0 : curIn * 0.98

    // 1. Send hardware command to physical relay via HiveMQ MQTT (/api/valve)
    try {
      await controlValve(nextState)
    } catch (e) {
      console.warn('Pump relay control API notice:', e)
    }

    // 2. Also send over Web Serial if connected
    // Use RESET (not OPEN) to unlatch the firmware's safety isolation
    if (serialPortRef.current && serialPortRef.current.writable) {
      try {
        const encoder = new TextEncoder()
        const writer = serialPortRef.current.writable.getWriter()
        await writer.write(encoder.encode(nextState ? 'CLOSE\n' : 'RESET\n'))
        writer.releaseLock()
      } catch (e) {}
    }

    // 3. Post telemetry reading to database & update UI
    await handleSendReading(curIn, curOut, nextState, nextState ? 'Pump Power CUT OFF (Isolated)' : 'Pump Power RESUMED')
  }

  return (
    <div className="min-h-screen bg-base text-text p-6 md:p-10 max-w-[1600px] mx-auto flex flex-col gap-6">
      {/* Top Bar / Header */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 pb-5 border-b border-border">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="live-dot" />
            <span className="hero-sub">Public Telemetry Monitor · ESP32 Physical Hardware Rig</span>
          </div>
          <h1 className="hero-title flex items-center gap-3">
            📡 Hardware Live Stream
          </h1>
          <p className="text-xs text-muted mt-1">
            Real-time telemetry from dual flow sensors, financial impact engine & automatic pump isolation relay
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`btn text-xs ${autoRefresh ? 'btn-primary' : 'btn-ghost'}`}
          >
            {autoRefresh ? '🔄 Auto-Refresh: ON (1s)' : '⏸️ Auto-Refresh: OFF'}
          </button>
          <button
            onClick={() => setSwapSensors(!swapSensors)}
            className={`btn text-xs ${swapSensors ? 'bg-warning/20 text-warning border border-warning/50 font-semibold' : 'btn-ghost'}`}
            title="Invert Sensor 1 and Sensor 2 if inflow is reading lower than outflow"
          >
            {swapSensors ? '🔄 Sensors: Swapped' : '🔄 Swap Inflow/Outflow'}
          </button>
          <button
            onClick={loadLiveReadings}
            className="btn btn-ghost text-xs"
          >
            ⚡ Manual Refresh
          </button>
          <button
            onClick={serialConnected ? disconnectSerial : connectSerial}
            className={`btn text-xs ${serialConnected ? 'bg-teal/20 text-teal border border-teal/50 font-semibold' : 'btn-ghost'}`}
            title="Connect directly to ESP32 USB COM port (Chrome / Edge) without WiFi"
          >
            {serialConnected ? '🔌 USB: Connected (COM5)' : '🔌 Connect USB (COM5)'}
          </button>
          <button
            onClick={() => nav('/')}
            className="btn btn-ghost text-xs"
          >
            🏠 Back to Main Page
          </button>
        </div>
      </div>

      {toast && (
        <div className="card p-3 text-sm bg-primary/10 border-primary/40 text-primary font-medium animate-fadeIn">
          {toast}
        </div>
      )}

      {/* KPI Cards Strip with Financial Impact */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <div className="kpi-card">
          <div className="kpi-label">Flow Rate IN {swapSensors && <span className="text-[10px] text-warning">(Swapped)</span>}</div>
          <div className="kpi-value text-teal font-mono">
            {latest ? Number(swapSensors ? (latest.flow_out || 0) : (latest.flow_in || 0)).toFixed(1) : '0.0'}<span className="text-xs text-muted"> L/min</span>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">Flow Rate OUT {swapSensors && <span className="text-[10px] text-warning">(Swapped)</span>}</div>
          <div className="kpi-value text-primary font-mono">
            {latest ? Number(swapSensors ? (latest.flow_in || 0) : (latest.flow_out || 0)).toFixed(1) : '0.0'}<span className="text-xs text-muted"> L/min</span>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">Mismatch (Loss %)</div>
          <div className={`kpi-value font-mono ${latest && Number(latest.diff_pct || 0) >= 30 ? 'text-danger' : latest && Number(latest.diff_pct || 0) >= 15 ? 'text-warning' : 'text-text'}`}>
            {latest ? Number(latest.diff_pct || 0).toFixed(1) : '0.0'}<span className="text-xs text-muted"> %</span>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">Revenue Loss (₹/hr)</div>
          <div className={`kpi-value font-mono ${latest && latest.diff_pct >= 15 ? 'text-danger' : 'text-success'}`}>
            ₹ {financial.costPerHourINR}
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">AI Status</div>
          <div className="mt-1">
            {latest ? (
              <span className={`pill ${latest.classification === 'Normal' ? 'pill-stable' :
                  latest.classification === 'Leak' ? 'pill-leak' :
                    latest.classification === 'Theft' ? 'pill-theft' :
                      latest.classification === 'Burst' ? 'pill-burst' : 'pill-maintenance'
                }`}>
                {latest.classification} ({Math.round(latest.confidence * 100)}%)
              </span>
            ) : (
              <span className="text-xs text-muted">Waiting...</span>
            )}
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">Pump Isolation Relay</div>
          <div className="mt-1 flex items-center justify-between">
            <span className={`pill ${valveClosed ? 'pill-burst' : 'pill-stable'}`}>
              {valveClosed ? '🛑 PUMP CUT OFF' : '⚡ PUMP ACTIVE'}
            </span>
            <button
              onClick={handleToggleValve}
              disabled={isSubmitting}
              className="text-xs underline text-primary hover:text-primary2"
            >
              Toggle
            </button>
          </div>
        </div>
      </div>

      {/* Auto-Isolation Alert Banner */}
      {valveClosed && (
        <div className="card p-4 bg-danger/15 border-danger/40 text-danger flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-md animate-fadeIn">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🛑</span>
            <div>
              <h4 className="font-bold text-sm">EMERGENCY ISOLATION ACTIVE: PUMP POWER CUT OFF!</h4>
              <p className="text-xs text-danger/90">
                Critical water loss threshold exceeded (&gt; 30% mismatch / outlet &lt; 70% of inlet). Pump power severed via relay.
              </p>
            </div>
          </div>
          <button
            onClick={handleToggleValve}
            disabled={isSubmitting}
            className="btn btn-primary text-xs py-2 px-4 whitespace-nowrap self-end sm:self-auto"
          >
            ⚡ RESTART PUMP SUPPLY
          </button>
        </div>
      )}

      {/* Last Active Flow Event Spike Banner */}
      {latestActive && (
        <div className="card p-3.5 bg-panel2/80 border border-teal/40 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs shadow-sm">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="pill pill-stable text-[11px] font-semibold">⚡ LAST DETECTED FLOW EVENT</span>
            <span className="font-mono text-teal font-semibold">Inlet: {Number(swapSensors ? latestActive.flow_out : latestActive.flow_in || 0).toFixed(1)} L/min</span>
            <span className="text-muted">•</span>
            <span className="font-mono text-primary font-semibold">Outlet: {Number(swapSensors ? latestActive.flow_in : latestActive.flow_out || 0).toFixed(1)} L/min</span>
            <span className="text-muted">•</span>
            <span className={`font-semibold ${Number(latestActive.diff_pct || 0) >= 30 ? 'text-danger' : Number(latestActive.diff_pct || 0) >= 15 ? 'text-warning' : 'text-text'}`}>
              Mismatch: {Number(latestActive.diff_pct || 0).toFixed(1)}% ({latestActive.classification})
            </span>
          </div>
          <div className="text-[11px] text-muted font-mono self-end sm:self-auto">
            Logged at: {new Date(latestActive.timestamp).toLocaleTimeString()}
          </div>
        </div>
      )}

      {/* Main Grid: Controls & Visual Telemetry */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 1 Col: Control Panel & Presets */}
        <div className="space-y-6">
          <div className="card p-5">
            <h2 className="text-base font-semibold mb-2 flex items-center gap-2">
              🎛️ Pump Power & Isolation Relay
            </h2>
            <p className="text-xs text-muted mb-4">
              Control the physical relay to cut pump power or test live leak/theft anomaly scenarios.
            </p>

            <button
              onClick={handleToggleValve}
              disabled={isSubmitting}
              className={`w-full py-3 rounded-lg font-semibold text-sm transition-all mb-5 ${valveClosed
                  ? 'bg-success text-base hover:bg-success/80'
                  : 'bg-danger/20 text-danger border border-danger/50 hover:bg-danger/30'
                }`}
            >
              {valveClosed ? '⚡ RESTART PUMP SUPPLY' : '🛑 EMERGENCY PUMP SHUT OFF'}
            </button>

            <div className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">
              Quick Anomaly Injection Presets
            </div>
            <div className="grid grid-cols-2 gap-2 mb-5">
              <button
                onClick={() => handleSendReading(40.0, 39.0, false, 'Normal Flow (2.5%)')}
                disabled={isSubmitting}
                className="btn btn-ghost text-xs py-2 text-left hover:border-success/50"
              >
                🟢 Normal (2.5%)
              </button>
              <button
                onClick={() => handleSendReading(40.0, 32.0, false, 'Pipe Leak (20%)')}
                disabled={isSubmitting}
                className="btn btn-ghost text-xs py-2 text-left hover:border-warning/50"
              >
                🟡 Pipe Leak (20%)
              </button>
              <button
                onClick={() => handleSendReading(40.0, 24.0, false, 'Water Theft (40%)')}
                disabled={isSubmitting}
                className="btn btn-ghost text-xs py-2 text-left hover:border-danger/50"
              >
                🟠 Theft (40% - Auto Cut!)
              </button>
              <button
                onClick={() => handleSendReading(40.0, 14.0, false, 'Pipe Burst (65%)')}
                disabled={isSubmitting}
                className="btn btn-ghost text-xs py-2 text-left hover:border-danger/70"
              >
                🔴 Burst (65% - Auto Cut!)
              </button>
            </div>

            <div className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">
              Manual Flow Reading Input
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted block mb-1">Flow Sensor IN (L/min)</label>
                <input
                  type="number"
                  step="0.1"
                  className="input text-xs"
                  value={customFlowIn}
                  onChange={(e) => setCustomFlowIn(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-muted block mb-1">Flow Sensor OUT (L/min)</label>
                <input
                  type="number"
                  step="0.1"
                  className="input text-xs"
                  value={customFlowOut}
                  onChange={(e) => setCustomFlowOut(e.target.value)}
                />
              </div>
              <button
                onClick={() => handleSendReading(customFlowIn, customFlowOut, false, 'Manual Input')}
                disabled={isSubmitting}
                className="btn btn-primary w-full text-xs"
              >
                ⚡ Post Live Reading
              </button>
            </div>
          </div>

          <div className="card p-5 bg-panel2/50">
            <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">
              💡 Calibrated Rig Thresholds
            </h3>
            <div className="text-[11px] text-muted space-y-1.5 font-mono">
              <div className="text-success">• 0% – 15%: Normal Flow (Green LED ON)</div>
              <div className="text-warning">• 15% – 30%: Leak Detected (Red LED ON, Buzzer OFF)</div>
              <div className="text-danger">• &gt; 30%: Critical / Theft (Red LED + Buzzer + Relay Trip)</div>
            </div>
          </div>
        </div>

        {/* Right 2 Cols: Live Telemetry Visualizer & AI Diagnosis Card */}
        <div className="lg:col-span-2 space-y-6">
          {/* AI Predictive Diagnosis Card */}
          {diagnosis && latest && (
            <div className="card p-5 border-primary/40 bg-panel space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <span>🤖 AI Predictive Repair Diagnosis</span>
                  <span className={`pill ${diagnosis.badgeClass}`}>
                    {diagnosis.severity}
                  </span>
                </h3>
                <div className="text-xs font-mono text-danger font-semibold">
                  Loss: ₹ {financial.costPerHourINR}/hr (₹ {financial.costPerDayINR.toLocaleString('en-IN')}/day)
                </div>
              </div>

              <div className="text-xs text-text/90 leading-relaxed bg-base/60 p-3 rounded border border-border/50">
                <strong className="text-primary block mb-1">Root Cause Analysis:</strong>
                {diagnosis.rootCause}
              </div>

              <div className="text-xs text-text/90 leading-relaxed bg-base/60 p-3 rounded border border-border/50">
                <strong className="text-teal block mb-1">Recommended Dispatch Action ({diagnosis.priority}):</strong>
                {diagnosis.dispatchAction}
              </div>
            </div>
          )}

          {/* Visual Bar Chart Comparison */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold flex items-center gap-2">
                📊 Real-Time Flow Rate Telemetry Comparison
              </h2>
              <span className="text-xs text-muted font-mono">
                Last updated: {lastUpdated || 'Never'}
              </span>
            </div>

            {latest ? (
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-xs font-semibold mb-1">
                    <span className="text-teal">Sensor 1 (Flow IN) {swapSensors && <span className="text-warning text-[10px]">(Swapped)</span>}</span>
                    <span className="font-mono">{(swapSensors ? latest.flow_out : latest.flow_in).toFixed(1)} L/min</span>
                  </div>
                  <div className="w-full bg-base rounded-full h-4 overflow-hidden border border-border">
                    <div
                      className="bg-teal h-full transition-all duration-500 rounded-full"
                      style={{ width: `${Math.min(100, ((swapSensors ? latest.flow_out : latest.flow_in) / 50) * 100)}%` }}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-xs font-semibold mb-1">
                    <span className="text-primary">Sensor 2 (Flow OUT) {swapSensors && <span className="text-warning text-[10px]">(Swapped)</span>}</span>
                    <span className="font-mono">{(swapSensors ? latest.flow_in : latest.flow_out).toFixed(1)} L/min</span>
                  </div>
                  <div className="w-full bg-base rounded-full h-4 overflow-hidden border border-border">
                    <div
                      className="bg-primary h-full transition-all duration-500 rounded-full"
                      style={{ width: `${Math.min(100, ((swapSensors ? latest.flow_in : latest.flow_out) / 50) * 100)}%` }}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-xs font-semibold mb-1">
                    <span className={latest.diff_pct >= 30 ? 'text-danger' : latest.diff_pct >= 15 ? 'text-warning' : 'text-text'}>
                      Flow Mismatch (Water Loss)
                    </span>
                    <span className={`font-mono ${latest.diff_pct >= 30 ? 'text-danger font-bold' : ''}`}>
                      {latest.diff_pct.toFixed(1)}% (₹ {financial.costPerHourINR}/hr)
                    </span>
                  </div>
                  <div className="w-full bg-base rounded-full h-3 overflow-hidden border border-border">
                    <div
                      className={`h-full transition-all duration-500 rounded-full ${latest.diff_pct >= 30 ? 'bg-danger' : latest.diff_pct >= 15 ? 'bg-warning' : 'bg-success'
                        }`}
                      style={{ width: `${Math.min(100, latest.diff_pct)}%` }}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-8 text-center text-xs text-muted">
                {loading ? 'Loading hardware telemetry...' : 'No telemetry data received yet.'}
              </div>
            )}
          </div>

          {/* Telemetry History Log Table */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h2 className="text-base font-semibold flex items-center gap-2">
                📜 Live Telemetry Reading Log
              </h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setFilterActiveOnly(!filterActiveOnly)}
                  className={`btn text-[11px] py-1 px-2.5 ${filterActiveOnly ? 'btn-primary' : 'btn-ghost'}`}
                >
                  {filterActiveOnly ? '⚡ Showing: Flow Events Only' : '📋 Showing: All Readings'}
                </button>
              </div>
            </div>
            <div className="overflow-x-auto max-h-[350px] overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-panel text-muted uppercase text-[10px] tracking-wider border-b border-border">
                  <tr>
                    <th className="py-2.5 px-3">Timestamp</th>
                    <th className="py-2.5 px-3">Flow IN (L/m)</th>
                    <th className="py-2.5 px-3">Flow OUT (L/m)</th>
                    <th className="py-2.5 px-3">Diff %</th>
                    <th className="py-2.5 px-3">Loss (₹/hr)</th>
                    <th className="py-2.5 px-3">AI Classification</th>
                    <th className="py-2.5 px-3">Relay</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {displayedReadings.length === 0 ? (
                    <tr>
                      <td colSpan="7" className="py-6 text-center text-muted">
                        {filterActiveOnly ? 'No active flow events recorded yet.' : 'No readings recorded.'}
                      </td>
                    </tr>
                  ) : (
                    displayedReadings.map((r) => {
                      const timeStr = r.timestamp ? new Date(r.timestamp).toLocaleTimeString() : 'N/A'
                      const fin = calculateFinancialLoss(r.diff_pct, r.flow_in)
                      return (
                        <tr key={r.id} className={`${(Number(r.flow_in || 0) > 0.05 || Number(r.flow_out || 0) > 0.05) ? 'bg-teal/10 font-medium' : 'hover:bg-panel2/40'} transition-colors`}>
                          <td className="py-2 px-3 font-mono text-muted">{timeStr}</td>
                          <td className="py-2 px-3 font-mono text-teal">{Number(r.flow_in || 0).toFixed(1)}</td>
                          <td className="py-2 px-3 font-mono text-primary">{Number(r.flow_out || 0).toFixed(1)}</td>
                          <td className={`py-2 px-3 font-mono font-semibold ${Number(r.diff_pct || 0) >= 30 ? 'text-danger' : Number(r.diff_pct || 0) >= 15 ? 'text-warning' : 'text-text'}`}>
                            {Number(r.diff_pct || 0).toFixed(1)}%
                          </td>
                          <td className="py-2 px-3 font-mono text-danger">
                            ₹ {fin.costPerHourINR}
                          </td>
                          <td className="py-2 px-3">
                            <span className={`pill ${r.classification === 'Normal' ? 'pill-stable' :
                                r.classification === 'Leak' ? 'pill-leak' :
                                  r.classification === 'Theft' ? 'pill-theft' :
                                    r.classification === 'Burst' ? 'pill-burst' : 'pill-maintenance'
                              }`}>
                              {r.classification}
                            </span>
                          </td>
                          <td className="py-2 px-3">
                            <span className={`text-[11px] font-mono ${r.valve_closed ? 'text-danger font-bold' : 'text-success'}`}>
                              {r.valve_closed ? 'CUT OFF' : 'ACTIVE'}
                            </span>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}