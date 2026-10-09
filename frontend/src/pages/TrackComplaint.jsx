import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import * as maplibregl from 'maplibre-gl'
import { setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  fetchComplaint, fetchRoute, fetchWorklog, fetchImpact, fetchGraph,
} from '../api'
import { useAuth } from '../AuthContext'

// Point MapLibre at local worker bundle
setWorkerUrl(workerUrl)

const STAGES = ['reported', 'dispatched', 'onsite', 'resolved']

const STAGE_LABEL = {
  reported:   'Reported — awaiting dispatch',
  dispatched: 'Crew en route to site',
  onsite:     'Work in progress on site',
  resolved:   'Resolved · Water flow restored',
}

const STAGE_COLOR = {
  reported:   '#FFB454', // Amber
  dispatched: '#5CC8D6', // Cyan / Teal
  onsite:     '#FFB454', // Amber
  resolved:   '#6FCF97', // Emerald Green
}

const ACTION_ICONS = {
  crew_dispatched:    '🚚',
  crew_arrived:       '👷',
  assessment:         '🔍',
  excavation_started: '⛏️',
  pipe_replaced:      '🔩',
  joint_resealed:     '🔗',
  valve_adjusted:     '🎛️',
  temporary_patch:    '🩹',
  pressure_test:      '🧪',
  supply_restored:    '💧',
  resolved:           '✅',
}

// Clean ESRI World Dark Gray basemap with reference labels (100% watermark-free)
const DARK_GRID_STYLE = {
  version: 8,
  name: 'Digital Twin Dark Base',
  sources: {
    'esri-dark-tiles': {
      type: 'raster',
      tiles: [
        'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      attribution: '&copy; Esri &copy; OpenStreetMap',
    },
    'esri-labels': {
      type: 'raster',
      tiles: [
        'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      attribution: '',
    },
  },
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': '#0B1015' },
    },
    {
      id: 'esri-dark-tiles-layer',
      type: 'raster',
      source: 'esri-dark-tiles',
      paint: { 'raster-opacity': 0.85 },
    },
    {
      id: 'esri-labels-layer',
      type: 'raster',
      source: 'esri-labels',
      paint: { 'raster-opacity': 0.6 },
    },
  ],
}

// =====================================================================
// Dedicated Complaint Map Component (Guaranteed mount & rendering)
// =====================================================================
function ComplaintMap({ complaint, route, effectiveStage }) {
  const mapContainer = useRef(null)
  const mapRef = useRef(null)
  const isLoadedRef = useRef(false)
  const markerRef = useRef(null)
  const streetPinRef = useRef(null)
  const pulseRef = useRef(null)
  const animFrameRef = useRef(null)
  const graphRef = useRef(null)

  // 1. Initialize Map synchronously as soon as container is in the DOM
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: DARK_GRID_STYLE,
      center: [72.8347, 19.0596], // Bandra West Center
      zoom: 15,
      pitch: 35,
      attributionControl: false,
    })
    mapRef.current = map

    map.on('load', () => {
      isLoadedRef.current = true
      // If graph already arrived before load event, render now
      if (graphRef.current) {
        renderGraph(graphRef.current)
      }
    })

    // Handle container resize cleanly
    const ro = new ResizeObserver(() => {
      try { map.resize() } catch {}
    })
    ro.observe(mapContainer.current)

    // Initial graph fetch
    fetchGraph().then((g) => {
      graphRef.current = g
      if (isLoadedRef.current) {
        renderGraph(g)
      }
    })

    return () => {
      ro.disconnect()
      if (pulseRef.current) cancelAnimationFrame(pulseRef.current)
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
      if (streetPinRef.current) streetPinRef.current.remove()
      if (markerRef.current) markerRef.current.remove()
      try { map.remove() } catch {}
      mapRef.current = null
      isLoadedRef.current = false
    }
    // eslint-disable-next-line
  }, [])

  // 2. Render Street & Background Network
  function renderGraph(g) {
    const map = mapRef.current
    if (!map || !g?.graph) return

    const zoneStr = (complaint.zone || '').trim().toLowerCase()
    const edges = g.graph.edges || []

    // Match street segments by name
    const matchingEdges = edges.filter((e) => {
      const st = (e.street || '').toLowerCase()
      return st === zoneStr || (zoneStr && st.includes(zoneStr)) || (st && zoneStr.includes(st))
    })

    // Calculate center coordinate
    let center = [72.8347, 19.0596]
    const zoneCoords = []
    matchingEdges.forEach((e) => {
      if (Array.isArray(e.path)) {
        zoneCoords.push(...e.path)
      }
    })

    if (zoneCoords.length > 0) {
      const avgLon = zoneCoords.reduce((s, c) => s + c[0], 0) / zoneCoords.length
      const avgLat = zoneCoords.reduce((s, c) => s + c[1], 0) / zoneCoords.length
      center = [avgLon, avgLat]
    } else if (g.graph.nodes?.length > 0) {
      center = [g.graph.nodes[0].lon, g.graph.nodes[0].lat]
    }

    try {
      map.flyTo({ center, zoom: 16, duration: 600 })
    } catch {}

    // A. Background network
    const bgFeatures = edges.map((e) => ({
      type: 'Feature',
      properties: { id: e.id },
      geometry: { type: 'LineString', coordinates: e.path },
    }))

    if (map.getSource('pipeline-bg')) {
      map.getSource('pipeline-bg').setData({ type: 'FeatureCollection', features: bgFeatures })
    } else {
      map.addSource('pipeline-bg', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: bgFeatures },
      })
      map.addLayer({
        id: 'pipeline-bg-lines',
        type: 'line',
        source: 'pipeline-bg',
        paint: {
          'line-color': '#2C4050',
          'line-width': 1.8,
          'line-opacity': 0.45,
        },
      })
    }

    // B. Highlighted zone / street
    const zoneFeatures = (matchingEdges.length > 0 ? matchingEdges : edges.slice(0, 4)).map((e) => ({
      type: 'Feature',
      properties: { id: e.id },
      geometry: { type: 'LineString', coordinates: e.path },
    }))

    const currentColor = STAGE_COLOR[effectiveStage] || '#FFB454'

    if (map.getSource('zone')) {
      map.getSource('zone').setData({ type: 'FeatureCollection', features: zoneFeatures })
    } else {
      map.addSource('zone', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: zoneFeatures },
      })
      map.addLayer({
        id: 'zone-glow',
        type: 'line',
        source: 'zone',
        paint: {
          'line-color': currentColor,
          'line-width': 20,
          'line-opacity': effectiveStage === 'resolved' ? 0.35 : 0.25,
          'line-blur': 10,
        },
      })
      map.addLayer({
        id: 'zone-main',
        type: 'line',
        source: 'zone',
        paint: {
          'line-color': currentColor,
          'line-width': 4.5,
          ...(effectiveStage === 'reported' || effectiveStage === 'dispatched'
            ? { 'line-dasharray': [3, 2] }
            : {}),
        },
      })
    }

    // C. Street Marker Pin
    if (streetPinRef.current) {
      streetPinRef.current.remove()
    }
    const pinEl = document.createElement('div')
    pinEl.style.cssText = `
      display: flex; align-items: center; gap: 6px;
      background: rgba(14, 20, 25, 0.94); border: 1.5px solid ${currentColor};
      padding: 5px 12px; border-radius: 9999px; box-shadow: 0 4px 16px rgba(0,0,0,0.7);
      font-family: inherit; font-size: 11px; font-weight: 600; color: #E8F0F8;
      backdrop-filter: blur(4px); white-space: nowrap; pointer-events: none;
    `
    pinEl.innerHTML = `<span style="font-size:13px">📍</span> ${complaint.zone}`
    streetPinRef.current = new maplibregl.Marker({ element: pinEl })
      .setLngLat(center)
      .addTo(map)

    // D. Pulse animation if not resolved
    if (pulseRef.current) cancelAnimationFrame(pulseRef.current)
    if (effectiveStage !== 'resolved') {
      const t0 = performance.now()
      function pulse() {
        const t = (performance.now() - t0) / 1000
        const opacity = 0.15 + 0.25 * (0.5 + 0.5 * Math.sin(t * 2.8))
        if (map.getLayer('zone-glow')) {
          map.setPaintProperty('zone-glow', 'line-opacity', opacity)
        }
        pulseRef.current = requestAnimationFrame(pulse)
      }
      pulse()
    }
  }

  // 3. React to stage color changes
  useEffect(() => {
    const map = mapRef.current
    if (!map || !isLoadedRef.current) return
    const color = STAGE_COLOR[effectiveStage] || '#FFB454'

    if (map.getLayer('zone-main')) {
      map.setPaintProperty('zone-main', 'line-color', color)
      if (effectiveStage === 'onsite' || effectiveStage === 'resolved') {
        map.setPaintProperty('zone-main', 'line-dasharray', null)
      } else {
        map.setPaintProperty('zone-main', 'line-dasharray', [3, 2])
      }
    }
    if (map.getLayer('zone-glow')) {
      map.setPaintProperty('zone-glow', 'line-color', color)
      if (effectiveStage === 'resolved') {
        if (pulseRef.current) cancelAnimationFrame(pulseRef.current)
        map.setPaintProperty('zone-glow', 'line-opacity', 0.35)
      }
    }
  }, [effectiveStage])

  // 4. Route & Crew Animation
  useEffect(() => {
    const map = mapRef.current
    if (!map || !route?.route || route.route.length < 2) return

    if (!isLoadedRef.current) {
      map.once('load', () => renderRoute())
    } else {
      renderRoute()
    }

    function renderRoute() {
      if (!map.getSource('route')) {
        map.addSource('route', {
          type: 'geojson',
          data: {
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: route.route },
          },
        })
        map.addLayer({
          id: 'route-line',
          type: 'line',
          source: 'route',
          paint: {
            'line-color': '#5CC8D6',
            'line-width': 3.5,
            'line-opacity': 0.7,
            'line-dasharray': [2, 2],
          },
        })
      } else {
        map.getSource('route').setData({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: route.route },
        })
      }

      const coords = route.route
      if (markerRef.current) {
        markerRef.current.remove()
        markerRef.current = null
      }

      const el = document.createElement('div')
      el.style.cssText = `
        display: flex; align-items: center; justify-content: center;
        width: 32px; height: 32px; border-radius: 50%;
        background: #0E1419; border: 2px solid #5CC8D6;
        box-shadow: 0 0 16px rgba(92, 200, 214, 0.7);
        font-size: 16px; cursor: default;
      `
      el.innerHTML = '🚚'

      if (effectiveStage === 'dispatched') {
        const start = performance.now()
        const duration = (route.eta_seconds || 12) * 1000

        function step() {
          const elapsed = performance.now() - start
          const t = Math.min(1, elapsed / duration)
          const i = t * (coords.length - 1)
          const idx = Math.floor(i)
          const frac = i - idx
          const a = coords[idx]
          const b = coords[Math.min(coords.length - 1, idx + 1)]
          const lon = a[0] + (b[0] - a[0]) * frac
          const lat = a[1] + (b[1] - a[1]) * frac

          if (!markerRef.current) {
            markerRef.current = new maplibregl.Marker({ element: el })
              .setLngLat([lon, lat])
              .addTo(map)
          } else {
            markerRef.current.setLngLat([lon, lat])
          }

          if (t < 1) {
            animFrameRef.current = requestAnimationFrame(step)
          }
        }
        step()
      } else {
        const dest = coords[coords.length - 1]
        el.innerHTML = effectiveStage === 'resolved' ? '✅' : '🔧'
        el.style.borderColor = effectiveStage === 'resolved' ? '#6FCF97' : '#FFB454'
        markerRef.current = new maplibregl.Marker({ element: el })
          .setLngLat(dest)
          .addTo(map)
      }
    }

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    }
  }, [route, effectiveStage])

  return (
    <div
      ref={mapContainer}
      className="rounded-xl overflow-hidden border border-border w-full relative shadow-lg"
      style={{ height: 520, background: '#0B1015' }}
    />
  )
}

// =====================================================================
// Main TrackComplaint Page
// =====================================================================
export default function TrackComplaint() {
  const { id } = useParams()
  const nav = useNavigate()
  const { username } = useAuth()

  const [complaint, setComplaint] = useState(null)
  const [route, setRoute] = useState(null)
  const [worklog, setWorklog] = useState([])
  const [impact, setImpact] = useState(null)
  const [loading, setLoading] = useState(true)

  // Derive canonical effective stage
  const effectiveStage = complaint
    ? (complaint.status === 'Resolved' || complaint.stage === 'resolved'
        ? 'resolved'
        : (complaint.stage || 'reported'))
    : 'reported'

  // ---------- 1. Initial Load ----------
  useEffect(() => {
    let alive = true

    async function load() {
      try {
        const c = await fetchComplaint(id)
        if (!alive) return
        setComplaint(c)

        const [w, i] = await Promise.all([
          fetchWorklog(id).catch(() => ({ entries: [] })),
          fetchImpact(id).catch(() => null),
        ])
        if (!alive) return
        setWorklog(w.entries || [])
        setImpact(i)

        const stage = c.status === 'Resolved' || c.stage === 'resolved' ? 'resolved' : c.stage
        if (stage !== 'reported') {
          try {
            const r = await fetchRoute(id)
            if (alive && r && r.route) setRoute(r)
          } catch (e) {
            console.warn('Could not load route:', e)
          }
        }
      } catch (err) {
        console.error('Failed to load complaint data:', err)
      } finally {
        if (alive) setLoading(false)
      }
    }

    load()
    return () => { alive = false }
  }, [id])

  // ---------- 2. Poll for updates every 3s ----------
  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const c = await fetchComplaint(id)
        setComplaint(c)

        const stage = c.status === 'Resolved' || c.stage === 'resolved' ? 'resolved' : c.stage
        if (stage !== 'reported' && !route) {
          try {
            const r = await fetchRoute(id)
            if (r && r.route) setRoute(r)
          } catch {}
        }
        const w = await fetchWorklog(id).catch(() => ({ entries: [] }))
        setWorklog(w.entries || [])
        const i = await fetchImpact(id).catch(() => null)
        setImpact(i)
      } catch {
        /* silent poll */
      }
    }, 3000)

    return () => clearInterval(t)
  }, [id, route])

  if (loading || !complaint) {
    return (
      <div className="p-8 text-center text-muted">
        <div className="inline-block animate-spin mr-2">⚙️</div>
        Loading complaint #{id} tracking telemetry…
      </div>
    )
  }

  const stageIdx = STAGES.indexOf(effectiveStage)
  const stageColor = STAGE_COLOR[effectiveStage] || '#FFB454'

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <button
        onClick={() => nav('/citizen/notices')}
        className="text-sm text-muted hover:text-text mb-4 inline-flex items-center gap-1.5 transition-colors"
      >
        ← Back to notices
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-6">
        {/* MAP COLUMN */}
        <div>
          <div className="flex items-baseline justify-between mb-3">
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <span>Complaint #{complaint.id}</span>
                <span className="text-xs px-2.5 py-0.5 rounded-full font-medium"
                      style={{ background: `${stageColor}20`, color: stageColor, border: `1px solid ${stageColor}40` }}>
                  {complaint.status}
                </span>
              </h1>
              <div className="text-xs text-muted mt-1">
                📍 {complaint.zone} · Mumbai Pipeline Digital Twin
              </div>
            </div>
            <div className="text-right">
              <div
                className="text-sm font-semibold"
                style={{ color: stageColor }}
              >
                {effectiveStage === 'resolved'
                  ? '✅ Resolved'
                  : effectiveStage === 'dispatched'
                  ? '🚚 Crew en route'
                  : effectiveStage === 'onsite'
                  ? '🔧 Work in progress'
                  : '⏳ Awaiting dispatch'}
              </div>
              <div className="text-[11px] text-muted">
                {effectiveStage === 'reported'
                  ? 'Waiting for municipal dispatch'
                  : effectiveStage === 'resolved'
                  ? `Resolved ${complaint.resolved_at?.slice(11, 16) || ''}`
                  : 'Telemetry updates every 3s'}
              </div>
            </div>
          </div>

          {/* Guaranteed Mount of Map Container */}
          <ComplaintMap
            key={complaint.id}
            complaint={complaint}
            route={route}
            effectiveStage={effectiveStage}
          />

          <div className="mt-3 text-[11px] text-muted flex items-center justify-between">
            <span>
              The illuminated street geometry shows your exact pipeline segment.
              A live vehicle tracker marks municipal response progression.
            </span>
            <span className="text-teal font-medium">● Real OpenStreetMap Geometry</span>
          </div>
        </div>

        {/* SIDE PANEL */}
        <div className="space-y-4">
          {/* Stage + timeline */}
          <div className="card p-4">
            <div className="text-xs text-muted uppercase tracking-wider mb-2">
              Current stage
            </div>
            <div className="text-lg font-semibold mb-3" style={{ color: stageColor }}>
              {STAGE_LABEL[effectiveStage]}
            </div>
            <div className="space-y-3">
              {STAGES.map((s, i) => {
                const done = i <= stageIdx
                const current = i === stageIdx
                return (
                  <div key={s} className="flex items-start gap-3">
                    <div
                      className={`w-3 h-3 rounded-full mt-1 flex-shrink-0 ${
                        done ? '' : 'bg-border'
                      } ${current ? 'ring-2 ring-offset-2 ring-offset-panel' : ''}`}
                      style={{
                        background: done ? stageColor : undefined,
                        boxShadow: current ? `0 0 0 2px ${stageColor}40` : undefined,
                      }}
                    />
                    <div className="flex-1">
                      <div
                        className={`text-sm ${
                          current ? 'font-semibold' : done ? 'text-text' : 'text-dim'
                        }`}
                        style={{ color: current ? stageColor : undefined }}
                      >
                        {STAGE_LABEL[s]}
                      </div>
                      {complaint[`${s}_at`] && (
                        <div className="text-[11px] text-muted">
                          {complaint[`${s}_at`].slice(0, 19).replace('T', ' ')}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Work log */}
          <WorkLogPanel entries={worklog} />

          {/* Impact */}
          <ImpactPanel impact={impact} />
        </div>
      </div>
    </div>
  )
}

// =====================================================================
// Work Log panel
// =====================================================================
function WorkLogPanel({ entries }) {
  if (!entries || entries.length === 0) {
    return (
      <div className="card p-4">
        <div className="text-xs text-muted uppercase tracking-wider mb-2">
          What was done
        </div>
        <div className="text-xs text-muted">
          No actions logged yet. Updates appear here as officials progress
          on your complaint.
        </div>
      </div>
    )
  }

  return (
    <div className="card p-4">
      <div className="text-xs text-muted uppercase tracking-wider mb-3">
        What was done
      </div>
      <div className="space-y-4 max-h-60 overflow-y-auto pr-1">
        {entries.map((e) => (
          <div key={e.id} className="flex items-start gap-3">
            <div className="text-xl flex-shrink-0">
              {ACTION_ICONS[e.action_type] || '•'}
            </div>
            <div className="flex-1 border-l-2 border-border pl-3">
              <div className="flex items-baseline justify-between">
                <div className="text-sm font-medium text-text capitalize">
                  {e.action_type.replace(/_/g, ' ')}
                </div>
                <div className="text-[11px] text-muted">
                  {e.logged_at?.slice(11, 16)}
                </div>
              </div>
              {e.notes && (
                <div className="text-sm text-text/85 mt-1">{e.notes}</div>
              )}
              {e.metadata && Object.keys(e.metadata).length > 0 && (
                <div className="text-[11px] text-muted mt-2 flex gap-2 flex-wrap">
                  {Object.entries(e.metadata).map(([k, v]) => (
                    <span key={k} className="bg-panel2 px-2 py-0.5 rounded border border-border">
                      {k.replace(/_/g, ' ')}:{' '}
                      <span className="text-teal font-medium">{String(v)}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// =====================================================================
// Impact panel
// =====================================================================
function ImpactPanel({ impact }) {
  if (!impact) return null
  const fmtL = (n) => n?.toLocaleString('en-IN') ?? '—'
  const fmtR = (n) => n?.toLocaleString('en-IN', { maximumFractionDigits: 2 }) ?? '—'
  const fmtDowntime = (m) =>
    m == null ? '—' : `${Math.floor(m / 60)}h ${m % 60}m`

  return (
    <div className="card p-4">
      <div className="text-xs text-muted uppercase tracking-wider mb-3">
        Estimated impact
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="kpi-label">Water saved</div>
          <div className="kpi-value text-teal text-xl">
            {fmtL(impact.water_saved_lpd)}
            <span className="text-xs text-muted"> L/day</span>
          </div>
        </div>
        <div>
          <div className="kpi-label">Cost avoided</div>
          <div className="kpi-value text-success text-xl">
            ₹{fmtR(impact.cost_saved_per_day)}
            <span className="text-xs text-muted"> /day</span>
          </div>
        </div>
        <div>
          <div className="kpi-label">Households served</div>
          <div className="kpi-value text-xl">{impact.households_served}</div>
        </div>
        <div>
          <div className="kpi-label">Downtime</div>
          <div className="kpi-value text-xl">
            {fmtDowntime(impact.downtime_minutes)}
          </div>
        </div>
        <div>
          <div className="kpi-label">CO₂ avoided</div>
          <div className="kpi-value text-xl">
            {impact.co2_avoided_kg_per_day}{' '}
            <span className="text-xs text-muted">kg/day</span>
          </div>
        </div>
        <div>
          <div className="kpi-label">Zone loss rate</div>
          <div className="kpi-value text-xl">
            {impact.avg_loss_pct_in_zone}
            <span className="text-xs text-muted"> %</span>
          </div>
        </div>
      </div>
      <div className="text-[10px] text-dim mt-4 pt-3 border-t border-border leading-relaxed">
        Estimates computed from zone flow telemetry and municipal rates
        (BMC ₹15/1000 L). Actual savings may vary with demand profile.
      </div>
    </div>
  )
}
