import { useState } from 'react'

export default function MaterialPicker({ materials, onSelect, selectedLabel, placeholder }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  const filtered = query
    ? materials.filter((material) => {
        const q = query.toLowerCase()
        return (
          material.description.toLowerCase().includes(q) ||
          (material.item_number ?? '').toLowerCase().includes(q)
        )
      })
    : materials

  function handleSelect(material) {
    onSelect(material)
    setQuery('')
    setOpen(false)
  }

  return (
    <div className="material-picker">
      <input
        type="text"
        value={open ? query : selectedLabel}
        placeholder={placeholder}
        onFocus={() => {
          setQuery('')
          setOpen(true)
        }}
        onBlur={() => setOpen(false)}
        onChange={(e) => setQuery(e.target.value)}
      />
      {open && (
        <ul className="material-picker-results">
          {filtered.length === 0 ? (
            <li className="material-picker-empty">No matches</li>
          ) : (
            filtered.map((material) => (
              <li key={material.id}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    handleSelect(material)
                  }}
                >
                  {material.item_number ? `${material.item_number} — ` : ''}
                  {material.description}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
