import { useState } from 'react'
import { useOutletContext, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useJob } from '../hooks/useJob'
import JobForm from '../components/JobForm'
import { formatJobNumber } from '../lib/jobConstants'
import ClientSiteInfoSection from '../components/ClientSiteInfoSection'
import DiarySection from '../components/DiarySection'
import BillingSection from '../components/BillingSection'

export default function JobDetail() {
  const { id } = useParams()
  const { profile } = useOutletContext()
  const { job, loading, error, reload } = useJob(id, profile?.role)
  const [editing, setEditing] = useState(false)

  if (loading) return <p>Loading...</p>
  if (error) return <p role="alert">Could not load job: {error.message}</p>
  if (!job) return <p>Job not found.</p>

  const isStaff = profile?.role !== 'technician'

  async function handleUpdate(values) {
    const { error } = await supabase.from('jobs').update(values).eq('id', job.id)
    if (!error) {
      setEditing(false)
      await reload()
    }
    return { error }
  }

  return (
    <div>
      <h1>{formatJobNumber(job.job_number)} — {job.clientName}</h1>
      {isStaff && editing ? (
        <JobForm initialValues={job} onSubmit={handleUpdate} submitLabel="Save Changes" />
      ) : (
        <div>
          <p>Status: {job.status}</p>
          {isStaff && <p>Assigned To: {job.assignedName}</p>}
          <p>Description: {job.description}</p>
          {isStaff && (
            <button className="btn-primary" onClick={() => setEditing(true)}>
              Edit Job
            </button>
          )}
        </div>
      )}
      <ClientSiteInfoSection job={job} isStaff={isStaff} onSaved={reload} />
      <BillingSection jobId={job.id} role={profile?.role} />
      <DiarySection jobId={job.id} />
    </div>
  )
}
