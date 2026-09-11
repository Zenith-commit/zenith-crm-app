import { Link } from 'react-router-dom'
import { formatJobNumber } from '../lib/jobConstants'

export default function JobRow({ job, role }) {
  const isStaff = role !== 'technician'

  return (
    <tr>
      <td>{formatJobNumber(job.job_number)}</td>
      <td><Link to={`/jobs/${job.id}`}>{job.clientName}</Link></td>
      <td>{job.site_address || '—'}</td>
      <td>{job.status}</td>
      {isStaff && <td>{job.assignedName}</td>}
      {isStaff && <td>{job.queueName}</td>}
    </tr>
  )
}
