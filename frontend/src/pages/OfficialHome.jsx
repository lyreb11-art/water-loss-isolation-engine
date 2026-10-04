/**
 * OfficialHome.jsx -- full city map + KPI strip + residual chart + alerts + ML classification.
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../AuthContext'
import { fetchGraph, fetchComplaints, unisolateEdge, mlPredict } from '../api'
import AppLayout from '../components/AppLayout'
import MapView from '../components/MapView'
import ResidualChart from '../components/ResidualChart'
import { useSimulationTick } from '../hooks/useSimulationTick'
import TickStatusBanner from '../components/TickStatusBanner'

export default function OfficialHome() {
  const { username } = useAuth()
  const nav = useNavigate()
  const [restoreToast, setRestoreToast] = useState('')

  async function handleRestore(edgeId) {
    try {
      await unisolateEdge(edgeId, username)
      setRestoreToast('✅ Restored segment — valve reopened.')
      setTimeout(() => setRestoreToast(''), 3000)
    } catch (e) {
      setRestoreToast(
        '⚠️ ' + (e?.response?.data?.detail || e?.message || 'Restore failed')
      )
      setTimeout(() => setRestoreToast(''), 4000)
    }
  }

  const [initialGraph, setInitialGraph] = useState(null)
  const [complaints, setComplaints] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [mlPredictions, setMlPredictions] = useState({})

  useEffect(() => {
    let alive = true
    async function load() {
      try {
        setLoading(true)
        const [g, c] = await Promise.all([fetchGraph(), fetchComplaints()])
        if (!alive) return
        setInitialGraph(g.graph)
        setComplaints(c.complaints || [])
      } catch (e) {
        if (alive) setError(e?.message || 'Failed to load dashboard')
      } finally {
        if (alive) setLoading(false)
      }
    }
    load()
    return () => { alive = false }
  }, [])

  const {
    results,
    residuals,
    tickGraph,
    lastUpdated,
    lastError,
    consecutiveFailures,
  } = useSimulationTick(4000)

  const graph = tickGraph || initialGraph

  useEffect(() => {
    let alive = true
    const id = setInterval(async () => {
      try {
        const c = await fetchComplaints()
        if (alive) setComplaints(c.complaints || [])
      } catch { /* silent */ }
    }, 10000)
    return () => { alive = false; clearInterval(id) }
  }, [])

  const anomalies = results.filter((r) => r.classification !== 'Normal')

  // Enrich anomalies with ML predictions
  useEffect(() => {
    if (anomalies.length === 0) {
      setMlPredictions({})
      return
    }
    let alive = true
    Promise.all(
      anomalies.slice(0, 8).map(async (a) => {
        try {
          const pred = await mlPredict({
            diff_pct: a.diff_pct,
            diff_pct_lag1: a.diff_pct_lag1 ?? a.diff_pct,
            diff_pct_lag3: a.diff_pct_lag3 ?? a.diff_pct,
            slope: a.slope ?? 0,
            duration_steps: a.duration_steps,
            flow_in_norm: 0.35,
          })
          return [a.edge_id, pred]
        } catch {
          return [a.edge_id, null]
        }
      })
    ).then((pairs) => {
      if (alive) setMlPredictions(Object.fromEntries(pairs))
    })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anomalies.map((a) => a.edge_id).join('|')])

  const isolated = graph?.edges?.filter((e) => e.isolated).length || 0
  const totalEdges = graph?.edges?.length || 0
  const avgLoss = results.length
    ? (results.reduce((s, r) => s + r.diff_pct, 0) / results.length).toFixed(1)
    : '0.0'
  const openTickets = complaints.filter((c) => c.status !== 'Resolved').length

  return (
    <AppLayout>
      <div className="p-6 max-w-[1800px]">
        <TickStatusBanner
          consecutiveFailures={consecutiveFailures}
          lastError={lastError}
        />
        {restoreToast && (
          <div
            className={`card p-3 mb-4 text-sm ${
              restoreToast.startsWith('✅')
                ? 'border-success/40 bg-success/5 text-success'
                : 'border-danger/40 bg-danger/5 text-danger'
            }`}
          >
            {restoreToast}
          </div>
        )}

        <div className="flex items-start justify-between mb-6 pb-5 border-b border-border">
          <div>
            <div className="hero-sub mb-1">Municipal Digital Twin · Full City Grid</div>
            <h1 className="hero-title">Official Command Centre</h1>
            <div className="text-xs text-muted mt-1">
              Signed in as {username}{lastUpdated ? ` · updated ${lastUpdated}` : ''}
            </div>
          </div>
          <div className="text-right">
            {anomalies.length === 0 ? (
              <div className="text-success font-semibold text-sm">
                <span className="live-dot" />ALL SYSTEMS NOMINAL
              </div>
            ) : (
              <div className="text-danger font-semibold text-sm">
                {anomalies.length} ACTIVE ALERT{anomalies.length > 1 ? 'S' : ''}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <div className="kpi-card">
            <div className="kpi-label">Pipeline Segments</div>
            <div className="kpi-value">{totalEdges}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Affected Segments</div>
            <div className={`kpi-value ${anomalies.length > 0 ? 'text-danger' : 'text-success'}`}>
              {anomalies.length}
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Isolated Segments</div>
            <div className="kpi-value">{isolated}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Avg Mismatch</div>
            <div className="kpi-value">
              {avgLoss}<span className="text-sm text-muted"> %</span>
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Open Tickets</div>
            <div className="kpi-value">{openTickets}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[2.1fr_1fr] gap-6">
          <div>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-lg font-semibold">🛰️ City Pipeline Grid — Digital Twin</h2>
              <div className="text-[11px] text-muted">
                Teal = trunk · Blue = distribution · Amber = leak · Red = theft/burst
              </div>
            </div>
            {graph ? (
              <MapView graph={graph} height={560} zoom={13.5} />
            ) : (
              <div className="card h-[560px] flex items-center justify-center text-muted">
                {error || loading ? 'Loading map…' : 'No map data'}
              </div>
            )}

            <div className="mt-6">
              <div className="mb-2 flex items-baseline justify-between">
                <h2 className="text-lg font-semibold">📈 Residual Time-Series</h2>
                <div className="text-[11px] text-muted">
                  Sharp step = Burst · Gradual rise = Leak · Periodic spike = Theft
                </div>
              </div>
              <ResidualChart history={residuals} height={180} />
            </div>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-3">🤖 Active Alerts</h2>
            {anomalies.length === 0 ? (
              <div className="card p-4 text-success text-sm mb-6">
                ✅ All segments nominal.
              </div>
            ) : (
              <div className="space-y-2 mb-6">
                {anomalies.slice(0, 8).map((a, i) => {
                  const ml = mlPredictions[a.edge_id]
                  const agrees = ml && ml.label === a.classification
                  const disagrees = ml && ml.label !== a.classification
                  return (
                    <div key={i} className="card p-3 border-danger/40 bg-danger/5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-[11px] text-primary uppercase tracking-wider">
                            Edge
                          </div>
                          <div className="text-sm font-medium text-text truncate">{a.edge}</div>
                        </div>
                      </div>
                      <div className="mt-2 flex items-center gap-2 flex-wrap">
                        <span
                          className={`pill ${
                            a.classification === 'Theft' || a.classification === 'Burst'
                              ? 'pill-theft'
                              : 'pill-leak'
                          }`}
                        >
                          {a.classification}
                        </span>
                        <span className="text-xs text-muted">
                          {Math.round(a.confidence * 100)}%
                        </span>
                        {a.isolated && <span className="pill pill-maintenance">isolated</span>}
                        <button
                          onClick={() => handleRestore(a.edge_id)}
                          className="btn btn-ghost text-xs py-1 px-2 ml-auto"
                          title="Reopen this valve and clear the anomaly"
                        >
                          🔓 Restore
                        </button>
                      </div>
                      <div className="mt-2 text-[11px] text-muted">
                        Δ {a.diff_pct.toFixed(1)}% · onset {a.onset} · duration {a.duration_steps}
                      </div>
                      {ml && (
                        <div className="mt-1 text-[11px]">
                          <span className="text-teal">🤖 ML: </span>
                          <span className="text-text font-medium">{ml.label}</span>
                          <span className="text-muted"> ({(ml.confidence * 100).toFixed(0)}%)</span>
                          {agrees && <span className="text-success ml-2">✓ agrees</span>}
                          {disagrees && <span className="text-warning ml-2">⚠️ disagrees</span>}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            <div className="card p-4 mb-6">
              <div className="text-xs text-muted mb-2">Quick actions</div>
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => nav('/official/controls')}
                  className="btn btn-primary text-sm w-full"
                >
                  🎛️ Open Demo Controls
                </button>
                <button
                  onClick={() => nav('/official/actions')}
                  className="btn btn-ghost text-sm w-full"
                >
                  🚨 Open Action Centre
                </button>
              </div>
            </div>

            <h2 className="text-lg font-semibold mb-3">🎫 Ticket Queue</h2>
            {complaints.length === 0 ? (
              <div className="card p-4 text-muted text-sm">No complaints yet.</div>
            ) : (
              <div className="space-y-2">
                {complaints.slice(0, 5).map((c) => {
                  const pillClass =
                    c.status === 'Resolved' ? 'pill-stable'
                    : c.status === 'In Progress' ? 'pill-leak'
                    : 'pill-theft'
                  return (
                    <div key={c.id} className="card p-3">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-primary font-mono text-xs">#{c.id}</span>
                        <span className={`pill ${pillClass}`}>{c.status}</span>
                        <span className="text-sm font-medium text-text">{c.zone}</span>
                      </div>
                      <div className="text-xs text-muted truncate">{c.message}</div>
                    </div>
                  )
                })}
                <button
                  onClick={() => nav('/official/actions')}
                  className="text-xs text-primary hover:text-primary2 mt-2"
                >
                  View all in Action Centre →
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  )
}