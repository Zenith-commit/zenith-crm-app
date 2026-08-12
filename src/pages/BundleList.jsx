import { Link } from 'react-router-dom'
import { useBundles } from '../hooks/useBundles'

export default function BundleList() {
  const { bundles, loading, error } = useBundles()

  if (loading) return <p>Loading...</p>
  if (error) return <p role="alert">Could not load bundles: {error.message}</p>

  return (
    <div>
      <h1>Bundles</h1>
      <Link className="btn-primary" to="/bundles/new">Add Bundle</Link>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Item #</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {bundles.map((bundle) => (
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
