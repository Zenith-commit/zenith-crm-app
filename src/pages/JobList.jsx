import { useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { useJobs } from '../hooks/useJobs'
import { JOB_STATUSES } from '../lib/jobConstants'
import JobRow from '../components/JobRow'

export default function JobList() {
  const { profile } = useOutletContext()
  const { jobs, loading, error } = useJobs(profile?.role)
  const [statusFilter, setStatusFilter] = useState('')

  if (loading) return <p>Loading...</p>
  if (error) return <p role="alert">Could not load jobs: {error.message}</p>

  const isStaff = profile?.role !== 'technician'
  const visibleJobs = statusFilter ? jobs.filter((job) => job.status === statusFilter) : jobs

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
      <table>
        <thead>
          <tr>
            <th>Client</th>
            <th>Job Type</th>
            <th>Status</th>
            {isStaff && <th>Assigned To</th>}
            {isStaff && <th>Quoted Price</th>}
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
