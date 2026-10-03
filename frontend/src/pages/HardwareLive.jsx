import { useNavigate } from 'react-router-dom'
export default function HardwareLive() {
  const nav = useNavigate()
  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-2">Hardware Live</h1>
      <p className="text-muted mb-6">Public monitoring page — no login required.</p>
      <button onClick={() => nav('/')} className="btn btn-ghost">Back to login</button>
      <div className="mt-8 text-dim text-sm">Full hardware page — coming in Message 5.</div>
    </div>
  )
}