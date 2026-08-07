import { Routes, Route } from 'react-router-dom'
import AppShell from './components/AppShell'

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<p>Dashboard coming soon</p>} />
        <Route path="*" element={<p>Page not found (yet)</p>} />
      </Route>
    </Routes>
  )
}
