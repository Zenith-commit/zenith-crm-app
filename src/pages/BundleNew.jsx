import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import BundleForm from '../components/BundleForm'

export default function BundleNew() {
  const navigate = useNavigate()

  async function handleCreate({ name, item_number, description, items }) {
    const { data: bundle, error: bundleError } = await supabase
      .from('bundles')
      .insert({ name, item_number, description })
      .select('id')
      .single()

    if (bundleError) return { error: bundleError }

    if (items.length > 0) {
      const { error: itemsError } = await supabase.from('bundle_items').insert(
        items.map((item) => ({
          bundle_id: bundle.id,
          materials_catalog_id: item.materials_catalog_id,
          default_qty: item.default_qty,
          default_markup_pct: item.default_markup_pct,
        }))
      )
      if (itemsError) return { error: itemsError }
    }

    navigate(`/bundles/${bundle.id}`)
    return { error: null }
  }

  return (
    <div>
      <h1>New Bundle</h1>
      <BundleForm initialValues={null} onSubmit={handleCreate} submitLabel="Create Bundle" />
    </div>
  )
}
