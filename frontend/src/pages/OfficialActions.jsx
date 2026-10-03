/**
 * OfficialActions.jsx -- resolve citizen tickets, dispatch crews.
 */
import { useEffect, useState } from 'react'
import { useAuth } from '../AuthContext'
import { fetchComplaints, updateComplaint, fetchAuditLog } from '../api'
import AppLayout from '../components/AppLayout'

const TABS = ['Open', 'In Progress', 'Resolved']

export default function OfficialActions() {
  const { username } = useAuth()
  const [complaints, setComplaints] = useState([])
  const [audit, setAudit] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('Open')
  const [edits, setEdits] = useState({}) // { id: { status, reply } }
  const [toast, setToast] = useState('')

  useEffect(() => {
    let alive = true
    async function loadAudit() {
      try {
        const a = await fetchAuditLog(15)
        if (alive) setAudit(a.audit || [])
      } catch { /* ignore */ }
    }
    loadAudit()
    const id = setInterval(loadAudit, 15000)
    return () => { alive = false; clearInterval(id) }
  }, [])

  const load = async () => {
    try {
      const c = await fetchComplaints()
      setComplaints(c.complaints || [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    const id = setInterval(load, 10000)
    return () => clearInterval(id)
  }, [])

  const filtered = complaints.filter((c) => c.status === activeTab)
  const counts = {
    Open: complaints.filter((c) => c.status === 'Open').length,
    'In Progress': complaints.filter((c) => c.status === 'In Progress').length,
    Resolved: complaints.filter((c) => c.status === 'Resolved').length,
  }

  const setEdit = (id, patch) => {
    setEdits((p) => ({ ...p, [id]: { ...p[id], ...patch } }))
  }

  const save = async (c, newStatus, newReply) => {
    try {
      await updateComplaint(c.id, newStatus, newReply ?? c.official_reply)
      setToast('✅ Ticket updated.')
      await load()
      setTimeout(() => setToast(''), 3000)
    } catch (e) {
      setToast('⚠️ ' + (e?.message || 'Update failed'))
      setTimeout(() => setToast(''), 3500)
    }
  }

  return (
    <AppLayout>
      <div className="p-6 max-w-5xl">
        <div className="mb-6 pb-5 border-b border-border">
          <div className="hero-sub mb-1">Official Dashboard · Citizen Complaints</div>
          <h1 className="hero-title">Action Centre</h1>
          <div className="text-xs text-muted mt-1">Signed in as {username}</div>
        </div>

        {toast && (
          <div className={`card p-3 mb-4 text-sm ${
            toast.startsWith('✅')
              ? 'border-success/40 bg-success/5 text-success'
              : 'border-danger/40 bg-danger/5 text-danger'
          }`}>
            {toast}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === t
                  ? 'bg-primary/15 text-primary border border-primary/40'
                  : 'bg-panel text-muted border border-border hover:text-text'
              }`}
            >
              {t === 'Open' ? '🔴' : t === 'In Progress' ? '🟡' : '🟢'} {t} ({counts[t]})
            </button>
          ))}
        </div>

        {loading && <div className="text-muted text-sm">Loading…</div>}

        {!loading && filtered.length === 0 && (
          <div className="card p-6 text-muted text-sm">
            No tickets in "{activeTab}".
          </div>
        )}

        <div className="space-y-4">
          {filtered.map((c) => {
            const pillClass =
              c.status === 'Resolved' ? 'pill-stable'
              : c.status === 'In Progress' ? 'pill-leak'
              : 'pill-theft'
            const edit = edits[c.id] || {}
            const currentStatus = edit.status ?? c.status
            const currentReply = edit.reply ?? c.official_reply ?? ''

            return (
              <div key={c.id} className="card p-5">
                <div className="flex items-center gap-3 flex-wrap mb-3">
                  <span className="text-primary font-mono text-sm">#{c.id}</span>
                  <span className={`pill ${pillClass}`}>{c.status}</span>
                  <span className="font-semibold text-text">{c.zone}</span>
                  <span className="text-[11px] text-muted ml-auto">
                    {c.created_at?.slice(0, 19).replace('T', ' ')}
                  </span>
                </div>

                <div className="text-sm text-text/90 mb-4 pl-3 border-l-2 border-border">
                  <span className="text-muted text-xs">From {c.name} · </span>
                  {c.message}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-4 mb-4">
                  <div>
                    <label className="block text-xs text-muted mb-1">Status</label>
                    <select
                      value={currentStatus}
                      onChange={(e) => setEdit(c.id, { status: e.target.value })}
                      className="input"
                    >
                      {['Open', 'In Progress', 'Resolved'].map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-muted mb-1">Reply to citizen</label>
                    <input
                      className="input"
                      placeholder="e.g. Crew dispatched at 14:30"
                      value={currentReply}
                      onChange={(e) => setEdit(c.id, { reply: e.target.value })}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => save(c, currentStatus, currentReply)}
                    className="btn btn-primary text-sm"
                  >
                    💾 Save update
                  </button>
                  <button
                    onClick={() => save(c, 'In Progress',
                      currentReply || 'Crew dispatched to your zone.')}
                    className="btn btn-ghost text-sm"
                  >
                    🚨 Dispatch crew
                  </button>
                  <button
                    onClick={() => save(c, 'Resolved',
                      currentReply || 'Issue resolved.')}
                    className="btn btn-ghost text-sm border-success/40 text-success"
                  >
                    ✅ Mark resolved
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        <div className="mt-10 pt-6 border-t border-border">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-lg font-semibold">📜 Recent actions</h2>
            <div className="text-[11px] text-muted">
              Audit trail · valve operations and clears
            </div>
          </div>
          {audit.length === 0 ? (
            <div className="card p-4 text-muted text-sm">No actions yet.</div>
          ) : (
            <div className="space-y-2">
              {audit.map((a) => {
                const pillClass =
                  a.action === 'clear-all' ? 'pill-maintenance'
                  : a.action === 'unisolate' ? 'pill-stable'
                  : 'pill-leak'
                return (
                  <div key={a.id} className="card p-3 flex items-center gap-3 text-sm">
                    <span className="text-[11px] text-muted font-mono">
                      {a.timestamp?.slice(11, 19)}
                    </span>
                    <span className={`pill ${pillClass}`}>{a.action}</span>
                    <span className="text-text font-medium">{a.actor}</span>
                    <span className="text-muted text-xs truncate flex-1 text-right">
                      {a.edge ? a.edge : ''}
                      {a.reason ? ` · ${a.reason}` : ''}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  )
}