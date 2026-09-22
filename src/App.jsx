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
import CatalogNew from './pages/CatalogNew'
import CatalogDetail from './pages/CatalogDetail'
import BundleList from './pages/BundleList'
import BundleNew from './pages/BundleNew'
import BundleDetail from './pages/BundleDetail'
import FeedbackInbox from './pages/FeedbackInbox'
import QueueList from './pages/QueueList'
import Schedule from './pages/Schedule'

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
        <Route path="/catalog/new" element={<CatalogNew />} />
        <Route path="/catalog/:id" element={<CatalogDetail />} />
        <Route path="/bundles" element={<BundleList />} />
        <Route path="/bundles/new" element={<BundleNew />} />
        <Route path="/bundles/:id" element={<BundleDetail />} />
        <Route path="/queues" element={<QueueList />} />
        <Route path="/schedule" element={<Schedule />} />
        <Route path="/feedback" element={<FeedbackInbox />} />
        <Route path="*" element={<p>Page not found (yet)</p>} />
      </Route>
    </Routes>
  )
}
