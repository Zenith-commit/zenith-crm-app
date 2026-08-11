import { Link } from 'react-router-dom'
import { useMaterialsCatalog } from '../hooks/useMaterialsCatalog'

export default function CatalogList() {
  const { items, loading, error } = useMaterialsCatalog()

  if (loading) return <p>Loading...</p>
  if (error) return <p role="alert">Could not load catalog: {error.message}</p>

  return (
    <div>
      <h1>Materials &amp; Services</h1>
      <Link className="btn-primary" to="/catalog/new">Add Item</Link>
      <table>
        <thead>
          <tr>
            <th>Item #</th>
            <th>Description</th>
            <th>Type</th>
            <th>Price</th>
            <th>Purchase Cost</th>
            <th>Tax Incl.?</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>{item.item_number || '—'}</td>
              <td><Link to={`/catalog/${item.id}`}>{item.description}</Link></td>
              <td>{item.item_type}</td>
              <td>${item.price}</td>
              <td>{item.purchase_cost != null ? `$${item.purchase_cost}` : '—'}</td>
              <td>{item.price_includes_tax ? 'Yes' : 'No'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
