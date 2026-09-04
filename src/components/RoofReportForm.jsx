import { useState } from 'react'

const ROOF_TYPES = ['Tiled Roof', 'Metal Roof', 'Asbestos Roof', 'Others']

function toArray(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

let nextPhotoKey = 0

export default function RoofReportForm({ job, onUploadPhoto, onRemovePhoto, onCreate }) {
  const [clientName, setClientName] = useState(job.clientName ?? '')
  const [propertyAddress, setPropertyAddress] = useState(job.site_address ?? '')
  const [dateOfInspection, setDateOfInspection] = useState('')
  const [inspector, setInspector] = useState('')
  const [workOrder, setWorkOrder] = useState('')
  const [roofType, setRoofType] = useState(ROOF_TYPES[0])
  const [roofAge, setRoofAge] = useState('')
  const [roofPitch, setRoofPitch] = useState('')
  const [urgentObservations, setUrgentObservations] = useState('')
  const [urgentRecommendations, setUrgentRecommendations] = useState('')
  const [preventiveObservations, setPreventiveObservations] = useState('')
  const [preventiveRecommendations, setPreventiveRecommendations] = useState('')
  // Each entry: { key, previewUrl, path, uploading, error }
  const [photos, setPhotos] = useState([])
  const [generating, setGenerating] = useState(false)
  const [formError, setFormError] = useState(null)

  async function handleFilesSelected(e) {
    const files = Array.from(e.target.files)
    e.target.value = '' // allow re-selecting the same file later

    for (const file of files) {
      const key = nextPhotoKey++
      const previewUrl = URL.createObjectURL(file)
      setPhotos((prev) => [...prev, { key, previewUrl, path: null, uploading: true, error: null }])

      const { path, error } = await onUploadPhoto(file)
      setPhotos((prev) =>
        prev.map((p) => (p.key === key ? { ...p, path, uploading: false, error: error?.message ?? null } : p))
      )
    }
  }

  async function handleRemovePhoto(key) {
    const photo = photos.find((p) => p.key === key)
    if (!photo) return
    URL.revokeObjectURL(photo.previewUrl)
    if (photo.path) {
      await onRemovePhoto(photo.path)
    }
    setPhotos((prev) => prev.filter((p) => p.key !== key))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setGenerating(true)
    setFormError(null)

    // try/finally so setGenerating(false) always runs, even if onCreate
    // (or anything above it) throws instead of returning { error } --
    // this is what let the Generate button stick forever the first time
    // (see useRoofReports.createReport's own try/catch note for the root
    // cause). onCreate is now guarded too, but this is the last line of
    // defense against the button hanging silently again for any reason.
    try {
      const photoPaths = photos.filter((p) => p.path).map((p) => p.path)

      const { error } = await onCreate(
        {
          client_name: clientName,
          property_address: propertyAddress,
          date_of_inspection: dateOfInspection || null,
          inspector,
          work_order: workOrder,
          roof_type: roofType,
          roof_age: roofAge,
          roof_pitch: roofPitch,
          urgent_observations: toArray(urgentObservations),
          urgent_recommendations: toArray(urgentRecommendations),
          preventive_observations: toArray(preventiveObservations),
          preventive_recommendations: toArray(preventiveRecommendations),
        },
        photoPaths
      )

      if (error) {
        setFormError(error.message)
        return
      }

      photos.forEach((p) => URL.revokeObjectURL(p.previewUrl))
      setPhotos([])
    } catch (err) {
      setFormError(err.message)
    } finally {
      setGenerating(false)
    }
  }

  const uploading = photos.some((p) => p.uploading)

  return (
    <form onSubmit={handleSubmit}>
      <h3>New Roof Report</h3>
      <label>
        Client/Strata/Real Estate Name
        <input value={clientName} onChange={(e) => setClientName(e.target.value)} />
      </label>
      <label>
        Work Order/Plan#
        <input value={workOrder} onChange={(e) => setWorkOrder(e.target.value)} />
      </label>
      <label>
        Property Address
        <input value={propertyAddress} onChange={(e) => setPropertyAddress(e.target.value)} />
      </label>
      <label>
        Roof Type
        <select value={roofType} onChange={(e) => setRoofType(e.target.value)}>
          {ROOF_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </label>
      <label>
        Date of Inspection
        <input type="date" value={dateOfInspection} onChange={(e) => setDateOfInspection(e.target.value)} />
      </label>
      <label>
        Roof Age
        <input value={roofAge} onChange={(e) => setRoofAge(e.target.value)} />
      </label>
      <label>
        Inspector Assigned
        <input value={inspector} onChange={(e) => setInspector(e.target.value)} />
      </label>
      <label>
        Roof Pitch
        <input value={roofPitch} onChange={(e) => setRoofPitch(e.target.value)} />
      </label>

      <fieldset>
        <legend>Urgent Repairs</legend>
        <label>
          Observation (one per line)
          <textarea value={urgentObservations} onChange={(e) => setUrgentObservations(e.target.value)} />
        </label>
        <label>
          Recommendation (one per line)
          <textarea value={urgentRecommendations} onChange={(e) => setUrgentRecommendations(e.target.value)} />
        </label>
      </fieldset>

      <fieldset>
        <legend>Preventive Repairs</legend>
        <label>
          Observation (one per line)
          <textarea value={preventiveObservations} onChange={(e) => setPreventiveObservations(e.target.value)} />
        </label>
        <label>
          Recommendation (one per line)
          <textarea value={preventiveRecommendations} onChange={(e) => setPreventiveRecommendations(e.target.value)} />
        </label>
      </fieldset>

      <label>
        Photos
        <input type="file" accept="image/*" multiple onChange={handleFilesSelected} />
      </label>
      {photos.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          {photos.map((photo) => (
            <div key={photo.key} style={{ position: 'relative' }}>
              <img
                src={photo.previewUrl}
                alt="Selected photo preview"
                style={{ width: 100, height: 100, objectFit: 'cover', opacity: photo.uploading ? 0.5 : 1 }}
              />
              {photo.uploading && <p>Uploading...</p>}
              {photo.error && <p role="alert">{photo.error}</p>}
              <button type="button" onClick={() => handleRemovePhoto(photo.key)}>
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
      {photos.length > 12 && (
        <p role="alert">{photos.length} photos attached — large reports may take longer to generate.</p>
      )}

      {formError && <p role="alert">{formError}</p>}
      <button className="btn-primary" type="submit" disabled={generating || uploading}>
        {generating ? 'Generating...' : uploading ? 'Uploading photos...' : 'Generate'}
      </button>
    </form>
  )
}
