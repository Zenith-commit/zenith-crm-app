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
    // Wrapped in try/catch: resizeImageFile() rejects (rather than
    // resolving) for HEIC and any other file the browser can't decode via
    // <img>/<canvas> -- without this guard, that rejection propagated
    // uncaught all the way up through handleFilesSelected's loop, so the
    // thumbnail's "uploading" state never cleared. Same unhandled-
    // rejection pattern already fixed once for the Generate button.
    try {
      const resized = await resizeImageFile(file)
      const path = `${jobId}/${Date.now()}-${sanitizeFileName(resized.name)}`
      const { error } = await supabase.storage.from('roof-report-photos').upload(path, resized)
      if (error) return { path: null, error }
      return { path, error: null }
    } catch (error) {
      return { path: null, error }
    }
  }

  async function removePhoto(path) {
    const { error } = await supabase.storage.from('roof-report-photos').remove([path])
    return { error }
  }

  async function createReport(formValues, photoPaths) {
    // Wrapped in try/catch as defense-in-depth: a prior version of this
    // function let URL.createObjectURL(data) throw uncaught when data
    // wasn't actually a Blob (see the Edge Function's Content-Type fix
    // for the root cause), which became an unhandled rejection with no
    // visible error -- the Generate button just stuck on "Generating..."
    // forever since setGenerating(false) was never reached. Any future
    // failure here should surface as a real formError instead.
    try {
      const { data, error: invokeError, response } = await supabase.functions.invoke('generate-roof-report', {
        body: { ...formValues, job_id: jobId, photo_paths: photoPaths },
      })

      if (invokeError) return { error: invokeError }

      const disposition = response?.headers?.get('Content-Disposition') ?? ''
      const filenameMatch = disposition.match(/filename="([^"]+)"/)
      const filename = filenameMatch ? filenameMatch[1] : 'roof-report.docx'

      const url = URL.createObjectURL(data)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      link.click()
      URL.revokeObjectURL(url)

      await reload()
      return { error: null }
    } catch (error) {
      return { error }
    }
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
