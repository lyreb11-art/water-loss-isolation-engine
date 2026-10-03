import { useEffect, useState } from 'react'
import { useAuth } from '../AuthContext'
import { fetchComplaints } from '../api'
import AppLayout from '../components/AppLayout'

export default function CitizenNotices() {
  const { username, zone } = useAuth()
  const [complaints, setComplaints] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    async function load() {
      try {
        const r = await fetchComplaints()
        if (alive) setComplaints(r.complaints || [])
      } finally {
        if (alive) setLoading(false)
      }
    }
    load()
    const id = setInterval(load, 10000)
    return () => { alive = false; clearInterval(id) }
  }, [])

  return (
    <AppLayout>
      <div className="p-6 max-w-5xl">
        <div className="mb-6 pb-5 border-b border-border">
          <div className="hero-sub mb-1">Citizen Portal · Community</div>
          <h1 className="hero-title">Notice Board</h1>
          <div className="text-xs text-muted mt-1">
            Signed in as {username}{zone ? ` · ${zone}` : ''}
          </div>
        </div>

        {loading && <div className="text-muted text-sm">Loading…</div>}

        {!loading && complaints.length === 0 && (
          <div className="card p-6 text-muted text-sm">
            No notices or complaints yet.
          </div>
        )}

        <div className="space-y-3">
          {complaints.map((c) => {
            const pillClass =
              c.status === 'Resolved' ? 'pill-stable'
              : c.status === 'In Progress' ? 'pill-leak'
              : 'pill-theft'
            return (
              <div key={c.id} className="card p-4">
                <div className="flex items-center gap-3 mb-2 flex-wrap">
                  <span className="text-primary font-mono text-xs">#{c.id}</span>
                  <span className={`pill ${pillClass}`}>{c.status}</span>
                  <span className="font-semibold text-text">{c.zone}</span>
                  <span className="text-[11px] text-muted ml-auto">
                    {c.created_at?.slice(0, 19).replace('T', ' ')}
                  </span>
                </div>
                <div className="text-sm text-text/90">{c.message}</div>
                {c.official_reply && (
                  <div className="mt-3 pl-3 border-l-2 border-teal text-xs text-muted">
                    <span className="text-teal font-semibold">Official reply: </span>
                    {c.official_reply}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </AppLayout>
  )
}