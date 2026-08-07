import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import ClientForm from '../components/ClientForm'

export default function ClientNew() {
  const navigate = useNavigate()

  async function handleCreate(values) {
    const { data: { user } } = await supabase.auth.getUser()
    const { data, error } = await supabase
      .from('clients')
      .insert({ ...values, created_by: user.id })
      .select('id')
      .single()

    if (!error) navigate(`/clients/${data.id}`)
    return { error }
  }

  return (
    <div>
      <h1>New Client</h1>
      <ClientForm initialValues={null} onSubmit={handleCreate} submitLabel="Create Client" />
    </div>
  )
}
