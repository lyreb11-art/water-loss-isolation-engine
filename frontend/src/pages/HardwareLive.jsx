<<<<<<< HEAD
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchLiveReadings, addLiveReading } from '../api'
import { calculateFinancialLoss, generateAIDiagnosis } from '../utils/aiDiagnostics'

export default function HardwareLive() {
  const nav = useNavigate()
  const [readings, setReadings] = useState([])
  const [loading, setLoading] = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [lastUpdated, setLastUpdated] = useState('')
  const [toast, setToast] = useState('')

  // Form states for manual trigger
  const [customFlowIn, setCustomFlowIn] = useState('45.0')
  const [customFlowOut, setCustomFlowOut] = useState('44.2')
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Fetch readings from backend
  async function loadLiveReadings() {
    try {
      const data = await fetchLiveReadings(40)
      if (data && data.readings) {
        setReadings(data.readings)
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

  // Auto-refresh interval (every 3 seconds)
  useEffect(() => {
    if (!autoRefresh) return
    const interval = setInterval(() => {
      loadLiveReadings()
    }, 3000)
    return () => clearInterval(interval)
  }, [autoRefresh])

  // Latest reading
  const latest = readings.length > 0 ? readings[0] : null
  const valveClosed = latest ? Boolean(latest.valve_closed) : false

  // Financial & AI diagnosis calculations for latest hardware telemetry
  const financial = latest ? calculateFinancialLoss(latest.diff_pct, latest.flow_in) : calculateFinancialLoss(0, 0)
  const diagnosis = latest ? generateAIDiagnosis(latest) : null

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 3500)
  }

  // Handle manual or preset reading injection
  async function handleSendReading(flowInVal, flowOutVal, valveState = false, scenarioName = '') {
    setIsSubmitting(true)
    try {
      const flowIn = parseFloat(flowInVal) || 0
      const flowOut = parseFloat(flowOutVal) || 0
      const diffPct = flowIn > 0 ? Math.max(0, ((flowIn - flowOut) / flowIn) * 100) : 0

      let classification = 'Normal'
      let confidence = 0.98
      if (valveState) {
        classification = 'Isolated'
        confidence = 1.0
      } else if (diffPct >= 35) {
        classification = 'Burst'
        confidence = 0.95
      } else if (diffPct >= 18) {
        classification = 'Theft'
        confidence = 0.89
      } else if (diffPct >= 5) {
        classification = 'Leak'
        confidence = 0.91
      }

      await addLiveReading({
        flow_in: flowIn,
        flow_out: flowOut,
        diff_pct: parseFloat(diffPct.toFixed(2)),
        classification,
        confidence,
        valve_closed: valveState,
      })

      showToast(scenarioName ? `✅ Sent preset: ${scenarioName}` : '✅ Reading posted successfully!')
      await loadLiveReadings()
    } catch (err) {
      showToast('⚠️ Failed to post reading to backend API')
    } finally {
      setIsSubmitting(false)
    }
  }

  // Handle Valve Toggle
  async function handleToggleValve() {
    const nextState = !valveClosed
    const curIn = latest ? latest.flow_in : 45.0
    const curOut = nextState ? 0.0 : curIn * 0.98
    await handleSendReading(curIn, curOut, nextState, nextState ? 'Solenoid Valve CLOSED' : 'Solenoid Valve REOPENED')
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
            Real-time telemetry from dual flow sensors, financial impact engine & automatic solenoid valve
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`btn text-xs ${autoRefresh ? 'btn-primary' : 'btn-ghost'}`}
          >
            {autoRefresh ? '🔄 Auto-Refresh: ON (3s)' : '⏸️ Auto-Refresh: OFF'}
          </button>
          <button
            onClick={loadLiveReadings}
            className="btn btn-ghost text-xs"
          >
            ⚡ Manual Refresh
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
        <div className="card p-3 text-sm bg-primary/10 border-primary/40 text-primary font-medium">
          {toast}
        </div>
      )}

      {/* KPI Cards Strip with Financial Impact */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <div className="kpi-card">
          <div className="kpi-label">Flow Rate IN</div>
          <div className="kpi-value text-teal">
            {latest ? latest.flow_in.toFixed(1) : '0.0'}<span className="text-xs text-muted"> L/min</span>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">Flow Rate OUT</div>
          <div className="kpi-value text-primary">
            {latest ? latest.flow_out.toFixed(1) : '0.0'}<span className="text-xs text-muted"> L/min</span>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">Mismatch (Loss %)</div>
          <div className={`kpi-value ${latest && latest.diff_pct > 15 ? 'text-danger' : 'text-text'}`}>
            {latest ? latest.diff_pct.toFixed(1) : '0.0'}<span className="text-xs text-muted"> %</span>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">Revenue Loss (₹/hr)</div>
          <div className={`kpi-value ${latest && latest.diff_pct > 5 ? 'text-danger' : 'text-success'}`}>
            ₹ {financial.costPerHourINR}
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">AI Status</div>
          <div className="mt-1">
            {latest ? (
              <span className={`pill ${
                latest.classification === 'Normal' ? 'pill-stable' :
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
          <div className="kpi-label">Solenoid Valve</div>
          <div className="mt-1 flex items-center justify-between">
            <span className={`pill ${valveClosed ? 'pill-burst' : 'pill-stable'}`}>
              {valveClosed ? '🔒 SHUT' : '🔓 OPEN'}
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

      {/* Main Grid: Controls & Visual Telemetry */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 1 Col: Control Panel & Presets */}
        <div className="space-y-6">
          <div className="card p-5">
            <h2 className="text-base font-semibold mb-2 flex items-center gap-2">
              🎛️ Interactive Valve & Hardware Relay
            </h2>
            <p className="text-xs text-muted mb-4">
              Control the physical solenoid valve relay or simulate sensor anomaly streams.
            </p>

            <button
              onClick={handleToggleValve}
              disabled={isSubmitting}
              className={`w-full py-3 rounded-lg font-semibold text-sm transition-all mb-5 ${
                valveClosed
                  ? 'bg-success text-base hover:bg-success/80'
                  : 'bg-danger/20 text-danger border border-danger/50 hover:bg-danger/30'
              }`}
            >
              {valveClosed ? '🔓 REOPEN SOLENOID VALVE' : '🔒 EMERGENCY SHUT OFF VALVE'}
            </button>

            <div className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">
              Hardware Scenario Presets
            </div>
            <div className="grid grid-cols-2 gap-2 mb-5">
              <button
                onClick={() => handleSendReading(45.0, 44.2, false, 'Normal Flow')}
                disabled={isSubmitting}
                className="btn btn-ghost text-xs py-2 text-left hover:border-success/50"
              >
                🟢 Normal (1.8%)
              </button>
              <button
                onClick={() => handleSendReading(45.0, 39.5, false, 'Slow Leak')}
                disabled={isSubmitting}
                className="btn btn-ghost text-xs py-2 text-left hover:border-warning/50"
              >
                🟡 Pipe Leak (12.2%)
              </button>
              <button
                onClick={() => handleSendReading(45.0, 33.0, false, 'Water Theft')}
                disabled={isSubmitting}
                className="btn btn-ghost text-xs py-2 text-left hover:border-danger/50"
              >
                🟠 Water Theft (26.6%)
              </button>
              <button
                onClick={() => handleSendReading(45.0, 21.0, false, 'Pipe Burst')}
                disabled={isSubmitting}
                className="btn btn-ghost text-xs py-2 text-left hover:border-danger/70"
              >
                🔴 Pipe Burst (53.3%)
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
              💡 Backend MQTT Integration Info
            </h3>
            <p className="text-xs text-muted leading-relaxed mb-3">
              To send real ESP32 microcontroller telemetry, publish JSON messages to your MQTT Broker:
            </p>
            <div className="bg-base p-3 rounded text-[11px] font-mono text-teal border border-border">
              Broker: broker.hivemq.com<br/>
              Topic: waterloss/hardware/sensor<br/>
              Payload: &#123;"flow_in": 45.2, "flow_out": 44.8, "valve_closed": false&#125;
            </div>
            <p className="text-[11px] text-muted mt-3">
              Or run <code className="bg-base px-1.5 py-0.5 rounded text-primary">python backend/mqtt_bridge.py --simulate</code> to auto-feed live test hardware data.
            </p>
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
              <span className="text-xs text-muted">
                Last updated: {lastUpdated || 'Never'}
              </span>
            </div>

            {latest ? (
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-xs font-semibold mb-1">
                    <span className="text-teal">Sensor 1 (Flow IN)</span>
                    <span>{latest.flow_in.toFixed(1)} L/min</span>
                  </div>
                  <div className="w-full bg-base rounded-full h-4 overflow-hidden border border-border">
                    <div
                      className="bg-teal h-full transition-all duration-500 rounded-full"
                      style={{ width: `${Math.min(100, (latest.flow_in / 60) * 100)}%` }}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-xs font-semibold mb-1">
                    <span className="text-primary">Sensor 2 (Flow OUT)</span>
                    <span>{latest.flow_out.toFixed(1)} L/min</span>
                  </div>
                  <div className="w-full bg-base rounded-full h-4 overflow-hidden border border-border">
                    <div
                      className="bg-primary h-full transition-all duration-500 rounded-full"
                      style={{ width: `${Math.min(100, (latest.flow_out / 60) * 100)}%` }}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-xs font-semibold mb-1">
                    <span className={latest.diff_pct > 15 ? 'text-danger' : 'text-text'}>
                      Flow Mismatch (Water Loss)
                    </span>
                    <span className={latest.diff_pct > 15 ? 'text-danger font-bold' : ''}>
                      {latest.diff_pct.toFixed(1)}% (₹ {financial.costPerHourINR}/hr)
                    </span>
                  </div>
                  <div className="w-full bg-base rounded-full h-3 overflow-hidden border border-border">
                    <div
                      className={`h-full transition-all duration-500 rounded-full ${
                        latest.diff_pct > 35 ? 'bg-danger' : latest.diff_pct > 10 ? 'bg-warning' : 'bg-success'
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
            <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
              📜 Live Telemetry Reading Log
            </h2>
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
                    <th className="py-2.5 px-3">Valve</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {readings.length === 0 ? (
                    <tr>
                      <td colSpan="7" className="py-6 text-center text-muted">
                        No readings recorded.
                      </td>
                    </tr>
                  ) : (
                    readings.map((r) => {
                      const timeStr = r.timestamp ? new Date(r.timestamp).toLocaleTimeString() : 'N/A'
                      const fin = calculateFinancialLoss(r.diff_pct, r.flow_in)
                      return (
                        <tr key={r.id} className="hover:bg-panel2/40 transition-colors">
                          <td className="py-2 px-3 font-mono text-muted">{timeStr}</td>
                          <td className="py-2 px-3 font-mono text-teal">{r.flow_in.toFixed(1)}</td>
                          <td className="py-2 px-3 font-mono text-primary">{r.flow_out.toFixed(1)}</td>
                          <td className={`py-2 px-3 font-mono font-semibold ${r.diff_pct > 15 ? 'text-danger' : 'text-text'}`}>
                            {r.diff_pct.toFixed(1)}%
                          </td>
                          <td className="py-2 px-3 font-mono text-danger">
                            ₹ {fin.costPerHourINR}
                          </td>
                          <td className="py-2 px-3">
                            <span className={`pill ${
                              r.classification === 'Normal' ? 'pill-stable' :
                              r.classification === 'Leak' ? 'pill-leak' :
                              r.classification === 'Theft' ? 'pill-theft' :
                              r.classification === 'Burst' ? 'pill-burst' : 'pill-maintenance'
                            }`}>
                              {r.classification}
                            </span>
                          </td>
                          <td className="py-2 px-3">
                            <span className={`text-[11px] font-mono ${r.valve_closed ? 'text-danger font-bold' : 'text-success'}`}>
                              {r.valve_closed ? 'SHUT' : 'OPEN'}
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
=======
import { useNavigate } from 'react-router-dom'
export default function HardwareLive() {
  const nav = useNavigate()
  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-2">Hardware Live</h1>
      <p className="text-muted mb-6">Public monitoring page — no login required.</p>
      <button onClick={() => nav('/')} className="btn btn-ghost">Back to login</button>
      <div className="mt-8 text-dim text-sm">Full hardware page — coming in Message 5.</div>
>>>>>>> babbc12ee2f070745c17028f47c1dc5cd09fd76f
    </div>
  )
}