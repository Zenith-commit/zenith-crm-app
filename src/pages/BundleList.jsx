import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useBundles } from '../hooks/useBundles'

export default function BundleList() {
  const { bundles, loading, error } = useBundles()
  const [hideArchived, setHideArchived] = useState(true)

  if (loading) return <p>Loading...</p>
  if (error) return <p role="alert">Could not load bundles: {error.message}</p>

  const visibleBundles = hideArchived ? bundles.filter((bundle) => bundle.active) : bundles

  return (
    <div>
      <h1>Bundles</h1>
      <Link className="btn-primary" to="/bundles/new">Add Bundle</Link>
      <label>
        <input
          type="checkbox"
          checked={hideArchived}
          onChange={(e) => setHideArchived(e.target.checked)}
        />
        Hide archived bundles
      </label>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Item #</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {visibleBundles.map((bundle) => (
            <tr key={bundle.id}>
              <td><Link to={`/bundles/${bundle.id}`}>{bundle.name}</Link></td>
              <td>{bundle.item_number || '—'}</td>
              <td>{bundle.active ? 'Active' : 'Archived'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
