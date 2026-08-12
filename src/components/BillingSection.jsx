import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useJobBilling } from '../hooks/useJobBilling'
import { useActiveBundles } from '../hooks/useActiveBundles'
import BillingGroup from './BillingGroup'
import AddOneOffLineItemForm from './AddOneOffLineItemForm'

export default function BillingSection({ jobId, role }) {
  const { groups, otherItems, loading, error, reload } = useJobBilling(jobId, role)
  const isStaff = role !== 'technician'
  const { bundles } = useActiveBundles()
  const [selectedBundleId, setSelectedBundleId] = useState('')
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState(null)

  if (loading) return <p>Loading billing...</p>
  if (error) return <p role="alert">Could not load billing: {error.message}</p>

  async function handleApply() {
    if (!selectedBundleId) return
    setApplying(true)
    setApplyError(null)
    const { error } = await supabase.rpc('apply_bundle_to_job', {
      target_job_id: jobId,
      target_bundle_id: selectedBundleId,
    })
    setApplying(false)
    if (error) {
      setApplyError(error.message)
      return
    }
    setSelectedBundleId('')
    await reload()
  }

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
      {isStaff && (
        <div>
          <select value={selectedBundleId} onChange={(e) => setSelectedBundleId(e.target.value)}>
            <option value="">Select a bundle...</option>
            {bundles.map((bundle) => (
              <option key={bundle.id} value={bundle.id}>{bundle.name}</option>
            ))}
          </select>
          <button className="btn-primary" onClick={handleApply} disabled={!selectedBundleId || applying}>
            {applying ? 'Applying...' : 'Apply Bundle'}
          </button>
          {applyError && <p role="alert">{applyError}</p>}
        </div>
      )}
      {groups.map((group) => (
        <BillingGroup key={group.id} title={group.bundle_name_snapshot} items={group.items} isStaff={isStaff} onChanged={reload} />
      ))}
      {otherItems.length > 0 && (
        <BillingGroup title="Other Items" items={otherItems} isStaff={isStaff} onChanged={reload} />
      )}
      {isStaff && <AddOneOffLineItemForm jobId={jobId} onAdded={reload} />}
    </section>
  )
}
