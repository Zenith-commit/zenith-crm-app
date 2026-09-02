import { supabase } from '../lib/supabaseClient'

function sanitizeFileName(name) {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, '_')
}

export function useFeedback() {
  async function submit({ message, photoFiles }) {
    const { data: { user } } = await supabase.auth.getUser()
    const photoPaths = []

    for (const file of photoFiles) {
      const path = `${user.id}/${Date.now()}-${sanitizeFileName(file.name)}`
      const { error: uploadError } = await supabase.storage
        .from('feedback-photos')
        .upload(path, file)
      if (uploadError) return { error: uploadError }
      photoPaths.push(path)
    }

    const { error: insertError } = await supabase.from('feedback').insert({
      submitted_by: user.id,
      message,
      photo_paths: photoPaths,
    })

    if (insertError) return { error: insertError }
    return { error: null }
  }

  return { submit }
}
