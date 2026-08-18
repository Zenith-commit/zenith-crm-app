export const JOB_STATUSES = ['Quote', 'Work Order', 'Scheduled', 'Completed']

export function formatJobNumber(jobNumber) {
  return `Job #${String(jobNumber).padStart(4, '0')}`
}
