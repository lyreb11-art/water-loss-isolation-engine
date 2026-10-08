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
 */
export function generateAIDiagnosis(anomaly) {
  const diff = anomaly.diff_pct || 0
  const type = anomaly.classification || 'Normal'
  const confidencePct = Math.round((anomaly.confidence || 0.9) * 100)
  const edge = anomaly.edge || anomaly.edge_id || 'Pipeline Segment'

  if (type === 'Burst' || diff >= 35.0) {
    return {
      severity: 'CRITICAL',
      badgeClass: 'pill-burst',
      title: '🚨 Pipe Structural Rupture / Main Line Burst',
      rootCause: `Sudden ${diff.toFixed(1)}% drop detected on ${edge}. Indicates catastrophic pipe wall fracture caused by pressure surge or structural fatigue.`,
      dispatchAction: 'AUTOMATED ISOLATION: Trip primary solenoid valve #V-102. Dispatch Emergency Response Unit 1 with pipe sleeve replacement kit.',
      priority: 'Immediate (0-15 mins)',
    }
  }

  if (type === 'Theft' || diff >= 18.0) {
    return {
      severity: 'HIGH',
      badgeClass: 'pill-theft',
      title: '🟠 Commercial Water Theft / Illegal Connection',
      rootCause: `Unmetered ${diff.toFixed(1)}% flow deviation (${confidencePct}% confidence). Characteristic periodic consumption spike on ${edge}.`,
      dispatchAction: 'INSPECTION NOTICE: Dispatch Field Enforcement Officers to inspect commercial tapping junction near node segment.',
      priority: 'High (1-2 hours)',
    }
  }

  if (type === 'Leak' || diff >= 5.0) {
    return {
      severity: 'MODERATE',
      badgeClass: 'pill-leak',
      title: '🟡 Subsurface Joint Corrosion / Pipe Leak',
      rootCause: `Gradual ${diff.toFixed(1)}% residual mismatch on ${edge}. Pattern matches subsurface micro-crack or failing gasket joint.`,
      dispatchAction: 'MAINTENANCE QUEUE: Schedule acoustic leak detection scan during low-demand night window (02:00 - 04:00 AM).',
      priority: 'Medium (24 hours)',
    }
  }

  return {
    severity: 'NOMINAL',
    badgeClass: 'pill-stable',
    title: '🟢 Normal Flow Operation',
    rootCause: 'All flow sensors operating within nominal tolerance (< 5% residual variance).',
    dispatchAction: 'No repair action required. Continue continuous telemetry logging.',
    priority: 'Routine',
  }
}
