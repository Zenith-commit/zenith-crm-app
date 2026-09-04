import { useRoofReports } from '../hooks/useRoofReports'
import { formatRoofReportNumber } from '../lib/jobConstants'
import RoofReportForm from './RoofReportForm'

export default function RoofReportSection({ job }) {
  const { reports, loading, error, uploadPhoto, removePhoto, createReport, downloadReport } = useRoofReports(job.id)

  if (loading) return <p>Loading roof reports...</p>
  if (error) return <p role="alert">Could not load roof reports: {error.message}</p>

  return (
    <section>
      <h2>Roof Reports</h2>
      <ul>
        {reports.map((report) => (
          <li key={report.id}>
            {formatRoofReportNumber(job.job_number, report.sequence_num)} —{' '}
            {new Date(report.created_at).toLocaleDateString()}{' '}
            <button type="button" onClick={() => downloadReport(report)}>
              Download
            </button>
          </li>
        ))}
      </ul>
      <RoofReportForm job={job} onUploadPhoto={uploadPhoto} onRemovePhoto={removePhoto} onCreate={createReport} />
    </section>
  )
}
