import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './AuthContext'
import Login from './pages/Login'
import CitizenHome from './pages/CitizenHome'
import CitizenNotices from './pages/CitizenNotices'
import CitizenReport from './pages/CitizenReport'
import OfficialHome from './pages/OfficialHome'
import OfficialControls from './pages/OfficialControls'
import OfficialActions from './pages/OfficialActions'
import HardwareLive from './pages/HardwareLive'
import TrackComplaint from './pages/TrackComplaint'

function RequireRole({ role, children }) {
  const { role: current } = useAuth()
  if (current !== role) return <Navigate to="/" replace />
  return children
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Login />} />

      {/* Citizen */}
      <Route path="/citizen"           element={<RequireRole role="Citizen"><CitizenHome /></RequireRole>} />
      <Route path="/citizen/notices"   element={<RequireRole role="Citizen"><CitizenNotices /></RequireRole>} />
      <Route path="/citizen/report"    element={<RequireRole role="Citizen"><CitizenReport /></RequireRole>} />
      <Route path="/citizen/track/:id" element={<RequireRole role="Citizen"><TrackComplaint /></RequireRole>} />

      {/* Official */}
      <Route path="/official"          element={<RequireRole role="Official"><OfficialHome /></RequireRole>} />
      <Route path="/official/controls" element={<RequireRole role="Official"><OfficialControls /></RequireRole>} />
      <Route path="/official/actions"  element={<RequireRole role="Official"><OfficialActions /></RequireRole>} />

      {/* Public */}
      <Route path="/hardware" element={<HardwareLive />} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  )
}