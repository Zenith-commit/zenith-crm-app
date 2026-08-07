import { Link } from 'react-router-dom'
import { useClients } from '../hooks/useClients'

export default function ClientList() {
  const { clients, loading, error } = useClients()

  if (loading) return <p>Loading...</p>
  if (error) return <p role="alert">Could not load clients: {error.message}</p>

  return (
    <div>
      <h1>Clients</h1>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Phone</th>
            <th>Email</th>
          </tr>
        </thead>
        <tbody>
          {clients.map((client) => (
            <tr key={client.id}>
              <td><Link to={`/clients/${client.id}`}>{client.name}</Link></td>
              <td>{client.phone}</td>
              <td>{client.email}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
