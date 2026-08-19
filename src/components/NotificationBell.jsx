import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useUnreadNotifications } from '../hooks/useUnreadNotifications'
import { formatJobNumber } from '../lib/jobConstants'

export default function NotificationBell({ role }) {
  const { items, markRead } = useUnreadNotifications(role)
  const [open, setOpen] = useState(false)

  function handleItemClick(id) {
    setOpen(false)
    markRead(id)
  }

  return (
    <div className="notification-bell">
      <button onClick={() => setOpen((prev) => !prev)}>
        🔔 {items.length > 0 && <span className="notification-badge">{items.length}</span>}
      </button>
      {open && (
        <div className="notification-dropdown">
          {items.length === 0 ? (
            <p>No unread messages.</p>
          ) : (
            <ul>
              {items.map((item) => (
                <li key={item.id}>
                  <Link to={`/jobs/${item.job.id}`} onClick={() => handleItemClick(item.id)}>
                    {formatJobNumber(item.job.job_number)} — {item.job.clientName}
                    <br />
                    ({item.type.toUpperCase()} from {item.sender}) {item.body}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
