export const JOB_STATUSES = ['Quote', 'Work Order', 'Scheduled', 'Completed']

export function formatJobNumber(jobNumber) {
  return `Job #${String(jobNumber).padStart(4, '0')}`
}

export function formatInvoiceNumber(jobNumber, sequenceNum) {
  const letter = String.fromCharCode(64 + sequenceNum)
  return `Invoice #${String(jobNumber).padStart(4, '0')}-${letter}`
}

export function formatRoofReportNumber(jobNumber, sequenceNum) {
  const letter = String.fromCharCode(64 + sequenceNum)
  return `Roof Report #${String(jobNumber).padStart(4, '0')}-${letter}`
}
