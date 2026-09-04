const HEIC_TYPES = ['image/heic', 'image/heif']
const HEIC_EXTENSION_PATTERN = /\.(heic|heif)$/i

// Chrome and Firefox cannot decode HEIC/HEIF via <img>/<canvas> at all, in
// any current version, on any OS -- this is a permanent licensing
// limitation (HEVC patents), not a bug that could be fixed by adjusting
// the canvas code below. Detected and rejected up front with an
// actionable message rather than attempting (and hanging on) a decode
// that can never succeed in these browsers.
function isHeic(file) {
  return HEIC_TYPES.includes(file.type) || HEIC_EXTENSION_PATTERN.test(file.name)
}

const HEIC_ERROR_MESSAGE =
  'This photo is in HEIC format, which isn\'t supported. To fix this permanently: on your iPhone, go to Settings → Camera → Formats → select "Most Compatible." This is a one-time change — all future photos will save as JPEG automatically.'

export function resizeImageFile(file, { maxDimension = 1600, quality = 0.8 } = {}) {
  if (isHeic(file)) {
    return Promise.reject(new Error(HEIC_ERROR_MESSAGE))
  }

  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)

    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(maxDimension / img.width, maxDimension / img.height, 1)
      const width = Math.round(img.width * scale)
      const height = Math.round(img.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, width, height)
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Failed to resize image'))
            return
          }
          resolve(new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' }))
        },
        'image/jpeg',
        quality
      )
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load image for resizing'))
    }

    img.src = url
  })
}
