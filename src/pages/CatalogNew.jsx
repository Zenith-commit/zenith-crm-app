import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import CatalogForm from '../components/CatalogForm'

export default function CatalogNew() {
  const navigate = useNavigate()

  async function handleCreate(values) {
    const { data, error } = await supabase
      .from('materials_catalog')
      .insert(values)
      .select('id')
      .single()

    if (!error) navigate(`/catalog/${data.id}`)
    return { error }
  }

  return (
    <div>
      <h1>New Catalog Item</h1>
      <CatalogForm initialValues={null} onSubmit={handleCreate} submitLabel="Create Item" />
    </div>
  )
}
