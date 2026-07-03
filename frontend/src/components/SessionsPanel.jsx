import { MessageSquarePlus, Pencil, Trash2 } from 'lucide-react'

function relativeTime(iso) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return 'только что'
  if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч назад`
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

/**
 * Правая панель: список сессий-тредов, как история чатов.
 */
export default function SessionsPanel({
  sessions,
  activeId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}) {
  return (
    <aside className="glass flex h-full flex-col p-3">
      <button
        onClick={onCreate}
        className="btn-ghost mb-3 flex items-center justify-center gap-2 px-3 py-2.5 text-sm text-base-200"
      >
        <MessageSquarePlus size={15} />
        Новая сессия
      </button>

      <div className="flex-1 space-y-1.5 overflow-y-auto">
        {sessions.length === 0 && (
          <p className="px-2 py-4 text-center text-xs leading-relaxed text-base-400">
            Здесь появится история сессий: каждая сессия — цепочка запросов
            и гипотез по одной задаче.
          </p>
        )}
        {sessions.map((s) => (
          <div
            key={s.id}
            onClick={() => onSelect(s.id)}
            className={`glass-soft glass-hover group cursor-pointer px-3 py-2.5 ${
              s.id === activeId ? 'border-white/25 bg-white/10' : ''
            }`}
          >
            <p
              className={`truncate text-sm ${
                s.id === activeId ? 'text-base-100' : 'text-base-200'
              }`}
              title={s.title}
            >
              {s.title}
            </p>
            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-base-400">
              <span>{relativeTime(s.updated_at)}</span>
              {s.hypotheses > 0 && (
                <span>· {s.hypotheses} гип.</span>
              )}
              <span className="ml-auto flex gap-1 opacity-0 transition group-hover:opacity-100">
                <button
                  title="Переименовать"
                  onClick={(e) => {
                    e.stopPropagation()
                    const title = window.prompt('Название сессии:', s.title)
                    if (title) onRename(s.id, title)
                  }}
                >
                  <Pencil size={12} className="text-base-400 hover:text-base-200" />
                </button>
                <button
                  title="Удалить сессию"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (window.confirm(`Удалить сессию «${s.title}»?`)) onDelete(s.id)
                  }}
                >
                  <Trash2 size={12} className="text-base-400 hover:text-base-200" />
                </button>
              </span>
            </div>
          </div>
        ))}
      </div>
    </aside>
  )
}
