/**
 * TickStatusBanner.jsx
 * Small banner that appears above a dashboard when the tick loop
 * has been failing. Renders nothing when everything is healthy.
 */
export default function TickStatusBanner({ consecutiveFailures, lastError }) {
  if (!consecutiveFailures) return null

  const isCritical = consecutiveFailures >= 3
  const classes = isCritical
    ? 'border-danger/50 bg-danger/10 text-danger'
    : 'border-warning/50 bg-warning/10 text-warning'

  const label = isCritical
    ? `🔴 Backend unreachable — ${consecutiveFailures} failed attempts`
    : `🟡 Sync issue (retry ${consecutiveFailures}/3)`

  return (
    <div className={`card p-3 mb-4 text-sm flex items-center gap-3 ${classes}`}>
      <span className="font-semibold">{label}</span>
      <span className="text-xs opacity-80 truncate flex-1">
        {lastError || 'Unknown error'}
      </span>
      <span className="text-xs opacity-70">Showing last known data</span>
    </div>
  )
}
