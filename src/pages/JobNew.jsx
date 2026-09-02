import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import JobForm from '../components/JobForm'

export default function JobNew() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const clientId = searchParams.get('client_id')

  async function handleCreate(values) {
    const { data: { user } } = await supabase.auth.getUser()
    const { data, error } = await supabase
      .from('jobs')
      .insert({ ...values, created_by: user.id })
      .select('id')
      .single()

    if (!error) navigate(`/jobs/${data.id}`)
    return { error }
  }

  return (
    <div>
      <h1>New Job</h1>
      <JobForm
        initialValues={clientId ? { client_id: clientId } : null}
        onSubmit={handleCreate}
        submitLabel="Create Job"
      />
    </div>
  )
}
