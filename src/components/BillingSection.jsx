import { useJobBilling } from '../hooks/useJobBilling'
import BillingGroup from './BillingGroup'

export default function BillingSection({ jobId, role }) {
  const { groups, otherItems, loading, error } = useJobBilling(jobId, role)
  const isStaff = role !== 'technician'

  if (loading) return <p>Loading billing...</p>
  if (error) return <p role="alert">Could not load billing: {error.message}</p>

  const jobTotal = isStaff
    ? [...groups.flatMap((group) => group.items), ...otherItems].reduce(
        (sum, item) => sum + (item.total_inc_gst ?? 0),
        0
      )
    : null

  return (
    <section>
      <h2>Billing</h2>
      {isStaff && <p>Job Total: ${jobTotal.toFixed(2)}</p>}
      {groups.map((group) => (
        <BillingGroup key={group.id} title={group.bundle_name_snapshot} items={group.items} isStaff={isStaff} />
      ))}
      {otherItems.length > 0 && <BillingGroup title="Other Items" items={otherItems} isStaff={isStaff} />}
    </section>
  )
}
