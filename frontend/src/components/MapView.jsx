/**
 * MapView.jsx -- the digital twin pipeline map.
 * Uses an inline style object to guarantee instant loading even under slow network or SSL proxy conditions.
 */
import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import { setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'

// Point MapLibre at the local worker bundle
setWorkerUrl(workerUrl)

// Built-in dark theme style object: Loads immediately with 0ms network latency
const DARK_GRID_STYLE = {
  version: 8,
  name: 'Digital Twin Dark Base',
  sources: {
    'dark-tiles': {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'
      ],
      tileSize: 256,
      attribution: '&copy; Esri &copy; OpenStreetMap'
    }
  },
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': '#0E1419' }
    },
    {
      id: 'dark-tiles-layer',
      type: 'raster',
      source: 'dark-tiles',
      paint: { 'raster-opacity': 0.85 }
    }
  ]
}

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

  // ---- initialize map once ----
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return

    const m = new maplibregl.Map({
      container: mapContainer.current,
      style: DARK_GRID_STYLE,
      center: center || [72.8347, 19.0596],   // Bandra West / Grid center
      zoom,
      pitch: 35,
      attributionControl: true,
    })

    m.addControl(new maplibregl.NavigationControl(), 'top-right')
    mapRef.current = m

    function setupLayers() {
      if (isLoadedRef.current) return
      isLoadedRef.current = true

      if (!m.getSource('edges')) {
        m.addSource('edges', { type: 'geojson', data: emptyFC() })
      }
      if (!m.getSource('nodes')) {
        m.addSource('nodes', { type: 'geojson', data: emptyFC() })
      }

      // Edge glow layer for anomalies
      if (!m.getLayer('edges-glow')) {
        m.addLayer({
          id: 'edges-glow',
          type: 'line',
          source: 'edges',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': ['get', 'color'],
            'line-width': ['*', ['get', 'width'], 2.5],
            'line-opacity': 0.35,
            'line-blur': 3,
          },
        })
      }

      // Main pipe segments
      if (!m.getLayer('edges-main')) {
        m.addLayer({
          id: 'edges-main',
          type: 'line',
          source: 'edges',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': ['get', 'color'],
            'line-width': ['get', 'width'],
            'line-opacity': 0.95,
          },
        })
      }

      // Junction glow
      if (!m.getLayer('nodes-glow')) {
        m.addLayer({
          id: 'nodes-glow',
          type: 'circle',
          source: 'nodes',
          paint: {
            'circle-radius': 8,
            'circle-color': '#5CC8D6',
            'circle-opacity': 0.25,
            'circle-blur': 1,
          },
        })
      }

      // Junction points
      if (!m.getLayer('nodes-main')) {
        m.addLayer({
          id: 'nodes-main',
          type: 'circle',
          source: 'nodes',
          paint: {
            'circle-radius': 4,
            'circle-color': '#5CC8D6',
            'circle-stroke-width': 1.5,
            'circle-stroke-color': '#0E1419',
          },
        })
      }

      // Junction labels
      if (!m.getLayer('nodes-labels')) {
        m.addLayer({
          id: 'nodes-labels',
          type: 'symbol',
          source: 'nodes',
          layout: {
            'text-field': ['get', 'street'],
            'text-size': 11,
            'text-offset': [0, 1.2],
            'text-anchor': 'top',
            'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
            'text-max-width': 10,
          },
          paint: {
            'text-color': '#E8EEF5',
            'text-halo-color': '#0E1419',
            'text-halo-width': 1.5,
          },
        })
      }

      // Tooltips & hover popups
      const popup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        offset: 12,
        className: 'map-tooltip',
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
               <div style="color:#FFB454; font-size:11px; text-transform:uppercase; letter-spacing:0.08em;">${p.street || 'Segment'}</div>
               <div style="margin-top:4px; color:#E8EEF5; font-weight:600;">${p.classification}</div>
               <div style="color:#9AA7B6; font-size:11px;">confidence ${(Number(p.confidence || 0) * 100).toFixed(0)}% · Δ ${Number(p.diff_pct || 0).toFixed(1)}%</div>
             </div>`
          )
          .addTo(m)
      })

      m.on('mouseleave', 'edges-main', () => {
        m.getCanvas().style.cursor = ''
        popup.remove()
      })

      updateSources()
    }

    m.on('load', setupLayers)
    m.on('styledata', setupLayers)

    return () => {
      m.remove()
      mapRef.current = null
      isLoadedRef.current = false
    }
  }, []) // eslint-disable-line

  // ---- update data when graph prop changes ----
  useEffect(() => {
    updateSources()
  }, [graph, filterNodes]) // eslint-disable-line

  function updateSources() {
    const m = mapRef.current
    if (!m || !graph || !isLoadedRef.current) return
    const src = m.getSource('edges')
    const nsrc = m.getSource('nodes')
    if (!src || !nsrc) return

    // ---- edges ----
    const features = []
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
    }
    src.setData({ type: 'FeatureCollection', features })

    // ---- nodes ----
    const nodeFeatures = []
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
        position: 'relative',
        background: '#0E1419',
      }}
    />
  )
}

function emptyFC() {
  return { type: 'FeatureCollection', features: [] }
}