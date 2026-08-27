import { useState } from 'react'
import { useInvoices } from '../hooks/useInvoices'
import { useJobBilling } from '../hooks/useJobBilling'
import { formatInvoiceNumber } from '../lib/jobConstants'
import { generateInvoicePdf } from '../lib/invoicePdf'
import CreateInvoiceForm from './CreateInvoiceForm'

export default function InvoiceSection({ job, client, role }) {
  const { invoices, loading, error, createInvoice, updatePaidAmount } = useInvoices(job.id)
  const { groups, otherItems } = useJobBilling(job.id, role)
  const lineItems = [...groups.flatMap((group) => group.items), ...otherItems]

  const [editingId, setEditingId] = useState(null)
  const [paidValue, setPaidValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [downloadingId, setDownloadingId] = useState(null)
  const [downloadError, setDownloadError] = useState(null)

  if (loading) return <p>Loading invoices...</p>
  if (error) return <p role="alert">Could not load invoices: {error.message}</p>

  function startEditPaid(invoice) {
    setEditingId(invoice.id)
    setPaidValue(invoice.paid_amount)
    setSaveError(null)
  }

  async function handleSavePaid(e, invoiceId) {
    e.preventDefault()
    setSaving(true)
    setSaveError(null)
    const { error } = await updatePaidAmount(invoiceId, Number(paidValue))
    setSaving(false)
    if (error) {
      setSaveError(error.message)
      return
    }
    setEditingId(null)
  }

  async function handleDownload(invoice) {
    setDownloadingId(invoice.id)
    setDownloadError(null)
    try {
      await generateInvoicePdf({ job, client, invoice })
    } catch (err) {
      setDownloadError(err.message)
    }
    setDownloadingId(null)
  }

  return (
    <section>
      <h2>Invoices</h2>
      {downloadError && <p role="alert">{downloadError}</p>}
      <table>
        <thead>
          <tr>
            <th>Invoice #</th>
            <th>Created</th>
            <th>Total (inc GST)</th>
            <th>Paid</th>
            <th>Balance Due</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((invoice) => {
            const totalIncGst = invoice.invoice_line_items.reduce((sum, item) => sum + item.total_inc_gst_snapshot, 0)
            const balanceDue = totalIncGst - invoice.paid_amount
            return (
              <tr key={invoice.id}>
                <td>{formatInvoiceNumber(job.job_number, invoice.sequence_num)}</td>
                <td>{new Date(invoice.created_at).toLocaleDateString()}</td>
                <td>${totalIncGst.toFixed(2)}</td>
                <td>
                  {editingId === invoice.id ? (
                    <form onSubmit={(e) => handleSavePaid(e, invoice.id)}>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={paidValue}
                        onChange={(e) => setPaidValue(e.target.value)}
                      />
                      {saveError && <p role="alert">{saveError}</p>}
                      <button className="btn-primary" type="submit" disabled={saving}>
                        {saving ? 'Saving...' : 'Save'}
                      </button>
                      <button type="button" onClick={() => setEditingId(null)}>
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <>
                      ${invoice.paid_amount.toFixed(2)}{' '}
                      <button type="button" onClick={() => startEditPaid(invoice)}>
                        Edit
                      </button>
                    </>
                  )}
                </td>
                <td>${balanceDue.toFixed(2)}</td>
                <td>
                  <button
                    type="button"
                    onClick={() => handleDownload(invoice)}
                    disabled={downloadingId === invoice.id}
                  >
                    {downloadingId === invoice.id ? 'Generating...' : 'Download PDF'}
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <CreateInvoiceForm lineItems={lineItems} onCreate={createInvoice} />
    </section>
  )
}
