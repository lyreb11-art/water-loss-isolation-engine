/**
 * CitizenHome.jsx
 * Routes between the zone picker (no zone selected) and the dashboard
 * (zone selected). Splitting into two components avoids the Rules-of-Hooks
 * violation that happens when conditional returns precede hook calls.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../AuthContext'
import { fetchGraph, fetchZones } from '../api'
import AppLayout from '../components/AppLayout'
import MapView from '../components/MapView'
import { naturalSortStreets } from '../utils/sort'
import { useSimulationTick } from '../hooks/useSimulationTick'
import TickStatusBanner from '../components/TickStatusBanner'

export default function CitizenHome() {
  const { zone } = useAuth()
  return zone ? <CitizenDashboard /> : <CitizenZonePicker />
}

// ---------------------------------------------------------------------
// Shared: map a classification to a pill style + card border style.
// Fixes Issue 2 (alert pill always red regardless of type).
// ---------------------------------------------------------------------
function statusStyle(classification) {
  switch (classification) {
    case 'Stable':
      return { pill: 'pill-stable', card: 'border-success/40 bg-success/5' }
    case 'Leak':
      return { pill: 'pill-leak', card: 'border-warning/40 bg-warning/5' }
    case 'Theft':
    case 'Burst':
      return { pill: 'pill-theft', card: 'border-danger/40 bg-danger/5' }
    case 'Maintenance':
      return { pill: 'pill-maintenance', card: 'border-teal/40 bg-teal/5' }
    default:
      return { pill: 'pill-stable', card: 'border-border' }
  }
}

// =====================================================================
// ZONE PICKER (shown when no zone selected)
// =====================================================================
function CitizenZonePicker() {
  const { username, setZone } = useAuth()
  const [zones, setZones] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState('')

  useEffect(() => {
    let alive = true
    async function load() {
      try {
        setLoading(true)
        const z = await fetchZones()
        if (alive) setZones(z.zones || [])
      } catch (e) {
        if (alive) setError(e?.message || 'Failed to load localities')
      } finally {
        if (alive) setLoading(false)
      }
    }
    load()
    return () => { alive = false }
  }, [])

  const uniqueStreets = useMemo(() => {
    const set = new Set()
    zones.forEach((z) => z.street && set.add(z.street))
    return naturalSortStreets([...set])
  }, [zones])

  return (
    <AppLayout>
      <div className="p-6 max-w-3xl mx-auto">
        <div className="mb-8">
          <div className="hero-sub mb-2">Citizen Portal · Step 1 of 2</div>
          <h1 className="hero-title">Select your zone</h1>
          <p className="text-muted text-sm mt-2">
            Hi {username} — pick the locality you live in. Your dashboard will
            focus on this area and its streets.
          </p>
        </div>

        {loading && (
          <div className="card p-6 text-muted">Loading localities from backend…</div>
        )}

        {error && (
          <div className="card p-6 border-danger/50 bg-danger/5 text-danger text-sm">
            ⚠️ {error} — is the FastAPI backend running on port 8000?
          </div>
        )}

        {!loading && !error && (
          <div className="card p-6">
            <label className="block text-sm font-medium mb-2">Choose your zone</label>
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="input mb-4"
            >
              <option value="">— Pick a locality —</option>
              {uniqueStreets.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>

            <button
              disabled={!selected}
              onClick={() => setZone(selected)}
              className="btn btn-primary w-full disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Enter my dashboard
            </button>

            <p className="text-xs text-muted mt-4">
              💡 Once you pick a zone, the community notice board and issue
              reporting stay accessible from the sidebar.
            </p>
          </div>
        )}
      </div>
    </AppLayout>
  )
}

// =====================================================================
// DASHBOARD (zone is picked)
// =====================================================================
function CitizenDashboard() {
  const { username, zone, setZone } = useAuth()
  const [initialGraph, setInitialGraph] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // ---- initial graph load ----
  useEffect(() => {
    let alive = true
    async function load() {
      try {
        setLoading(true)
        const g = await fetchGraph()
        if (alive) setInitialGraph(g.graph)
      } catch (e) {
        if (alive) setError(e?.message || 'Failed to load network')
      } finally {
        if (alive) setLoading(false)
      }
    }
    load()
    return () => { alive = false }
  }, [])

  // ---- periodic tick (centralized hook) ----
  const {
    results,
    tickGraph,
    lastUpdated,
    lastError,
    consecutiveFailures,
  } = useSimulationTick(6000)

  const graph = tickGraph || initialGraph

  // ---------------------------------------------------------------------
  // Index 1: node_id -> street, and street -> [node_ids]
  // Built ONCE per graph change. Replaces the O(N) filter-per-street.
  // ---------------------------------------------------------------------
  const nodeIndex = useMemo(() => {
    const byStreet = new Map()
    const streetById = new Map()
    if (!graph) return { byStreet, streetById }

    graph.nodes.forEach((n) => {
      if (!n.street) return
      streetById.set(n.id, n.street)
      if (!byStreet.has(n.street)) byStreet.set(n.street, [])
      byStreet.get(n.street).push(n.id)
    })
    return { byStreet, streetById }
  }, [graph])

  // ---------------------------------------------------------------------
  // Index 2: node ids in the citizen's zone (own street + 1-hop neighbors)
  // ---------------------------------------------------------------------
  const zoneNodes = useMemo(() => {
    const set = new Set()
    if (!graph) return set
    graph.nodes.forEach((n) => {
      if (n.street === zone) set.add(n.id)
    })
    graph.edges.forEach((e) => {
      if (set.has(e.source)) set.add(e.target)
      if (set.has(e.target)) set.add(e.source)
    })
    return set
  }, [graph, zone])

  // ---------------------------------------------------------------------
  // Index 3: node_id -> latest non-Normal result
  // r.zone is now a STRING (backend fix), matching node ids.
  // ---------------------------------------------------------------------
  const alertByNodeId = useMemo(() => {
    const m = new Map()
    results.forEach((r) => {
      if (r.classification !== 'Normal') m.set(r.zone, r)
    })
    return m
  }, [results])

  // ---------------------------------------------------------------------
  // Localities: only streets that have at least one node in zoneNodes
  // ---------------------------------------------------------------------
  const localities = useMemo(() => {
    if (!graph || zoneNodes.size === 0) return []
    const set = new Set()
    zoneNodes.forEach((id) => {
      const street = nodeIndex.streetById.get(id)
      if (street && !street.startsWith('Junction')) set.add(street)
    })
    return naturalSortStreets([...set])
  }, [graph, zoneNodes, nodeIndex])

  // ---------------------------------------------------------------------
  // Alerts in this zone — now correctly matches string types
  // ---------------------------------------------------------------------
  const zoneAlerts = useMemo(() => {
    return results.filter(
      (r) => r.classification !== 'Normal' && zoneNodes.has(r.zone)
    )
  }, [results, zoneNodes])

  // ---------------------------------------------------------------------
  // Street classification: index-based O(K), no graph-wide filtering
  // ---------------------------------------------------------------------
  const classificationForStreet = useCallback((street) => {
    const ids = nodeIndex.byStreet.get(street) || []
    for (const id of ids) {
      const alert = alertByNodeId.get(id)
      if (alert) return alert.classification
    }
    return 'Stable'
  }, [nodeIndex, alertByNodeId])

  // ---------------------------------------------------------------------
  // Stable/affected counts — one pass
  // ---------------------------------------------------------------------
  const { stableCount, affectedCount } = useMemo(() => {
    let stable = 0
    localities.forEach((loc) => {
      if (classificationForStreet(loc) === 'Stable') stable += 1
    })
    return {
      stableCount: stable,
      affectedCount: localities.length - stable,
    }
  }, [localities, classificationForStreet])

  return (
    <AppLayout>
      <div className="p-6 max-w-[1600px]">
        <TickStatusBanner
          consecutiveFailures={consecutiveFailures}
          lastError={lastError}
        />

        <div className="flex items-start justify-between mb-6 pb-5 border-b border-border">
          <div>
            <div className="hero-sub mb-1">Citizen Portal · {zone}</div>
            <h1 className="hero-title">Zone Dashboard</h1>
            <div className="text-xs text-muted mt-1">
              {lastUpdated ? `Updated ${lastUpdated}` : 'Loading…'}
            </div>
          </div>
          <div className="text-right">
            {affectedCount === 0 ? (
              <div className="text-success font-semibold text-sm">
                <span className="live-dot" />ALL STABLE
              </div>
            ) : (
              <div className="text-danger font-semibold text-sm">
                {affectedCount} ISSUE{affectedCount > 1 ? 'S' : ''} IN ZONE
              </div>
            )}
            <button
              onClick={() => setZone(null)}
              className="text-[11px] text-muted underline mt-1 hover:text-text"
            >
              change zone
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="kpi-card">
            <div className="kpi-label">Localities</div>
            <div className="kpi-value">{localities.length}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Stable</div>
            <div className="kpi-value text-success">{stableCount}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Affected</div>
            <div className={`kpi-value ${affectedCount > 0 ? 'text-danger' : 'text-success'}`}>
              {affectedCount}
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Alerts</div>
            <div className="kpi-value">{zoneAlerts.length}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-6">
          <div>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-lg font-semibold">🗺️ {zone} — Live Zone Map</h2>
              <div className="text-[11px] text-muted">
                Teal = trunk · Blue = distribution · Amber = leak · Red = theft/burst
              </div>
            </div>
            {graph ? (
              <MapView graph={graph} filterNodes={zoneNodes} height={560} zoom={15} />
            ) : (
              <div className="card h-[560px] flex items-center justify-center text-muted">
                {error || 'Loading map…'}
              </div>
            )}
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-3">📍 Locality Status</h2>
            <div className="space-y-2 mb-6">
              {localities.length === 0 && (
                <div className="text-muted text-sm">No named localities found.</div>
              )}
              {localities.map((loc) => {
                const status = classificationForStreet(loc)
                const { pill } = statusStyle(status)
                const isOwnZone = loc === zone
                return (
                  <div key={loc} className="card p-3 flex items-center justify-between">
                    <div className="min-w-0">
                      <div className="text-[11px] text-muted uppercase tracking-wider">
                        {isOwnZone ? 'Your street' : 'Street'}
                      </div>
                      <div className="text-sm font-medium text-text truncate">{loc}</div>
                    </div>
                    <span className={`pill ${pill}`}>{status}</span>
                  </div>
                )
              })}
            </div>

            <h2 className="text-lg font-semibold mb-3">🚨 Active Alerts</h2>
            {zoneAlerts.length === 0 ? (
              <div className="card p-4 text-success text-sm">
                ✅ No active alerts in your zone.
              </div>
            ) : (
              <div className="space-y-2">
                {zoneAlerts.slice(0, 6).map((a, i) => {
                  const { pill, card } = statusStyle(a.classification)
                  return (
                    <div key={i} className={`card p-3 ${card}`}>
                      <div className="text-[11px] text-primary uppercase tracking-wider">Alert</div>
                      <div className="text-sm font-medium text-text mt-1 truncate">{a.edge}</div>
                      <div className="mt-2 flex items-center gap-2">
                        <span className={`pill ${pill}`}>{a.classification}</span>
                        <span className="text-xs text-muted">{Math.round(a.confidence * 100)}%</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  )
}