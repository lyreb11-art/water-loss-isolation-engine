/**
 * aiDiagnostics.js -- AI Predictive Repair Diagnosis & Financial Loss Engine.
 */

// Municipal tariff rate: ₹ 0.07 per Liter (₹ 70 / 1000L)
const WATER_RATE_PER_LITER_INR = 0.07

/**
 * Calculates volume and monetary loss in Indian Rupees (₹).
 */
export function calculateFinancialLoss(diffPct, flowInLpm = 45.0) {
  if (diffPct <= 0 || flowInLpm <= 0) {
    return {
      lossLpm: 0,
      lossPerHourLiters: 0,
      costPerHourINR: 0,
      costPerDayINR: 0,
    }
  }

  const lossLpm = (flowInLpm * (diffPct / 100.0))
  const lossPerHourLiters = lossLpm * 60.0
  const costPerHourINR = lossPerHourLiters * WATER_RATE_PER_LITER_INR
  const costPerDayINR = costPerHourINR * 24.0

  return {
    lossLpm: lossLpm.toFixed(1),
    lossPerHourLiters: Math.round(lossPerHourLiters),
    costPerHourINR: costPerHourINR.toFixed(2),
    costPerDayINR: Math.round(costPerDayINR),
  }
}

/**
 * Generates AI Predictive Diagnostic Analysis & Repair Recommendation.
 * Thresholds aligned with ESP32 firmware: Normal<15%, Leak 15-30%, Theft 30-50%, Burst>50%
 */
export function generateAIDiagnosis(anomaly) {
  const diff = anomaly.diff_pct || 0
  const type = anomaly.classification || 'Normal'
  const confidencePct = Math.round((anomaly.confidence || 0.9) * 100)
  const edge = anomaly.edge || anomaly.edge_id || 'Pipeline Segment'

  if (type === 'Burst' || diff >= 50.0) {
    return {
      severity: 'CRITICAL',
      badgeClass: 'pill-burst',
      title: '🚨 Pipe Structural Rupture / Main Line Burst',
      rootCause: `Catastrophic ${diff.toFixed(1)}% flow loss on ${edge}. Outlet < 50% of inlet — indicates pipe wall fracture or complete diversion.`,
      dispatchAction: 'AUTOMATED ISOLATION: Relay tripped, pump power severed. Supply cut immediately to prevent flooding.',
      priority: 'Immediate (0-15 mins)',
    }
  }

  if (type === 'Theft' || diff >= 30.0) {
    return {
      severity: 'HIGH',
      badgeClass: 'pill-theft',
      title: '🟠 Water Theft / Critical Extraction Anomaly',
      rootCause: `${diff.toFixed(1)}% flow deviation detected (${confidencePct}% confidence). Outlet < 70% of inlet — critical threshold exceeded.`,
      dispatchAction: 'AUTOMATED ISOLATION: Relay tripped, pump power cut. Latched shutdown until manual RESET.',
      priority: 'High (Immediate Isolation)',
    }
  }

  if (type === 'Leak' || diff >= 15.0) {
    return {
      severity: 'MODERATE',
      badgeClass: 'pill-leak',
      title: '🟡 Subsurface Joint Corrosion / Pipe Leak',
      rootCause: `${diff.toFixed(1)}% residual mismatch on ${edge}. Outlet 70-85% of inlet — pattern matches micro-crack or gasket failure.`,
      dispatchAction: 'MONITORING: Red LED active, buzzer silent. If sustained 3+ seconds, escalates to critical isolation.',
      priority: 'Medium (3s grace, then isolation)',
    }
  }

  return {
    severity: 'NOMINAL',
    badgeClass: 'pill-stable',
    title: '🟢 Normal Flow Operation',
    rootCause: 'All flow sensors within nominal tolerance (< 15% variance). Outlet ≥ 85% of inlet.',
    dispatchAction: 'No action required. Continuous telemetry logging active.',
    priority: 'Routine',
  }
}
