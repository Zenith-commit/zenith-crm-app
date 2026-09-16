import { useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { useJobs } from '../hooks/useJobs'
import { useQueues } from '../hooks/useQueues'
import { JOB_STATUSES } from '../lib/jobConstants'
import JobRow from '../components/JobRow'

export default function JobList() {
  const { profile } = useOutletContext()
  const { jobs, loading, error } = useJobs(profile?.role)
  const { queues } = useQueues()
  const [statusFilter, setStatusFilter] = useState('')
  const [queueFilter, setQueueFilter] = useState('')

  if (loading) return <p>Loading...</p>
  if (error) return <p role="alert">Could not load jobs: {error.message}</p>

  const isStaff = profile?.role !== 'technician'

  const visibleJobs = jobs.filter((job) => {
    if (statusFilter && job.status !== statusFilter) return false
    if (queueFilter === 'unqueued' && job.queue_id) return false
    if (queueFilter && queueFilter !== 'unqueued' && job.queue_id !== queueFilter) return false
    return true
  })

  return (
    <div>
      <h1>Jobs</h1>
      {isStaff && <Link className="btn-primary" to="/jobs/new">Add Job</Link>}
      <label>
        Filter by status
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All</option>
          {JOB_STATUSES.map((status) => (
            <option key={status} value={status}>{status}</option>
          ))}
        </select>
      </label>
      {isStaff && (
        <label>
          Filter by queue
          <select value={queueFilter} onChange={(e) => setQueueFilter(e.target.value)}>
            <option value="">All</option>
            <option value="unqueued">Unqueued</option>
            {queues.map((queue) => (
              <option key={queue.id} value={queue.id}>{queue.name}</option>
            ))}
          </select>
        </label>
      )}
      <table>
        <thead>
          <tr>
            <th>Job #</th>
            <th>Client</th>
            <th>Site Address</th>
            <th>Status</th>
            <th>Scheduled</th>
            {isStaff && <th>Assigned To</th>}
            {isStaff && <th>Queue</th>}
          </tr>
        </thead>
        <tbody>
          {visibleJobs.map((job) => (
            <JobRow key={job.id} job={job} role={profile?.role} />
          ))}
        </tbody>
      </table>
    </div>
  )
}
