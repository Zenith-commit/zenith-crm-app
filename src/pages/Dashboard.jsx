import { useOutletContext } from 'react-router-dom'
import { useJobs } from '../hooks/useJobs'
import { JOB_STATUSES } from '../lib/jobConstants'

export default function Dashboard() {
  const { profile } = useOutletContext()
  const { jobs, loading, error } = useJobs(profile?.role)

  if (loading) return <p>Loading...</p>
  if (error) return <p role="alert">Could not load jobs: {error.message}</p>

  const isTechnician = profile?.role === 'technician'
  const visibleStatuses = isTechnician ? ['Scheduled'] : JOB_STATUSES

  const counts = Object.fromEntries(
    visibleStatuses.map((status) => [status, jobs.filter((job) => job.status === status).length])
  )

  return (
    <div>
      <h1>{isTechnician ? 'My Jobs' : 'Dashboard'}</h1>
      <div className="stat-cards">
        {visibleStatuses.map((status) => (
          <div className="stat-card" key={status}>
            <div className="count">{counts[status]}</div>
            <div>{status}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
