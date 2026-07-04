import { AlertTriangle, Database, FlaskConical, LogOut, Network, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import * as api from './api.js'
import AuthGate from './components/AuthGate.jsx'
import Background from './components/Background.jsx'
import ChatTurn from './components/ChatTurn.jsx'
import GeneratorForm from './components/GeneratorForm.jsx'
import KnowledgeGraph from './components/KnowledgeGraph.jsx'
import SessionsPanel from './components/SessionsPanel.jsx'
import Sidebar from './components/Sidebar.jsx'

export default function App() {
  const [tab, setTab] = useState('generate') // generate | knowledge | graph
  const [auth, setAuth] = useState('loading') // loading | gate | ok
  const [user, setUser] = useState('')
  const [docs, setDocs] = useState([])
  const [domains, setDomains] = useState([])
  const [domain, setDomain] = useState('mineral_processing')
  const [uploading, setUploading] = useState(false)
  const [loading, setLoading] = useState(false)
  const [sessions, setSessions] = useState([])
  const [activeSession, setActiveSession] = useState(null)
  const [health, setHealth] = useState(null)
  const [error, setError] = useState('')

  const chatEndRef = useRef(null)
  const patchTimers = useRef({})

  const refreshDocs = () =>
    api.listDocuments().then((r) => setDocs(r.documents)).catch(() => {})

  const refreshSessions = () =>
    api.listSessions().then((r) => {
      setSessions(r.sessions)
      return r.sessions
    })

  // 1. Определяем режим доступа; 401 в любой момент возвращает на экран входа
  useEffect(() => {
    api.getHealth()
      .then((h) => {
        setHealth(h)
        if (!h.auth) {
          setAuth('ok')
        } else if (!api.hasToken()) {
          setAuth('gate')
        } else {
          // токен сохранён с прошлого раза — проверяем его
          api.getMe()
            .then((me) => {
              setUser(me.user)
              setAuth('ok')
            })
            .catch(() => {}) // 401 обработает auth-required
        }
      })
      .catch(() => setError('Бэкенд недоступен — запустите uvicorn (см. README)'))

    const onAuthRequired = () => {
      api.clearToken()
      setSessions([])
      setActiveSession(null)
      setDocs([])
      setAuth('gate')
    }
    window.addEventListener('auth-required', onAuthRequired)
    return () => window.removeEventListener('auth-required', onAuthRequired)
  }, [])

  // 2. Данные загружаются только после входа
  useEffect(() => {
    if (auth !== 'ok') return
    refreshDocs()
    api.listDomains().then((r) => {
      setDomains(r.domains)
      if (r.domains.length && !r.domains.some((d) => d.id === 'mineral_processing')) {
        setDomain(r.domains[0].id)
      }
    }).catch(() => {})
    // последняя сессия открывается автоматически
    refreshSessions()
      .then((list) => {
        if (list.length) return api.getSession(list[0].id).then(setActiveSession)
        setActiveSession(null)
      })
      .catch(() => {})
  }, [auth])

  const handleLogout = () => {
    api.clearToken()
    setUser('')
    setSessions([])
    setActiveSession(null)
    setDocs([])
    setAuth('gate')
  }

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [activeSession?.turns?.length, loading])

  const openSession = (id) => {
    api.getSession(id).then(setActiveSession).catch(() => {})
  }

  const handleCreateSession = async () => {
    try {
      const s = await api.createSession()
      setActiveSession(s)
      refreshSessions()
    } catch (e) {
      setError(e.message)
    }
  }

  const handleRenameSession = async (id, title) => {
    await api.renameSession(id, title).catch(() => {})
    refreshSessions()
    if (activeSession?.id === id) setActiveSession({ ...activeSession, title })
  }

  const handleDeleteSession = async (id) => {
    await api.deleteSession(id).catch(() => {})
    const list = await refreshSessions().catch(() => [])
    if (activeSession?.id === id) {
      if (list.length) openSession(list[0].id)
      else setActiveSession(null)
    }
  }

  const handleUpload = async (files) => {
    setUploading(true)
    setError('')
    try {
      const r = await api.uploadFiles(files, domain)
      const failed = r.documents.filter((d) => d.error)
      if (failed.length) {
        setError(failed.map((f) => `${f.filename}: ${f.error}`).join('; '))
      }
      await refreshDocs()
    } catch (e) {
      setError(e.message)
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async (id) => {
    await api.deleteDocument(id).catch(() => {})
    refreshDocs()
  }

  const handleGenerate = useCallback(
    async (payload) => {
      setLoading(true)
      setError('')
      try {
        const r = await api.generate({
          ...payload,
          domain,
          session_id: activeSession?.id ?? null,
        })
        const session = await api.getSession(r.session_id)
        setActiveSession(session)
        refreshSessions()
        if (r.hypotheses.length) {
          window.dispatchEvent(new CustomEvent('bg-pulse'))
        }
      } catch (e) {
        setError(e.message)
      } finally {
        setLoading(false)
      }
    },
    [domain, activeSession?.id],
  )

  /** Локальное обновление гипотезы: клонируются только затронутые ходы,
   * остальные сохраняют ссылочную идентичность — React.memo пропускает их. */
  const patchLocal = useCallback((hypId, fields) => {
    setActiveSession((s) => {
      if (!s) return s
      let changed = false
      const turns = s.turns.map((t) => {
        if (!t.hypotheses.some((h) => h.id === hypId)) return t
        changed = true
        return {
          ...t,
          hypotheses: t.hypotheses.map((h) =>
            h.id === hypId ? { ...h, ...fields } : h,
          ),
        }
      })
      return changed ? { ...s, turns } : s
    })
  }, [])

  const activeSessionId = activeSession?.id

  const handleFeedback = useCallback(
    (h, verdict) => {
      api.sendFeedback({ hypothesis_id: h.id, title: h.title, verdict }).catch(() => {})
      if (activeSessionId) {
        api.updateHypothesis(activeSessionId, h.id, { verdict }).catch(() => {})
        patchLocal(h.id, { verdict })
      }
    },
    [activeSessionId, patchLocal],
  )

  const handleRoadmapChange = useCallback(
    (hypId, steps) => {
      patchLocal(hypId, { roadmap: steps })
      if (!activeSessionId) return
      // дебаунс: не дёргаем API на каждое нажатие клавиши в конструкторе
      clearTimeout(patchTimers.current[hypId])
      patchTimers.current[hypId] = setTimeout(() => {
        api.updateHypothesis(activeSessionId, hypId, { roadmap: steps }).catch(() => {})
      }, 600)
    },
    [activeSessionId, patchLocal],
  )

  const domainName = (id) => domains.find((d) => d.id === id)?.name

  if (auth === 'gate') {
    return (
      <div className="min-h-screen">
        <Background />
        <AuthGate
          onSuccess={(name) => {
            setUser(name)
            setAuth('ok')
          }}
        />
      </div>
    )
  }

  if (auth === 'loading') {
    return (
      <div className="min-h-screen">
        <Background />
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <Background />

      <header className="sticky top-0 z-20 px-4 pt-4">
        <div className="glass mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-5 py-3">
          <div className="glass-soft flex h-9 w-9 items-center justify-center">
            <FlaskConical size={18} className="text-base-200" />
          </div>
          <div>
            <h1 className="text-[15px] font-semibold text-base-100">
              Фабрика гипотез
            </h1>
            <p className="text-xs text-base-400">
              Генерация и приоритизация исследовательских гипотез
            </p>
          </div>

          <nav className="mx-auto flex gap-1.5">
            <button
              onClick={() => setTab('generate')}
              className={`btn-ghost flex items-center gap-1.5 px-3.5 py-2 text-sm ${
                tab === 'generate' ? 'border-white/30 text-base-100' : 'text-base-300'
              }`}
            >
              <Sparkles size={14} />
              Генерация
            </button>
            <button
              onClick={() => setTab('knowledge')}
              className={`btn-ghost flex items-center gap-1.5 px-3.5 py-2 text-sm ${
                tab === 'knowledge' ? 'border-white/30 text-base-100' : 'text-base-300'
              }`}
            >
              <Database size={14} />
              База знаний
              {docs.length > 0 && (
                <span className="rounded-full bg-white/10 px-1.5 text-xs tabular-nums text-base-300">
                  {docs.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setTab('graph')}
              className={`btn-ghost flex items-center gap-1.5 px-3.5 py-2 text-sm ${
                tab === 'graph' ? 'border-white/30 text-base-100' : 'text-base-300'
              }`}
            >
              <Network size={14} />
              Граф знаний
            </button>
          </nav>

          <div className="flex items-center gap-2">
            {domains.length > 0 && (
              <select
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                title="Предметная область (доменный пакет)"
                className="glass-input px-2.5 py-1.5 text-xs text-base-200"
                style={{ background: 'rgba(0,0,0,0.35)' }}
              >
                {domains.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            )}
            {health?.demo_mode && (
              <span className="glass-soft px-3 py-1.5 text-xs text-base-300">
                демо · LLM не подключена
              </span>
            )}
            {health && !health.demo_mode && (
              <span className="glass-soft px-3 py-1.5 text-xs text-base-300">
                {health.model}
              </span>
            )}
            {health?.auth && user && (
              <span className="glass-soft flex items-center gap-2 px-3 py-1.5 text-xs text-base-200">
                {user}
                <button onClick={handleLogout} title="Выйти">
                  <LogOut size={12} className="text-base-400 hover:text-base-200" />
                </button>
              </span>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-4">
        {tab === 'graph' && <KnowledgeGraph docs={docs} />}

        {tab === 'knowledge' && (
          <div className="mx-auto max-w-3xl">
            <Sidebar
              docs={docs}
              onUpload={handleUpload}
              onDelete={handleDelete}
              uploading={uploading}
              wide
            />
          </div>
        )}

        {tab === 'generate' && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_270px]">
            {/* лента чата + форма */}
            <div className="min-w-0">
              {activeSession?.title && activeSession.turns.length > 0 && (
                <div className="mb-3 px-1">
                  <h2 className="truncate text-sm font-medium text-base-300">
                    {activeSession.title}
                  </h2>
                </div>
              )}

              <div className="space-y-6">
                {(activeSession?.turns ?? []).map((turn) => (
                  <ChatTurn
                    key={turn.id}
                    turn={turn}
                    domainName={domainName(turn.request.domain)}
                    onFeedback={handleFeedback}
                    onRoadmapChange={handleRoadmapChange}
                    onError={setError}
                  />
                ))}

                {loading && (
                  <div className="glass-soft fade-up max-w-[95%] px-4 py-3">
                    <p className="text-sm text-base-400">
                      Анализ базы знаний и генерация гипотез…
                    </p>
                  </div>
                )}

                {!loading && !(activeSession?.turns?.length) && (
                  <div className="glass-soft px-5 py-10 text-center">
                    <p className="mx-auto max-w-lg text-sm leading-relaxed text-base-400">
                      Опишите задачу ниже — гипотезы появятся здесь, как в чате.
                      Уточняйте запрос и генерируйте снова: вся история хода
                      исследования сохранится в сессии справа. Документы для
                      обоснований — во вкладке{' '}
                      <button
                        className="text-base-200 underline decoration-white/20 underline-offset-2 hover:text-base-100"
                        onClick={() => setTab('knowledge')}
                      >
                        «База знаний»
                      </button>
                      .
                    </p>
                  </div>
                )}

                {error && (
                  <div className="glass fade-up flex items-start gap-3 border-white/10 p-4">
                    <AlertTriangle size={17} className="mt-0.5 shrink-0 text-base-300" />
                    <p className="text-sm text-base-200">{error}</p>
                  </div>
                )}
              </div>

              <div ref={chatEndRef} className="mt-4">
                <GeneratorForm onGenerate={handleGenerate} loading={loading} />
              </div>
            </div>

            {/* панель сессий справа */}
            <div className="order-first lg:order-none lg:sticky lg:top-[84px] lg:h-[calc(100vh-100px)]">
              <SessionsPanel
                sessions={sessions}
                activeId={activeSession?.id}
                onSelect={openSession}
                onCreate={handleCreateSession}
                onRename={handleRenameSession}
                onDelete={handleDeleteSession}
              />
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
