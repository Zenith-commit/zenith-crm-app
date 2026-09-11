import { useState } from 'react'
import { useQueues } from '../hooks/useQueues'

export default function QueueList() {
  const { queues, loading, error, create, rename, countJobsInQueue, remove } = useQueues()
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [formError, setFormError] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editingName, setEditingName] = useState('')

  if (loading) return <p>Loading...</p>
  if (error) return <p role="alert">Could not load queues: {error.message}</p>

  async function handleCreate(e) {
    e.preventDefault()
    if (!newName.trim()) return
    setCreating(true)
    setFormError(null)
    const { error } = await create(newName.trim())
    setCreating(false)
    if (error) {
      setFormError(error.message)
      return
    }
    setNewName('')
  }

  function startRename(queue) {
    setEditingId(queue.id)
    setEditingName(queue.name)
    setFormError(null)
  }

  async function handleRename(id) {
    if (!editingName.trim()) return
    const { error } = await rename(id, editingName.trim())
    if (error) {
      setFormError(error.message)
      return
    }
    setEditingId(null)
  }

  async function handleDelete(queue) {
    const count = await countJobsInQueue(queue.id)
    const message = count > 0
      ? `This queue has ${count} job${count === 1 ? '' : 's'} — they'll become unqueued. Delete anyway?`
      : 'Delete this queue?'
    if (!window.confirm(message)) return
    const { error } = await remove(queue.id)
    if (error) setFormError(error.message)
  }

  return (
    <div>
      <h1>Queues</h1>
      <form onSubmit={handleCreate}>
        <label>
          New queue name
          <input value={newName} onChange={(e) => setNewName(e.target.value)} />
        </label>
        <button className="btn-primary" type="submit" disabled={creating}>
          {creating ? 'Adding...' : 'Add Queue'}
        </button>
      </form>
      {formError && <p role="alert">{formError}</p>}
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {queues.map((queue) => (
            <tr key={queue.id}>
              <td>
                {editingId === queue.id ? (
                  <input value={editingName} onChange={(e) => setEditingName(e.target.value)} />
                ) : (
                  queue.name
                )}
              </td>
              <td>
                {editingId === queue.id ? (
                  <>
                    <button className="btn-primary" type="button" onClick={() => handleRename(queue.id)}>
                      Save
                    </button>
                    <button type="button" onClick={() => setEditingId(null)}>Cancel</button>
                  </>
                ) : (
                  <>
                    <button type="button" onClick={() => startRename(queue)}>Rename</button>
                    <button type="button" onClick={() => handleDelete(queue)}>Delete</button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
