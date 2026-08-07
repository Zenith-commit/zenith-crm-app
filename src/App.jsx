import { Routes, Route } from 'react-router-dom'
import AppShell from './components/AppShell'
import Dashboard from './pages/Dashboard'
import ClientList from './pages/ClientList'
import JobList from './pages/JobList'

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/clients" element={<ClientList />} />
        <Route path="/jobs" element={<JobList />} />
        <Route path="*" element={<p>Page not found (yet)</p>} />
      </Route>
    </Routes>
  )
}
