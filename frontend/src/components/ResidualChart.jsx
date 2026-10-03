/**
 * ResidualChart.jsx -- simple SVG line chart for the residual time series.
 * No external chart library needed -- keeps bundle small.
 */
export default function ResidualChart({ history = [], height = 180 }) {
  if (!history || history.length < 2) {
    return (
      <div className="card p-4 text-xs text-muted" style={{ height }}>
        Residual history will populate after a few simulation ticks…
      </div>
    )
  }

  const W = 800
  const H = height
  const pad = { top: 16, right: 16, bottom: 24, left: 40 }
  const innerW = W - pad.left - pad.right
  const innerH = H - pad.top - pad.bottom

  const values = history.map((h) => h.residual)
  const maxVal = Math.max(20, ...values) * 1.15
  const minVal = 0

  const xFor = (i) => pad.left + (i / (history.length - 1)) * innerW
  const yFor = (v) => pad.top + innerH - ((v - minVal) / (maxVal - minVal)) * innerH

  const linePoints = history
    .map((h, i) => `${xFor(i)},${yFor(h.residual)}`)
    .join(' ')

  const areaPoints =
    `${pad.left},${pad.top + innerH} ` +
    linePoints +
    ` ${pad.left + innerW},${pad.top + innerH}`

  const thresholdY = yFor(10)

  return (
    <div className="card p-3">
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height }} preserveAspectRatio="none">
        {/* grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <line
            key={f}
            x1={pad.left}
            x2={pad.left + innerW}
            y1={pad.top + f * innerH}
            y2={pad.top + f * innerH}
            stroke="#2A3742"
            strokeWidth="1"
          />
        ))}

        {/* area fill */}
        <polygon points={areaPoints} fill="rgba(255,180,84,0.08)" />

        {/* residual line */}
        <polyline
          points={linePoints}
          fill="none"
          stroke="#FFB454"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* threshold line at 10% */}
        <line
          x1={pad.left}
          x2={pad.left + innerW}
          y1={thresholdY}
          y2={thresholdY}
          stroke="#E85A6B"
          strokeWidth="1"
          strokeDasharray="4 4"
        />
        <text x={pad.left + 4} y={thresholdY - 4} fontSize="10" fill="#E85A6B">
          threshold
        </text>

        {/* y-axis labels */}
        <text x={pad.left - 6} y={pad.top + 4} fontSize="10" fill="#6B7887" textAnchor="end">
          {maxVal.toFixed(0)}
        </text>
        <text x={pad.left - 6} y={pad.top + innerH + 4} fontSize="10" fill="#6B7887" textAnchor="end">
          0
        </text>

        {/* x-axis: first and last timestamps */}
        <text x={pad.left} y={H - 6} fontSize="10" fill="#6B7887" textAnchor="start">
          {history[0]?.t}
        </text>
        <text x={pad.left + innerW} y={H - 6} fontSize="10" fill="#6B7887" textAnchor="end">
          {history[history.length - 1]?.t}
        </text>
      </svg>
    </div>
  )
}