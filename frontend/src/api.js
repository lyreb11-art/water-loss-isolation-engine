/**
 * api.js -- every backend call in one place.
 */
import axios from 'axios'

const API_BASE = 'http://localhost:8000'

const client = axios.create({
  baseURL: API_BASE,
  timeout: 60000,
})

// ---- graph ----
export async function fetchGraph() {
  const { data } = await client.get('/api/graph')
  return data
}

export async function loadRegion(placeName) {
  const { data } = await client.post('/api/graph/load', { place_name: placeName })
  return data
}

// ---- simulation ----
export async function injectAnomaly(edgeId, eventType, severity = null, actor = 'unknown') {
  const { data } = await client.post('/api/simulate/inject', {
    edge_id: edgeId,
    event_type: eventType,
    severity,
    actor,
  })
  return data
}

export async function unisolateEdge(edgeId, actor = 'unknown') {
  const { data } = await client.post('/api/simulate/unisolate', {
    edge_id: edgeId,
    actor,
  })
  return data
}

export async function clearAllAnomalies(actor = 'unknown') {
  const { data } = await client.post('/api/simulate/clear-all', { actor })
  return data
}

export async function fetchAuditLog(limit = 20) {
  const { data } = await client.get('/api/audit', { params: { limit } })
  return data
}

export async function stepSimulation() {
  const { data } = await client.post('/api/simulate/step')
  return data
}

export async function manualTick() {
  const { data } = await client.post('/api/simulate/tick')
  return data
}

export async function pauseSim() {
  const { data } = await client.post('/api/simulate/pause')
  return data
}

export async function resumeSim() {
  const { data } = await client.post('/api/simulate/resume')
  return data
}

export async function fetchResiduals() {
  const { data } = await client.get('/api/simulate/residuals')
  return data
}

// ---- ML ----
export async function mlPredict(features) {
  const { data } = await client.post('/api/ml/predict', features)
  return data
}

// ---- zones / streets ----
export async function fetchZones() {
  const { data } = await client.get('/api/zones')
  return data
}

export async function fetchStreets() {
  const { data } = await client.get('/api/streets')
  return data.streets || []
}

// ---- complaints ----
export async function fetchComplaints() {
  const { data } = await client.get('/api/complaints')
  return data
}

export async function addComplaint(zone, name, message) {
  const { data } = await client.post('/api/complaints', { zone, name, message })
  return data
}

export async function updateComplaint(id, status, officialReply = null) {
  const { data } = await client.patch(`/api/complaints/${id}`, {
    status,
    official_reply: officialReply,
  })
  return data
}

// ---- live hardware ----
export async function fetchLiveReadings(limit = 40) {
  const { data } = await client.get('/api/live', { params: { limit } })
  return data
}

export async function addLiveReading(reading) {
  const { data } = await client.post('/api/live', reading)
  return data
}