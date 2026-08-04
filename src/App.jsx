import { useEffect, useState } from 'react'
import { supabase } from './lib/supabaseClient'
import Login from './pages/Login'

export default function App() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) {
      setProfile(null)
      return
    }
    supabase
      .from('users')
      .select('full_name, role')
      .eq('id', session.user.id)
      .single()
      .then(({ data }) => setProfile(data))
  }, [session])

  if (loading) return <p>Loading...</p>
  if (!session) return <Login />

  return (
    <div>
      <h1>Zenith CRM</h1>
      {profile ? (
        <p>
          Signed in as {profile.full_name} ({profile.role})
        </p>
      ) : (
        <p>Signed in, but no staff profile found for this account yet.</p>
      )}
      <button onClick={() => supabase.auth.signOut()}>Sign out</button>
    </div>
  )
}
