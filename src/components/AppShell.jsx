import { Link, Outlet } from 'react-router-dom'
import { useSession } from '../hooks/useSession'
import { supabase } from '../lib/supabaseClient'
import Login from '../pages/Login'
import logo from '../assets/zenith-logo.png'

export default function AppShell() {
  const { session, profile, loading } = useSession()

  if (loading) return <p>Loading...</p>
  if (!session) return <Login />

  return (
    <div className="app-shell">
      <header className="app-nav">
        <img src={logo} alt="Zenith" className="app-nav-logo" />
        <nav className="app-nav-links">
          <Link to="/">Dashboard</Link>
          <Link to="/clients">Clients</Link>
          <Link to="/jobs">Jobs</Link>
        </nav>
        <div className="app-nav-user">
          {profile ? (
            <span>{profile.full_name} ({profile.role})</span>
          ) : (
            <span>Signed in</span>
          )}
          <button onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </header>
      <main className="app-main">
        <Outlet context={{ profile }} />
      </main>
    </div>
  )
}
