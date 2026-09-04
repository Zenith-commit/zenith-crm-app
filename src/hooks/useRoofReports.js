import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { resizeImageFile } from '../lib/imageResize'

function sanitizeFileName(name) {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, '_')
}

export function useRoofReports(jobId) {
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const reload = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('roof_reports')
      .select('id, sequence_num, docx_path, created_at')
      .eq('job_id', jobId)
      .order('sequence_num')

    if (error) setError(error)
    else setReports(data)
    setLoading(false)
  }, [jobId])

  useEffect(() => {
    reload()
  }, [reload])

  // Uploads immediately on selection (not deferred to Generate time) --
  // this is what gives a compose-time Remove button something real to
  // delete, exercising the office delete policy on roof-report-photos
  // that the live RLS check couldn't test directly (Supabase blocks raw
  // SQL DELETE against storage.objects regardless of RLS).
  async function uploadPhoto(file) {
    const resized = await resizeImageFile(file)
    const path = `${jobId}/${Date.now()}-${sanitizeFileName(resized.name)}`
    const { error } = await supabase.storage.from('roof-report-photos').upload(path, resized)
    if (error) return { path: null, error }
    return { path, error: null }
  }

  async function removePhoto(path) {
    const { error } = await supabase.storage.from('roof-report-photos').remove([path])
    return { error }
  }

  async function createReport(formValues, photoPaths) {
    const { data, error: invokeError } = await supabase.functions.invoke('generate-roof-report', {
      body: { ...formValues, job_id: jobId, photo_paths: photoPaths },
    })

    if (invokeError) return { error: invokeError }

    const url = URL.createObjectURL(data)
    const link = document.createElement('a')
    link.href = url
    link.download = 'roof-report.docx'
    link.click()
    URL.revokeObjectURL(url)

    await reload()
    return { error: null }
  }

  async function downloadReport(report) {
    const { data, error } = await supabase.storage
      .from('roof-report-docs')
      .createSignedUrl(report.docx_path, 3600)
    if (error) return { error }
    window.open(data.signedUrl, '_blank')
    return { error: null }
  }

  return { reports, loading, error, uploadPhoto, removePhoto, createReport, downloadReport }
}
