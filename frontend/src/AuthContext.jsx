/**
 * AuthContext.jsx -- login state.
 * Stores { role, username, zone } in localStorage so a page refresh keeps you signed in.
 */
import { createContext, useContext, useEffect, useState } from 'react'

const AuthContext = createContext(null)

const STORAGE_KEY = 'wle_auth'

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      return raw ? JSON.parse(raw) : { role: null, username: null, zone: null }
    } catch {
      return { role: null, username: null, zone: null }
    }
  })

  useEffect(() => {
    if (auth.role) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(auth))
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
  }, [auth])

  const loginCitizen = (username, password) => {
    if (!username.trim()) return { ok: false, msg: 'Please enter your name.' }
    if (password !== 'citizen123') return { ok: false, msg: 'Incorrect password.' }
    setAuth({ role: 'Citizen', username: username.trim(), zone: null })
    return { ok: true }
  }

  const loginOfficial = (username, password) => {
    if (username !== 'admin' || password !== 'admin123') {
      return { ok: false, msg: 'Invalid official credentials.' }
    }
    setAuth({ role: 'Official', username, zone: null })
    return { ok: true }
  }

  const setZone = (zone) => {
    setAuth((prev) => ({ ...prev, zone }))
  }

  const logout = () => {
    setAuth({ role: null, username: null, zone: null })
  }

  return (
    <AuthContext.Provider value={{ ...auth, loginCitizen, loginOfficial, setZone, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}