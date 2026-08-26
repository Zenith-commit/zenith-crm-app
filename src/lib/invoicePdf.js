import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { COMPANY_INFO } from './companyInfo'
import { formatInvoiceNumber } from './jobConstants'
import { calcExGst, calcGstComponent } from './invoiceCalc'
import logoUrl from '../assets/zenith-logo.png'

async function loadImageAsDataUrl(url) {
  const response = await fetch(url)
  const blob = await response.blob()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

export async function generateInvoicePdf({ job, client, invoice }) {
  const doc = new jsPDF()
  const logoDataUrl = await loadImageAsDataUrl(logoUrl)

  doc.addImage(logoDataUrl, 'PNG', 14, 10, 28, 28)

  doc.setFontSize(9)
  doc.text(
    [
      COMPANY_INFO.name,
      COMPANY_INFO.address,
      `ABN: ${COMPANY_INFO.abn}`,
      COMPANY_INFO.phone,
      COMPANY_INFO.email,
      COMPANY_INFO.website,
    ],
    196,
    15,
    { align: 'right' }
  )

  doc.setFontSize(9)
  doc.text(['Bill To:', client.name, client.address ?? ''], 14, 48)

  doc.setFontSize(22)
  doc.setFont(undefined, 'bold')
  doc.text('INVOICE', 14, 68)
  doc.setFont(undefined, 'normal')

  const invoiceNumber = formatInvoiceNumber(job.job_number, invoice.sequence_num)
  doc.setFontSize(11)
  doc.text(invoiceNumber, 14, 76)
  doc.text(`Date: ${new Date(invoice.created_at).toLocaleDateString()}`, 14, 82)

  const rows = invoice.invoice_line_items.map((item) => [
    item.item_name_snapshot,
    String(item.qty),
    `$${calcExGst(item.unit_price_inc_gst_snapshot).toFixed(2)}`,
    `$${calcExGst(item.total_inc_gst_snapshot).toFixed(2)}`,
  ])

  autoTable(doc, {
    startY: 90,
    head: [['Description', 'QTY', 'Unit Price Ex GST', 'Total Price Ex GST']],
    body: rows,
  })

  const totalIncGst = invoice.invoice_line_items.reduce((sum, item) => sum + item.total_inc_gst_snapshot, 0)
  const subtotalExGst = calcExGst(totalIncGst)
  const gst = calcGstComponent(totalIncGst)
  const paidAmount = invoice.paid_amount ?? 0
  const balanceDue = totalIncGst - paidAmount

  const finalY = doc.lastAutoTable.finalY + 10
  doc.setFontSize(10)
  doc.text(`Subtotal (ex GST): $${subtotalExGst.toFixed(2)}`, 196, finalY, { align: 'right' })
  doc.text(`GST: $${gst.toFixed(2)}`, 196, finalY + 6, { align: 'right' })
  doc.text(`Total (inc GST): $${totalIncGst.toFixed(2)}`, 196, finalY + 12, { align: 'right' })
  doc.text(`Paid: $${paidAmount.toFixed(2)}`, 196, finalY + 18, { align: 'right' })
  doc.text(`Balance Due: $${balanceDue.toFixed(2)}`, 196, finalY + 24, { align: 'right' })

  const filename = `Invoice-${String(job.job_number).padStart(4, '0')}-${String.fromCharCode(64 + invoice.sequence_num)}.pdf`
  doc.save(filename)
}
