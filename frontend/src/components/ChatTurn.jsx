import { ChevronDown, Download } from 'lucide-react'
import { memo, useState } from 'react'
import { exportReport } from '../api.js'
import HypothesisCard from './HypothesisCard.jsx'

function time(iso) {
  return new Date(iso).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Компактная строка гипотезы; клик разворачивает полную карточку. */
function CompactHypothesis({ rank, hypothesis: h, goal, onFeedback, onRoadmapChange, onError }) {
  const [open, setOpen] = useState(false)

  if (open) {
    return (
      <div className="fade-up">
        <HypothesisCard
          rank={rank}
          hypothesis={h}
          goal={goal}
          onFeedback={onFeedback}
          onRoadmapChange={onRoadmapChange}
          onError={onError}
        />
        <button
          onClick={() => setOpen(false)}
          className="mt-1.5 flex items-center gap-1 text-xs text-base-400 transition hover:text-base-200"
        >
          <ChevronDown size={13} className="rotate-180" />
          Свернуть
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={() => setOpen(true)}
      className="glass-soft glass-hover flex w-full items-center gap-3 px-4 py-3 text-left"
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/10 text-xs font-semibold tabular-nums text-base-200">
        {rank + 1}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-base-100">
          {h.title}
          {h.verdict === 'confirmed' && (
            <span className="ml-2 text-xs text-base-300">✓ перспективна</span>
          )}
          {h.verdict === 'rejected' && (
            <span className="ml-2 text-xs text-base-400">✕ отклонена</span>
          )}
        </span>
        <span className="mt-0.5 block truncate text-xs text-base-400">
          {h.statement}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-lg font-semibold tabular-nums text-base-100">
          {h.score}
        </span>
      </span>
      <ChevronDown size={15} className="shrink-0 text-base-400" />
    </button>
  )
}

/**
 * Один ход сессии: пузырь запроса (справа) + ответ с гипотезами (слева),
 * как в чате. memo: при правке гипотезы другого хода не ре-рендерится
 * (turn сохраняет ссылочную идентичность благодаря structural sharing).
 */
function ChatTurn({ turn, domainName, onFeedback, onRoadmapChange, onError }) {
  const req = turn.request
  const goal = req.goal

  return (
    <div className="space-y-3">
      {/* запрос пользователя */}
      <div className="flex justify-end">
        <div className="glass max-w-[85%] px-4 py-3">
          <p className="text-sm leading-relaxed text-base-100">{goal}</p>
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-base-400">
            {req.constraints && <span>ограничения: {req.constraints}</span>}
            {req.excluded && <span>исключено: {req.excluded}</span>}
            {domainName && <span>{domainName}</span>}
            <span>{time(turn.created_at)}</span>
          </div>
        </div>
      </div>

      {/* ответ системы */}
      <div className="max-w-[95%] space-y-2">
        <div className="flex items-center gap-2 px-1">
          <span className="text-xs text-base-400">
            {turn.hypotheses.length} гипотез · по убыванию балла
          </span>
          <span className="ml-auto flex gap-1.5">
            {['docx', 'json', 'csv'].map((fmt) => (
              <button
                key={fmt}
                title={`Экспорт всех гипотез хода (${fmt.toUpperCase()})`}
                className="btn-ghost flex items-center gap-1 px-2 py-1 text-[11px] uppercase text-base-400"
                onClick={() =>
                  exportReport(fmt, goal, turn.hypotheses).catch((e) =>
                    onError?.(e.message),
                  )
                }
              >
                <Download size={11} />
                {fmt}
              </button>
            ))}
          </span>
        </div>
        {turn.hypotheses.map((h, i) => (
          <CompactHypothesis
            key={h.id}
            rank={i}
            hypothesis={h}
            goal={goal}
            onFeedback={onFeedback}
            onRoadmapChange={onRoadmapChange}
            onError={onError}
          />
        ))}
      </div>
    </div>
  )
}

export default memo(ChatTurn)
