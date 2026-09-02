import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export function useJobBilling(jobId, role) {
  const [groups, setGroups] = useState([])
  const [otherItems, setOtherItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)

    if (role === 'technician') {
      const [bundlesResult, itemsResult] = await Promise.all([
        supabase.rpc('get_my_job_applied_bundles', { target_job_id: jobId }),
        supabase.rpc('get_my_job_line_items', { target_job_id: jobId }),
      ])
      if (bundlesResult.error) {
        setError(bundlesResult.error)
        setLoading(false)
        return
      }
      if (itemsResult.error) {
        setError(itemsResult.error)
        setLoading(false)
        return
      }
      const items = itemsResult.data ?? []
      const headers = bundlesResult.data ?? []
      setGroups(
        headers.map((header) => ({
          id: header.id,
          bundle_name_snapshot: header.bundle_name_snapshot,
          items: items.filter((item) => item.applied_bundle_id === header.id),
        }))
      )
      setOtherItems(items.filter((item) => item.applied_bundle_id === null))
      setLoading(false)
      return
    }

    const [bundlesResult, itemsResult] = await Promise.all([
      supabase
        .from('job_applied_bundles')
        .select('id, bundle_name_snapshot')
        .eq('job_id', jobId)
        .order('applied_at'),
      supabase
        .from('job_line_items')
        .select(
          'id, job_id, materials_catalog_id, item_code_snapshot, item_name_snapshot, qty, cost_inc_gst_snapshot, markup_pct, price_inc_gst, total_inc_gst, applied_bundle_id'
        )
        .eq('job_id', jobId)
        .order('created_at'),
    ])
    if (bundlesResult.error) {
      setError(bundlesResult.error)
      setLoading(false)
      return
    }
    if (itemsResult.error) {
      setError(itemsResult.error)
      setLoading(false)
      return
    }
    const items = itemsResult.data
    const headers = bundlesResult.data
    setGroups(
      headers.map((header) => ({
        id: header.id,
        bundle_name_snapshot: header.bundle_name_snapshot,
        items: items.filter((item) => item.applied_bundle_id === header.id),
      }))
    )
    setOtherItems(items.filter((item) => item.applied_bundle_id === null))
    setLoading(false)
  }, [jobId, role])

  useEffect(() => {
    if (!role) return
    reload()
  }, [reload, role])

  return { groups, otherItems, loading, error, reload }
}
