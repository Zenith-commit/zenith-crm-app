import { useState } from 'react'
import { useOutletContext, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useJob } from '../hooks/useJob'
import JobForm from '../components/JobForm'
import { formatJobNumber } from '../lib/jobConstants'
import ClientSiteInfoSection from '../components/ClientSiteInfoSection'
import JobContactSection from '../components/JobContactSection'
import DiarySection from '../components/DiarySection'
import BillingSection from '../components/BillingSection'
import InvoiceSection from '../components/InvoiceSection'
import CommunicationSection from '../components/CommunicationSection'
import Modal from '../components/Modal'
import RoofReportSection from '../components/RoofReportSection'
import { useQueues } from '../hooks/useQueues'

const STAFF_TABS = ['Details', 'Job Contact', 'Billing', 'Invoicing', 'Roof Report']
const TECHNICIAN_TABS = ['Details', 'Job Contact', 'Billing']

export default function JobDetail() {
  const { id } = useParams()
  const { profile, session } = useOutletContext()
  const { job, loading, error, reload } = useJob(id, profile?.role)
  const { queues } = useQueues()
  const [editing, setEditing] = useState(false)
  const [activeTab, setActiveTab] = useState('Details')
  const [openModal, setOpenModal] = useState(null) // null | 'email' | 'sms'

  if (loading) return <p>Loading...</p>
  if (error) return <p role="alert">Could not load job: {error.message}</p>
  if (!job) return <p>Job not found.</p>

  const isStaff = profile?.role !== 'technician'
  const tabs = isStaff ? STAFF_TABS : TECHNICIAN_TABS

  async function handleUpdate(values) {
    const { error } = await supabase.from('jobs').update(values).eq('id', job.id)
    if (!error) {
      setEditing(false)
      await reload()
    }
    return { error }
  }

  async function handleQueueChange(queueId) {
    const { error } = await supabase
      .from('jobs')
      .update({ queue_id: queueId || null })
      .eq('id', job.id)
    if (!error) await reload()
  }

  return (
    <div>
      <h1>{formatJobNumber(job.job_number)} — {job.clientName}</h1>
      <div className="job-detail-actions">
        {isStaff && (
          <button type="button" className="btn-primary" onClick={() => setOpenModal('email')}>
            Email
          </button>
        )}
        <button type="button" className="btn-primary" onClick={() => setOpenModal('sms')}>
          SMS
        </button>
      </div>
      <div className="job-detail-body">
        <div className="job-detail-main">
          <nav className="job-detail-tabs">
            {tabs.map((tab) => (
              <button
                key={tab}
                type="button"
                className={tab === activeTab ? 'job-detail-tab active' : 'job-detail-tab'}
                onClick={() => setActiveTab(tab)}
              >
                {tab}
              </button>
            ))}
          </nav>
          <div className="job-detail-tab-content">
            {activeTab === 'Details' && (
              <>
                {isStaff && editing ? (
                  <JobForm initialValues={job} onSubmit={handleUpdate} submitLabel="Save Changes" />
                ) : (
                  <div>
                    <p>Status: {job.status}</p>
                    {isStaff && (
                      <p className="queue-picker">
                        <label htmlFor="job-queue-select">Queue</label>
                        <select
                          id="job-queue-select"
                          value={job.queueId ?? ''}
                          onChange={(e) => handleQueueChange(e.target.value)}
                        >
                          <option value="">Unqueued</option>
                          {queues.map((queue) => (
                            <option key={queue.id} value={queue.id}>{queue.name}</option>
                          ))}
                        </select>
                      </p>
                    )}
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
              </>
            )}
            {activeTab === 'Job Contact' && (
              <JobContactSection jobId={job.id} isStaff={isStaff} userId={session.user.id} />
            )}
            {activeTab === 'Billing' && <BillingSection jobId={job.id} role={profile?.role} />}
            {activeTab === 'Invoicing' && isStaff && (
              <InvoiceSection
                job={job}
                client={{ name: job.clientName, address: job.clientAddress }}
                role={profile?.role}
              />
            )}
            {activeTab === 'Roof Report' && isStaff && <RoofReportSection job={job} />}
          </div>
        </div>
        <aside className="job-activity-panel">
          <DiarySection jobId={job.id} userId={session.user.id} />
        </aside>
      </div>
      {openModal === 'email' && (
        <Modal onClose={() => setOpenModal(null)}>
          <CommunicationSection
            jobId={job.id}
            type="email"
            recipientDefault={job.clientEmail}
            role={profile?.role}
          />
        </Modal>
      )}
      {openModal === 'sms' && (
        <Modal onClose={() => setOpenModal(null)}>
          <CommunicationSection
            jobId={job.id}
            type="sms"
            recipientDefault={job.clientPhone}
            role={profile?.role}
          />
        </Modal>
      )}
    </div>
  )
}
