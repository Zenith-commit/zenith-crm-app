import { Link } from 'react-router-dom'

export default function JobRow({ job, role }) {
  const isStaff = role !== 'technician'

  return (
    <tr>
      <td><Link to={`/jobs/${job.id}`}>{job.clientName}</Link></td>
      <td>{job.site_address || '—'}</td>
      <td>{job.status}</td>
      {isStaff && <td>{job.assignedName}</td>}
    </tr>
  )
}
