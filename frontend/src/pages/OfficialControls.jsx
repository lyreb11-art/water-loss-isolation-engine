/**
 * OfficialControls.jsx -- inject anomalies, advance simulation, clear all.
 */
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../AuthContext'
import {
  fetchGraph,
  injectAnomaly,
  clearAllAnomalies,
  manualTick,
  pauseSim,
  resumeSim,
} from '../api'
import AppLayout from '../components/AppLayout'
import MapView from '../components/MapView'

export default function OfficialControls() {
  const { username } = useAuth()
  const [graph, setGraph] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedEdge, setSelectedEdge] = useState('')
  const [eventType, setEventType] = useState('theft')
  const [severity, setSeverity] = useState(0.35)
  const [focusNode, setFocusNode] = useState(null)
  const [toast, setToast] = useState('')
  const [simRunning, setSimRunning] = useState(true)

  // load graph
  useEffect(() => {
    let alive = true
    async function load() {
      try {
        setLoading(true)
        const g = await fetchGraph()
        if (alive) setGraph(g.graph)
      } catch (e) {
        if (alive) setError(e?.message || 'Failed to load graph')
      } finally {
        if (alive) setLoading(false)
      }
    }
    load()
    return () => { alive = false }
  }, [])

  const edgeOptions = useMemo(() => {
    if (!graph) return []
    const opts = graph.edges.map((e) => ({
      id: e.id,
      street: e.street || 'Unnamed',
      label: `${e.street || 'Unnamed'} · ${e.source} → ${e.target}`,
      source: e.source,
    }))

    // Sort by street name naturally (1st Road < 2nd Road < 10th Road),
    // then by source/target id for stable ordering within the same street.
    opts.sort((a, b) => {
      const cmp = a.street.localeCompare(b.street, undefined, {
        numeric: true,
        sensitivity: 'base',
      })
      if (cmp !== 0) return cmp
      return a.label.localeCompare(b.label, undefined, {
        numeric: true,
        sensitivity: 'base',
      })
    })

    // Named streets first, "Unnamed" pushed to the bottom
    const named = opts.filter((o) => o.street !== 'Unnamed')
    const unnamed = opts.filter((o) => o.street === 'Unnamed')

    return [...named, ...unnamed].slice(0, 400)
  }, [graph])

  const handleInject = async () => {
    if (!selectedEdge) return
    const opt = edgeOptions.find((o) => o.id === selectedEdge)
    try {
      await injectAnomaly(selectedEdge, eventType, severity, username)
      setToast(`✅ Injected ${eventType} on ${opt?.label || selectedEdge}`)
      setFocusNode(opt?.source || null)
      setTimeout(() => setToast(''), 3500)
    } catch (e) {
      setToast('⚠️ ' + (e?.response?.data?.detail || e?.message || 'Inject failed'))
    }
  }

  const handleClear = async () => {
    if (!selectedEdge) return
    try {
      await injectAnomaly(selectedEdge, 'clear')
      setToast('✅ Segment cleared.')
      setTimeout(() => setToast(''), 3000)
    } catch (e) {
      setToast('⚠️ ' + (e?.message || 'Clear failed'))
    }
  }

  const handleStep = async () => {
    try {
      const r = await manualTick()
      if (r.graph) setGraph(r.graph)
      setToast('▶ Advanced one tick.')
      setTimeout(() => setToast(''), 2000)
    } catch (e) {
      setToast('⚠️ ' + (e?.response?.data?.detail || e?.message || 'Step failed'))
    }
  }

  const handleTogglePause = async () => {
    try {
      if (simRunning) {
        await pauseSim()
        setSimRunning(false)
        setToast('⏸ Simulation paused — ticks frozen.')
      } else {
        await resumeSim()
        setSimRunning(true)
        setToast('▶ Simulation resumed.')
      }
      setTimeout(() => setToast(''), 2500)
    } catch (e) {
      setToast('⚠️ ' + (e?.message || 'Toggle failed'))
    }
  }

  const handleClearAll = async () => {
    try {
      const r = await clearAllAnomalies(username)
      const g = await fetchGraph()
      setGraph(g.graph)
      setToast(`✅ Restored ${r.cleared} segment${r.cleared === 1 ? '' : 's'}.`)
      setFocusNode(null)
      setTimeout(() => setToast(''), 3500)
    } catch (e) {
      setToast('⚠️ ' + (e?.response?.data?.detail || e?.message || 'Reset failed'))
    }
  }

  return (
    <AppLayout>
      <div className="p-6 max-w-[1600px]">
        <div className="mb-6 pb-5 border-b border-border">
          <div className="hero-sub mb-1">Official Dashboard · Simulation Control</div>
          <h1 className="hero-title">Demo Control Room</h1>
          <div className="text-xs text-muted mt-1">Signed in as {username}</div>
        </div>

        {toast && (
          <div className={`card p-3 mb-4 text-sm ${toast.startsWith('✅') || toast.startsWith('▶')
              ? 'border-success/40 bg-success/5 text-success'
              : 'border-danger/40 bg-danger/5 text-danger'
            }`}>
            {toast}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-6">
          {/* Controls */}
          <div className="space-y-6">
            <div className="card p-6">
              <h2 className="text-lg font-semibold mb-1">🧪 Inject an event</h2>
              <p className="text-xs text-muted mb-5">
                Pick any real Mumbai street segment and simulate a leak, theft, or burst.
              </p>

              {loading && <div className="text-muted text-sm">Loading segments…</div>}
              {error && <div className="text-danger text-sm">⚠️ {error}</div>}

              {!loading && !error && (
                <>
                  <label className="block text-sm font-medium mb-2">Pipeline segment</label>
                  <select
                    className="input mb-4"
                    value={selectedEdge}
                    onChange={(e) => setSelectedEdge(e.target.value)}
                  >
                    <option value="">— Pick a segment —</option>
                    {edgeOptions.map((o) => (
                      <option key={o.id} value={o.id}>{o.label}</option>
                    ))}
                  </select>

                  <label className="block text-sm font-medium mb-2">
                    Severity: <span className="text-primary font-mono">
                      {(severity * 100).toFixed(0)}%
                    </span>
                  </label>
                  <input
                    type="range"
                    min={0.05}
                    max={0.95}
                    step={0.05}
                    value={severity}
                    onChange={(e) => setSeverity(parseFloat(e.target.value))}
                    className="w-full mb-4 accent-primary"
                  />

                  <label className="block text-sm font-medium mb-2">Event type</label>
                  <div className="flex gap-2 mb-5">
                    {['leak', 'theft', 'burst'].map((t) => (
                      <button
                        key={t}
                        onClick={() => setEventType(t)}
                        className={`flex-1 px-3 py-2 rounded-lg text-sm border capitalize transition-colors ${eventType === t
                            ? 'bg-primary/15 text-primary border-primary/40'
                            : 'bg-panel text-muted border-border hover:text-text'
                          }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>

                  <div className="grid grid-cols-3 gap-2 mb-2">
                    <button
                      onClick={handleInject}
                      disabled={!selectedEdge}
                      className="btn btn-primary disabled:opacity-40"
                    >
                      ⚠️ Inject
                    </button>
                    <button
                      onClick={handleClear}
                      disabled={!selectedEdge}
                      className="btn btn-ghost disabled:opacity-40"
                    >
                      ✅ Clear
                    </button>
                    <button onClick={handleStep} className="btn btn-ghost">
                      ▶ Force tick
                    </button>
                  </div>
                  <button
                    onClick={handleTogglePause}
                    className={`btn w-full ${
                      simRunning
                        ? 'btn-ghost border-warning/40 text-warning'
                        : 'btn-primary'
                    }`}
                  >
                    {simRunning ? '⏸ Pause simulation' : '▶ Resume simulation'}
                  </button>
                </>
              )}
            </div>

            <div className="card p-6">
              <h2 className="text-lg font-semibold mb-1">🌊 Bulk scenario</h2>
              <p className="text-xs text-muted mb-4">
                Inject a realistic scenario across multiple segments at once.
              </p>
              <button
                onClick={async () => {
                  if (!graph) return
                  const targets = graph.edges.slice(0, 4)
                  for (let i = 0; i < targets.length; i++) {
                    const t = i % 2 === 0 ? 'theft' : 'leak'
                    try {
                      await injectAnomaly(targets[i].id, t, null, username)
                    } catch { /* ignore */ }
                  }
                  const g = await fetchGraph()
                  setGraph(g.graph)
                  setToast(`✅ Scenario injected across ${targets.length} segments.`)
                  setTimeout(() => setToast(''), 3500)
                }}
                className="btn btn-primary w-full"
              >
                Run "Morning peak theft wave"
              </button>
            </div>

            <div className="card p-6 border-danger/30">
              <h2 className="text-lg font-semibold mb-1">🧹 Reset</h2>
              <p className="text-xs text-muted mb-4">
                Restore every segment to normal. Useful between demos.
              </p>
              <button onClick={handleClearAll} className="btn btn-danger w-full">
                Clear ALL anomalies
              </button>
            </div>
          </div>

          {/* Map preview */}
          <div>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-lg font-semibold">🗺️ Map preview</h2>
              <div className="text-[11px] text-muted">Focuses on last injected segment</div>
            </div>
            {graph ? (
              <MapView
                graph={graph}
                height={620}
                zoom={focusNode ? 15.5 : 13}
                center={focusNode && graph.nodes.find((n) => n.id === focusNode)
                  ? [graph.nodes.find((n) => n.id === focusNode).lon,
                  graph.nodes.find((n) => n.id === focusNode).lat]
                  : null}
              />
            ) : (
              <div className="card h-[620px] flex items-center justify-center text-muted">
                Loading map…
              </div>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  )
}