import { useEffect, useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useJobs } from '../hooks/useJobs'
import ClientForm from '../components/ClientForm'
import JobRow from '../components/JobRow'

export default function ClientDetail() {
  const { id } = useParams()
  const { profile } = useOutletContext()
  const navigate = useNavigate()
  const [client, setClient] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState(null)
  const { jobs } = useJobs(profile?.role)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    supabase
      .from('clients')
      .select('id, name, phone, email, address, notes')
      .eq('id', id)
      .single()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) setError(error)
        else setClient(data)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id])

  if (loading) return <p>Loading...</p>
  if (error) return <p role="alert">Could not load client: {error.message}</p>
  if (!client) return <p>Client not found.</p>

  const isStaff = profile?.role !== 'technician'
  const clientJobs = jobs.filter((job) => job.client_id === id)

  async function handleUpdate(values) {
    const { error } = await supabase.from('clients').update(values).eq('id', id)
    if (!error) {
      setClient({ ...client, ...values })
      setEditing(false)
    }
    return { error }
  }

  async function handleDelete() {
    if (
      !window.confirm(`Permanently delete "${client.name}"? This cannot be undone.`)
    ) {
      return
    }
    setDeleting(true)
    setDeleteError(null)
    const { error } = await supabase.from('clients').delete().eq('id', id)
    if (error) {
      setDeleting(false)
      setDeleteError(
        error.code === '23503'
          ? "This client can't be deleted because they have job history."
          : error.message
      )
      return
    }
    navigate('/clients')
  }

  return (
    <div>
      <h1>{client.name}</h1>
      {isStaff && editing ? (
        <ClientForm initialValues={client} onSubmit={handleUpdate} submitLabel="Save Changes" />
      ) : (
        <div>
          <p>Phone: {client.phone}</p>
          <p>Email: {client.email}</p>
          <p>Address: {client.address}</p>
          <p>Notes: {client.notes}</p>
          {isStaff && (
            <button className="btn-primary" onClick={() => setEditing(true)}>
              Edit Client
            </button>
          )}
          {profile?.role === 'admin' && (
            <button onClick={handleDelete} disabled={deleting}>
              {deleting ? 'Deleting...' : 'Delete Permanently'}
            </button>
          )}
          {deleteError && <p role="alert">{deleteError}</p>}
        </div>
      )}
      <h2>Job History</h2>
      <table>
        <thead>
          <tr>
            <th>Client</th>
            <th>Site Address</th>
            <th>Status</th>
            {isStaff && <th>Assigned To</th>}
          </tr>
        </thead>
        <tbody>
          {clientJobs.map((job) => (
            <JobRow key={job.id} job={job} role={profile?.role} />
          ))}
        </tbody>
      </table>
    </div>
  )
}
