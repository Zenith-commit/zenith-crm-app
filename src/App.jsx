import { Routes, Route } from 'react-router-dom'
import AppShell from './components/AppShell'
import Dashboard from './pages/Dashboard'
import ClientList from './pages/ClientList'
import ClientNew from './pages/ClientNew'
import ClientDetail from './pages/ClientDetail'
import JobList from './pages/JobList'
import JobNew from './pages/JobNew'
import JobDetail from './pages/JobDetail'
import CatalogList from './pages/CatalogList'

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/clients" element={<ClientList />} />
        <Route path="/clients/new" element={<ClientNew />} />
        <Route path="/clients/:id" element={<ClientDetail />} />
        <Route path="/jobs" element={<JobList />} />
        <Route path="/jobs/new" element={<JobNew />} />
        <Route path="/jobs/:id" element={<JobDetail />} />
        <Route path="/catalog" element={<CatalogList />} />
        <Route path="*" element={<p>Page not found (yet)</p>} />
      </Route>
    </Routes>
  )
}
