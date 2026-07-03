async function json(res) {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail || `HTTP ${res.status}`)
  }
  return res.json()
}

export const getHealth = () => fetch('/api/health').then(json)

export const listDocuments = () => fetch('/api/documents').then(json)

export const listDomains = () => fetch('/api/domains').then(json)

export function uploadFiles(files, domain) {
  const form = new FormData()
  for (const f of files) form.append('files', f)
  if (domain) form.append('domain', domain)
  return fetch('/api/documents', { method: 'POST', body: form }).then(json)
}

export const deleteDocument = (id) =>
  fetch(`/api/documents/${id}`, { method: 'DELETE' }).then(json)

export const generate = (payload) =>
  fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then(json)

export const sendFeedback = (payload) =>
  fetch('/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then(json)

export const listSessions = () => fetch('/api/sessions').then(json)

export const getSession = (id) => fetch(`/api/sessions/${id}`).then(json)

export const createSession = () =>
  fetch('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  }).then(json)

export const renameSession = (id, title) =>
  fetch(`/api/sessions/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  }).then(json)

export const deleteSession = (id) =>
  fetch(`/api/sessions/${id}`, { method: 'DELETE' }).then(json)

export const updateHypothesis = (sessionId, hypothesisId, fields) =>
  fetch(`/api/sessions/${sessionId}/hypotheses/${hypothesisId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  }).then(json)

export async function exportReport(format, goal, hypotheses, filename) {
  const res = await fetch('/api/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ format, goal, hypotheses }),
  })
  if (!res.ok) throw new Error(`Экспорт не удался: HTTP ${res.status}`)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename || 'hypotheses'}.${format}`
  a.click()
  URL.revokeObjectURL(url)
}
