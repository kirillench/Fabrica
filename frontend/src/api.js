// ---------------------------------------------------------------------------
// Токен доступа (уровень 1 безопасности). Если бэкенд запущен с APP_TOKENS,
// все запросы идут с Authorization: Bearer; 401 переводит UI на экран входа.
// ---------------------------------------------------------------------------

let token = localStorage.getItem('app_token') || ''

export const hasToken = () => Boolean(token)

export function setToken(t) {
  token = t.trim()
  localStorage.setItem('app_token', token)
}

export function clearToken() {
  token = ''
  localStorage.removeItem('app_token')
}

function headers(extra = {}) {
  return token ? { ...extra, Authorization: `Bearer ${token}` } : extra
}

async function json(res) {
  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent('auth-required'))
    throw new Error('Требуется токен доступа')
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail || `HTTP ${res.status}`)
  }
  return res.json()
}

const get = (url) => fetch(url, { headers: headers() }).then(json)

const send = (url, method, payload) =>
  fetch(url, {
    method,
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  }).then(json)

// ---------------------------------------------------------------------------

export const getHealth = () => fetch('/api/health').then(json) // открыт без токена

export const getMe = () => get('/api/me')

export const listDocuments = () => get('/api/documents')

export const listDomains = () => get('/api/domains')

export function uploadFiles(files, domain) {
  const form = new FormData()
  for (const f of files) form.append('files', f)
  if (domain) form.append('domain', domain)
  return fetch('/api/documents', {
    method: 'POST',
    headers: headers(), // Content-Type выставит браузер (multipart boundary)
    body: form,
  }).then(json)
}

export const deleteDocument = (id) =>
  fetch(`/api/documents/${id}`, { method: 'DELETE', headers: headers() }).then(json)

/** Открывает исходный документ по короткоживущей подписанной ссылке. */
export async function openDocument(docId) {
  const r = await get(`/api/documents/${docId}/link`)
  window.open(r.url, '_blank', 'noopener')
}

export const getGraph = (maxNodes = 90) => get(`/api/graph?max_nodes=${maxNodes}`)

export const generate = (payload) => send('/api/generate', 'POST', payload)

export const sendFeedback = (payload) => send('/api/feedback', 'POST', payload)

export const listSessions = () => get('/api/sessions')

export const getSession = (id) => get(`/api/sessions/${id}`)

export const createSession = () => send('/api/sessions', 'POST', {})

export const renameSession = (id, title) =>
  send(`/api/sessions/${id}`, 'PATCH', { title })

export const deleteSession = (id) =>
  fetch(`/api/sessions/${id}`, { method: 'DELETE', headers: headers() }).then(json)

export const updateHypothesis = (sessionId, hypothesisId, fields) =>
  send(`/api/sessions/${sessionId}/hypotheses/${hypothesisId}`, 'PATCH', fields)

export async function exportReport(format, goal, hypotheses, filename) {
  const res = await fetch('/api/export', {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ format, goal, hypotheses }),
  })
  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent('auth-required'))
    throw new Error('Требуется токен доступа')
  }
  if (!res.ok) throw new Error(`Экспорт не удался: HTTP ${res.status}`)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename || 'hypotheses'}.${format}`
  a.click()
  URL.revokeObjectURL(url)
}
