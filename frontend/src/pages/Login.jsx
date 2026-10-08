import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../AuthContext'

export default function Login() {
  const nav = useNavigate()
  const { loginCitizen, loginOfficial } = useAuth()

  const [citUser, setCitUser] = useState('')
  const [citPass, setCitPass] = useState('')
  const [offUser, setOffUser] = useState('')
  const [offPass, setOffPass] = useState('')
  const [err, setErr] = useState({ cit: '', off: '' })

  const handleCitizen = (e) => {
    e.preventDefault()
    const r = loginCitizen(citUser, citPass)
    if (!r.ok) return setErr((p) => ({ ...p, cit: r.msg }))
    nav('/citizen')
  }

  const handleOfficial = (e) => {
    e.preventDefault()
    const r = loginOfficial(offUser, offPass)
    if (!r.ok) return setErr((p) => ({ ...p, off: r.msg }))
    nav('/official')
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 py-12">
      {/* Hero */}
      <div className="text-center mb-12">
        <div className="hero-sub mb-3">Municipal Digital Twin · Mumbai</div>
        <div className="text-5xl font-extrabold tracking-tight text-text mb-4">
          💧 Water Loss Isolation Engine
        </div>
        <div className="text-sm text-muted">
          Real-time pipeline monitoring · Leak, theft and burst detection
        </div>
      </div>

      {/* Three cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-5xl">
        {/* Citizen */}
        <form onSubmit={handleCitizen} className="card p-6 flex flex-col">
          <div className="text-xl font-semibold mb-1">🏘️ Citizen</div>
          <div className="text-sm text-muted mb-6">
            Report issues and view your zone's water status.
          </div>
          <input
            className="input mb-3"
            placeholder="Your name (e.g. Priya)"
            value={citUser}
            onChange={(e) => setCitUser(e.target.value)}
          />
          <input
            className="input mb-3"
            type="password"
            placeholder="Password (citizen123)"
            value={citPass}
            onChange={(e) => setCitPass(e.target.value)}
          />
          {err.cit && <div className="text-danger text-xs mb-3">{err.cit}</div>}
          <button type="submit" className="btn btn-primary w-full mt-auto">
            Sign in as Citizen
          </button>
        </form>

        {/* Official */}
        <form onSubmit={handleOfficial} className="card p-6 flex flex-col">
          <div className="text-xl font-semibold mb-1">🛠️ Official</div>
          <div className="text-sm text-muted mb-6">
            Full-city monitoring and citizen ticket queue.
          </div>
          <input
            className="input mb-3"
            placeholder="Username (admin)"
            value={offUser}
            onChange={(e) => setOffUser(e.target.value)}
          />
          <input
            className="input mb-3"
            type="password"
            placeholder="Password (admin123)"
            value={offPass}
            onChange={(e) => setOffPass(e.target.value)}
          />
          {err.off && <div className="text-danger text-xs mb-3">{err.off}</div>}
          <button type="submit" className="btn btn-primary w-full mt-auto">
            Sign in as Official
          </button>
        </form>

        {/* Hardware */}
        <div className="card p-6 flex flex-col">
          <div className="text-xl font-semibold mb-1">🔌 Hardware Live</div>
          <div className="text-sm text-muted mb-6">
            Public monitoring of the ESP32 physical rig — no login required.
          </div>
          <div className="flex-1" />
          <button onClick={() => nav('/hardware')} className="btn btn-primary w-full">
            Open Hardware Monitor
          </button>
        </div>
      </div>

      <div className="mt-12 text-xs text-dim text-center">
        Semester 5 · AI &amp; Data Science Mini Project · Real Mumbai street data via OpenStreetMap
      </div>
    </div>
  )
}