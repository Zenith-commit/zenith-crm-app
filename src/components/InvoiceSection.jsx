import { useInvoices } from '../hooks/useInvoices'
import { useJobBilling } from '../hooks/useJobBilling'
import { formatInvoiceNumber } from '../lib/jobConstants'
import CreateInvoiceForm from './CreateInvoiceForm'

export default function InvoiceSection({ job, role }) {
  const { invoices, loading, error, createInvoice } = useInvoices(job.id)
  const { groups, otherItems } = useJobBilling(job.id, role)
  const lineItems = [...groups.flatMap((group) => group.items), ...otherItems]

  if (loading) return <p>Loading invoices...</p>
  if (error) return <p role="alert">Could not load invoices: {error.message}</p>

  return (
    <section>
      <h2>Invoices</h2>
      <table>
        <thead>
          <tr>
            <th>Invoice #</th>
            <th>Created</th>
            <th>Total (inc GST)</th>
            <th>Paid</th>
            <th>Balance Due</th>
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
                <td>${invoice.paid_amount.toFixed(2)}</td>
                <td>${balanceDue.toFixed(2)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <CreateInvoiceForm lineItems={lineItems} onCreate={createInvoice} />
    </section>
  )
}
