import { Link } from 'react-router-dom'

export default function JobRow({ job, role }) {
  const isStaff = role !== 'technician'

  return (
    <tr>
      <td><Link to={`/jobs/${job.id}`}>{job.clientName}</Link></td>
      <td>{job.job_type}</td>
      <td>{job.status}</td>
      {isStaff && <td>{job.assignedName}</td>}
      {isStaff && <td>{job.quotedPrice != null ? `$${job.quotedPrice}` : '—'}</td>}
    </tr>
  )
}
