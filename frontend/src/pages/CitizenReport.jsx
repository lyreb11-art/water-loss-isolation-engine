import { useEffect, useState } from 'react'
import { useAuth } from '../AuthContext'
import { addComplaint, fetchGraph } from '../api'
import AppLayout from '../components/AppLayout'
import { naturalSortStreets } from '../utils/sort'

const CATEGORIES = ['Leak', 'No water', 'Low pressure', 'Contaminated water', 'Other']

export default function CitizenReport() {
  const { username, zone } = useAuth()
  const [localities, setLocalities] = useState([])
  const [locality, setLocality] = useState(zone || '')
  const [name, setName] = useState(username || '')
  const [category, setCategory] = useState('Leak')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [toast, setToast] = useState('')

  useEffect(() => {
    let alive = true
    fetchGraph().then((g) => {
      if (!alive) return
      const set = new Set()
      g.graph.nodes.forEach((n) => {
        if (n.street && !n.street.startsWith('Junction')) set.add(n.street)
      })
      const sorted = naturalSortStreets([...set]).slice(0, 40)
      setLocalities(sorted)
      if (!locality && sorted.length > 0) setLocality(zone || sorted[0])
    })
    return () => { alive = false }
  }, [])   // eslint-disable-line

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!message.trim()) return
    setSubmitting(true)
    try {
      await addComplaint(locality, name || 'Anonymous', `[${category}] ${message}`)
      setToast('✅ Complaint submitted — officials will be notified.')
      setMessage('')
      setTimeout(() => setToast(''), 4000)
    } catch (err) {
      setToast('⚠️ ' + (err?.message || 'Submission failed'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AppLayout>
      <div className="p-6 max-w-3xl">
        <div className="mb-6 pb-5 border-b border-border">
          <div className="hero-sub mb-1">Citizen Portal · Submission</div>
          <h1 className="hero-title">Report an Issue</h1>
          <div className="text-xs text-muted mt-1">
            Signed in as {username}{zone ? ` · ${zone}` : ''}
          </div>
        </div>

        {toast && (
          <div
            className={`card p-3 mb-4 text-sm ${toast.startsWith('✅') ? 'border-success/40 bg-success/5 text-success' : 'border-danger/40 bg-danger/5 text-danger'
              }`}
          >
            {toast}
          </div>
        )}

        <form onSubmit={handleSubmit} className="card p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Locality</label>
            <select
              className="input"
              value={locality}
              onChange={(e) => setLocality(e.target.value)}
            >
              {localities.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Your name</label>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Issue type</label>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${category === c
                    ? 'bg-primary/15 text-primary border-primary/40'
                    : 'bg-panel text-muted border-border hover:text-text'
                    }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Describe the issue</label>
            <textarea
              className="input min-h-[120px]"
              placeholder="e.g. Water pooling near the junction since morning…"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>

          <button
            type="submit"
            disabled={submitting || !message.trim()}
            className="btn btn-primary w-full disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? 'Submitting…' : 'Submit Complaint'}
          </button>
        </form>
      </div>
    </AppLayout>
  )
}