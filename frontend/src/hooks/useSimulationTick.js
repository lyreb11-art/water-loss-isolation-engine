/**
 * useSimulationTick.js
 * Polls /api/simulate/step at a fixed interval, tracks success/failure,
 * and exposes the graph, results, residual history, and error state.
 *
 * Failure handling:
 *   - onTick error -> increments consecutiveFailures, records the message
 *   - next success -> resets both back to 0/null
 *   - the consumer can show a banner when consecutiveFailures > 0
 *
 * Consumers should NOT swallow errors themselves -- this hook is the
 * single source of truth for tick health.
 */
import { useEffect, useRef, useState } from 'react'
import { stepSimulation } from '../api'

export function useSimulationTick(intervalMs = 6000) {
  const [results, setResults] = useState([])
  const [residuals, setResiduals] = useState([])
  const [tickGraph, setTickGraph] = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [lastError, setLastError] = useState(null)
  const [consecutiveFailures, setConsecutiveFailures] = useState(0)
  const [isTicking, setIsTicking] = useState(false)

  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true

    async function tick() {
      if (!aliveRef.current) return
      setIsTicking(true)
      try {
        const r = await stepSimulation()
        if (!aliveRef.current) return

        setResults(r.results || [])
        if (r.graph) setTickGraph(r.graph)
        if (r.residual_history) setResiduals(r.residual_history)
        setLastUpdated(new Date().toLocaleTimeString())

        // success -> clear failure state
        setLastError(null)
        setConsecutiveFailures(0)
      } catch (e) {
        if (!aliveRef.current) return
        const msg =
          e?.response?.data?.detail ||
          e?.message ||
          'Backend unreachable'
        setLastError(msg)
        setConsecutiveFailures((n) => n + 1)
      } finally {
        if (aliveRef.current) setIsTicking(false)
      }
    }

    tick()
    const id = setInterval(tick, intervalMs)
    return () => {
      aliveRef.current = false
      clearInterval(id)
    }
  }, [intervalMs])

  return {
    results,
    residuals,
    tickGraph,
    lastUpdated,
    lastError,
    consecutiveFailures,
    isTicking,
  }
}
