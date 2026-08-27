import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export function useInvoices(jobId) {
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('invoices')
      .select(
        'id, sequence_num, paid_amount, created_at, invoice_line_items(id, item_name_snapshot, qty, unit_price_inc_gst_snapshot, total_inc_gst_snapshot)'
      )
      .eq('job_id', jobId)
      .order('sequence_num')

    if (error) {
      setError(error)
      setLoading(false)
      return
    }
    setInvoices(data)
    setLoading(false)
  }, [jobId])

  useEffect(() => {
    reload()
  }, [reload])

  async function createInvoice(lineItemIds) {
    const { error } = await supabase.rpc('create_invoice', {
      target_job_id: jobId,
      line_item_ids: lineItemIds,
    })
    if (error) return { error }
    await reload()
    return { error: null }
  }

  async function updatePaidAmount(invoiceId, paidAmount) {
    const { error } = await supabase.from('invoices').update({ paid_amount: paidAmount }).eq('id', invoiceId)
    if (error) return { error }
    await reload()
    return { error: null }
  }

  return { invoices, loading, error, reload, createInvoice, updatePaidAmount }
}
