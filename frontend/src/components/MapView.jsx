/**
<<<<<<< HEAD
 * MapView.jsx -- the digital twin pipeline map.
 * Uses an inline style object to guarantee instant loading even under slow network or SSL proxy conditions.
=======
 * MapView.jsx -- the digital twin map.
>>>>>>> babbc12ee2f070745c17028f47c1dc5cd09fd76f
 */
import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import { setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'

<<<<<<< HEAD
// Point MapLibre at the local worker bundle
setWorkerUrl(workerUrl)

// Built-in dark theme style object: Loads immediately with 0ms network latency
const DARK_GRID_STYLE = {
  version: 8,
  name: 'Digital Twin Dark Base',
  sources: {
    'carto-tiles': {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'
      ],
      tileSize: 256,
      attribution: '&copy; OpenStreetMap &copy; CARTO'
    }
  },
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': '#0E1419' }
    },
    {
      id: 'carto-tiles-layer',
      type: 'raster',
      source: 'carto-tiles',
      paint: { 'raster-opacity': 0.85 }
    }
  ]
}
=======
// Point MapLibre at the correct worker URL for Vite bundling.
// Without this, the map container renders but tiles never load (silent hang).
setWorkerUrl(workerUrl)

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
>>>>>>> babbc12ee2f070745c17028f47c1dc5cd09fd76f

function edgeColor(edge) {
  const c = edge.classification
  if (c === 'Burst' || c === 'Theft') return '#E85A6B'
  if (c === 'Leak') return '#FFB454'
  if (c === 'Maintenance') return '#5CC8D6'
  // healthy — trunk vs distribution
  return edge.road_class === 'trunk' ? '#5CC8D6' : '#3D5566'
}

function edgeWidth(edge) {
  const c = edge.classification
  if (c === 'Burst' || c === 'Theft' || c === 'Leak') return 5
  return edge.road_class === 'trunk' ? 3 : 2
}

export default function MapView({
  graph,           // { nodes: [...], edges: [...] }
  height = 600,
  center = null,   // [lon, lat] -- optional focus
<<<<<<< HEAD
  zoom = 13.5,
  filterNodes = null,  // Set of node ids to restrict to
}) {
  const mapContainer = useRef(null)
  const mapRef = useRef(null)
  const isLoadedRef = useRef(false)
  const hasAutoFittedRef = useRef(false)
  const prevFilterNodesRef = useRef(filterNodes)

  if (prevFilterNodesRef.current !== filterNodes) {
    prevFilterNodesRef.current = filterNodes
    hasAutoFittedRef.current = false
  }
=======
  zoom = 13,
  filterNodes = null,  // Set of node ids to restrict to (for citizen zone view)
}) {
  const mapContainer = useRef(null)
  const mapRef = useRef(null)
>>>>>>> babbc12ee2f070745c17028f47c1dc5cd09fd76f

  // ---- initialize map once ----
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return

    const m = new maplibregl.Map({
      container: mapContainer.current,
<<<<<<< HEAD
      style: DARK_GRID_STYLE,
      center: center || [72.8347, 19.0596],   // Bandra West / Grid center
=======
      style: MAP_STYLE,
      center: center || [72.8347, 19.0596],   // Bandra West
>>>>>>> babbc12ee2f070745c17028f47c1dc5cd09fd76f
      zoom,
      pitch: 35,
      attributionControl: true,
    })

    m.addControl(new maplibregl.NavigationControl(), 'top-right')
    mapRef.current = m

<<<<<<< HEAD
    function setupLayers() {
      if (isLoadedRef.current) return
      isLoadedRef.current = true

      if (!m.getSource('edges')) {
        m.addSource('edges', { type: 'geojson', data: emptyFC() })
      }
      if (!m.getSource('nodes')) {
        m.addSource('nodes', { type: 'geojson', data: emptyFC() })
      }

      // glow layer for leaks/bursts
      if (!m.getLayer('edges-glow')) {
        m.addLayer({
          id: 'edges-glow',
          type: 'line',
          source: 'edges',
          filter: ['in', ['get', 'classification'], ['literal', ['Theft', 'Burst', 'Leak']]],
          paint: {
            'line-color': ['get', 'color'],
            'line-width': 18,
            'line-opacity': 0.35,
            'line-blur': 8,
          },
        })
      }

      // main edges
      if (!m.getLayer('edges-main')) {
        m.addLayer({
          id: 'edges-main',
          type: 'line',
          source: 'edges',
          paint: {
            'line-color': ['get', 'color'],
            'line-width': ['get', 'width'],
            'line-opacity': 0.95,
          },
        })
      }

      // nodes
      if (!m.getLayer('nodes')) {
        m.addLayer({
          id: 'nodes',
          type: 'circle',
          source: 'nodes',
          paint: {
            'circle-radius': 3.5,
            'circle-color': '#5CC8D6',
            'circle-opacity': 0.85,
            'circle-stroke-width': 1,
            'circle-stroke-color': '#0E1419',
          },
        })
      }

      // hover popup
=======
    m.on('load', () => {
      // sources will be added by the "update data" effect
      m.addSource('edges', { type: 'geojson', data: emptyFC() })
      m.addSource('nodes', { type: 'geojson', data: emptyFC() })

      // glow layer (wide, translucent) -- drawn first (below)
      m.addLayer({
        id: 'edges-glow',
        type: 'line',
        source: 'edges',
        filter: ['in', ['get', 'classification'], ['literal', ['Theft', 'Burst', 'Leak']]],
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 18,
          'line-opacity': 0.25,
          'line-blur': 8,
        },
      })

      // main edges
      m.addLayer({
        id: 'edges-main',
        type: 'line',
        source: 'edges',
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['get', 'width'],
          'line-opacity': 0.9,
        },
      })

      // nodes
      m.addLayer({
        id: 'nodes',
        type: 'circle',
        source: 'nodes',
        paint: {
          'circle-radius': 3,
          'circle-color': '#5CC8D6',
          'circle-opacity': 0.7,
          'circle-stroke-width': 1,
          'circle-stroke-color': '#0E1419',
        },
      })

      // popup on hover
>>>>>>> babbc12ee2f070745c17028f47c1dc5cd09fd76f
      const popup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        offset: 8,
      })

      m.on('mouseenter', 'edges-main', (e) => {
        m.getCanvas().style.cursor = 'pointer'
        const f = e.features?.[0]
        if (!f) return
        const p = f.properties
        popup
          .setLngLat(e.lngLat)
          .setHTML(
            `<div style="font-family:Inter,sans-serif;">
<<<<<<< HEAD
               <div style="color:#FFB454; font-size:11px; text-transform:uppercase; letter-spacing:0.08em;">${p.street || 'Segment'}</div>
               <div style="margin-top:4px; color:#E8EEF5; font-weight:600;">${p.classification}</div>
               <div style="color:#9AA7B6; font-size:11px;">confidence ${(Number(p.confidence) * 100).toFixed(0)}% · Δ ${Number(p.diff_pct).toFixed(1)}%</div>
=======
               <div style="color:#FFB454; font-size:11px; text-transform:uppercase; letter-spacing:0.08em;">${p.street || 'Unnamed'}</div>
               <div style="margin-top:4px; color:#E8EEF5; font-weight:600;">${p.classification}</div>
               <div style="color:#9AA7B6; font-size:11px;">confidence ${(p.confidence * 100).toFixed(0)}% · Δ ${Number(p.diff_pct).toFixed(1)}%</div>
>>>>>>> babbc12ee2f070745c17028f47c1dc5cd09fd76f
             </div>`
          )
          .addTo(m)
      })

      m.on('mouseleave', 'edges-main', () => {
        m.getCanvas().style.cursor = ''
        popup.remove()
      })

<<<<<<< HEAD
      updateSources()
    }

    m.on('load', setupLayers)
    m.on('styledata', setupLayers)
=======
      // force update once layers exist
      updateSources()
    })
>>>>>>> babbc12ee2f070745c17028f47c1dc5cd09fd76f

    return () => {
      m.remove()
      mapRef.current = null
<<<<<<< HEAD
      isLoadedRef.current = false
    }
  }, []) // eslint-disable-line
=======
    }
  }, [])   // eslint-disable-line
>>>>>>> babbc12ee2f070745c17028f47c1dc5cd09fd76f

  // ---- update data when graph prop changes ----
  useEffect(() => {
    updateSources()
<<<<<<< HEAD
  }, [graph, filterNodes]) // eslint-disable-line

  function updateSources() {
    const m = mapRef.current
    if (!m || !graph || !isLoadedRef.current) return
=======
  }, [graph, filterNodes])   // eslint-disable-line

  function updateSources() {
    const m = mapRef.current
    if (!m || !graph) return
>>>>>>> babbc12ee2f070745c17028f47c1dc5cd09fd76f
    const src = m.getSource('edges')
    const nsrc = m.getSource('nodes')
    if (!src || !nsrc) return

    // ---- edges ----
    const features = []
<<<<<<< HEAD
    if (Array.isArray(graph.edges)) {
      for (const e of graph.edges) {
        if (filterNodes && (!filterNodes.has(e.source) || !filterNodes.has(e.target))) {
          continue
        }
        features.push({
          type: 'Feature',
          properties: {
            id: e.id,
            street: e.street,
            classification: e.classification,
            confidence: e.confidence,
            diff_pct: e.diff_pct,
            color: edgeColor(e),
            width: edgeWidth(e),
          },
          geometry: { type: 'LineString', coordinates: e.path },
        })
      }
=======
    for (const e of graph.edges) {
      if (filterNodes && (!filterNodes.has(e.source) || !filterNodes.has(e.target))) {
        continue
      }
      features.push({
        type: 'Feature',
        properties: {
          id: e.id,
          street: e.street,
          classification: e.classification,
          confidence: e.confidence,
          diff_pct: e.diff_pct,
          color: edgeColor(e),
          width: edgeWidth(e),
        },
        geometry: { type: 'LineString', coordinates: e.path },
      })
>>>>>>> babbc12ee2f070745c17028f47c1dc5cd09fd76f
    }
    src.setData({ type: 'FeatureCollection', features })

    // ---- nodes ----
    const nodeFeatures = []
<<<<<<< HEAD
    if (Array.isArray(graph.nodes)) {
      for (const n of graph.nodes) {
        if (filterNodes && !filterNodes.has(n.id)) continue
        nodeFeatures.push({
          type: 'Feature',
          properties: { id: n.id, street: n.street },
          geometry: { type: 'Point', coordinates: [n.lon, n.lat] },
        })
      }
    }
    nsrc.setData({ type: 'FeatureCollection', features: nodeFeatures })

    // ---- auto-fit bounds ONLY once on initial data load ----
    if (!center && !hasAutoFittedRef.current && features.length > 0 && nodeFeatures.length > 0) {
      hasAutoFittedRef.current = true
      const bounds = new maplibregl.LngLatBounds()
      for (const n of nodeFeatures) {
        bounds.extend(n.geometry.coordinates)
      }
      if (!bounds.isEmpty()) {
        m.fitBounds(bounds, { padding: 40, maxZoom: 15, duration: 800 })
=======
    for (const n of graph.nodes) {
      if (filterNodes && !filterNodes.has(n.id)) continue
      nodeFeatures.push({
        type: 'Feature',
        properties: { id: n.id, street: n.street },
        geometry: { type: 'Point', coordinates: [n.lon, n.lat] },
      })
    }
    nsrc.setData({ type: 'FeatureCollection', features: nodeFeatures })

    // ---- auto-fit to filtered nodes ----
    if (filterNodes && features.length > 0) {
      const bounds = new maplibregl.LngLatBounds()
      for (const e of features) {
        for (const coord of e.geometry.coordinates) bounds.extend(coord)
      }
      if (!bounds.isEmpty()) {
        m.fitBounds(bounds, { padding: 60, duration: 600 })
>>>>>>> babbc12ee2f070745c17028f47c1dc5cd09fd76f
      }
    }
  }

  // ---- recenter when center prop changes ----
  useEffect(() => {
    if (mapRef.current && center) {
      mapRef.current.flyTo({ center, zoom, duration: 800 })
    }
  }, [center, zoom])

  return (
    <div
      ref={mapContainer}
      style={{
        width: '100%',
        height,
        borderRadius: 12,
        overflow: 'hidden',
        border: '1px solid #2A3742',
<<<<<<< HEAD
        position: 'relative',
        background: '#0E1419',
=======
>>>>>>> babbc12ee2f070745c17028f47c1dc5cd09fd76f
      }}
    />
  )
}

function emptyFC() {
  return { type: 'FeatureCollection', features: [] }
}