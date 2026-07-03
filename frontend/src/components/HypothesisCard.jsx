import {
  BookOpen, ChevronDown, Download, ExternalLink, FlaskConical, Network,
  ThumbsDown, ThumbsUp,
} from 'lucide-react'
import { memo, useState } from 'react'
import { exportReport } from '../api.js'
import MiniGraph from './MiniGraph.jsx'
import RoadmapEditor from './RoadmapEditor.jsx'

function ScoreBar({ label, value, inverted = false }) {
  const pct = (value / 10) * 100
  const good = inverted ? 10 - value : value
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-base-400">{label}</span>
        <span className="tabular-nums text-base-300">{value.toFixed(1)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${pct}%`,
            background: `rgba(232, 234, 238, ${0.35 + good * 0.06})`,
          }}
        />
      </div>
    </div>
  )
}

function Section({ icon: Icon, title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-t border-white/5 pt-3">
      <button
        type="button"
        className="flex w-full items-center gap-2 text-left text-sm font-medium text-base-200 transition hover:text-base-100"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon size={15} className="text-base-400" />
        {title}
        <ChevronDown
          size={14}
          className={`ml-auto text-base-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && <div className="fade-up mt-2.5">{children}</div>}
    </div>
  )
}

/** Обоснование с кликабельными ссылками [S1] → исходный документ. */
function RationaleText({ text, sources }) {
  const byId = Object.fromEntries((sources || []).map((s) => [s.id, s]))
  const parts = String(text || '').split(/(\[S\d+\])/g)
  return (
    <p className="text-sm leading-relaxed text-base-300">
      {parts.map((part, i) => {
        const m = part.match(/^\[(S\d+)\]$/)
        const src = m && byId[m[1]]
        if (src) {
          return (
            <a
              key={i}
              href={`/api/documents/${src.doc_id}/file`}
              target="_blank"
              rel="noreferrer"
              title={src.filename}
              className="mx-0.5 rounded bg-white/10 px-1 py-0.5 text-xs text-base-100 no-underline transition hover:bg-white/20"
            >
              {m[1]}
            </a>
          )
        }
        return <span key={i}>{part}</span>
      })}
    </p>
  )
}

function HypothesisCard({ rank, hypothesis: h, goal, onFeedback, onRoadmapChange, onError }) {
  // вердикт из сессии (персистентный) имеет приоритет
  const [voted, setVoted] = useState(h.verdict || null)

  const vote = (verdict) => {
    if (voted) return
    setVoted(verdict)
    onFeedback(h, verdict)
  }

  const download = (fmt) => {
    const slug = h.title
      .toLowerCase()
      .replace(/[^a-zа-яё0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
    exportReport(fmt, goal, [h], `гипотеза-${rank + 1}-${slug}`).catch(
      (e) => onError?.(e.message),
    )
  }

  return (
    <article className="glass fade-up p-5" style={{ animationDelay: `${rank * 60}ms` }}>
      <div className="flex items-start gap-4">
        <div className="glass-soft flex h-9 w-9 shrink-0 items-center justify-center text-sm font-semibold text-base-200">
          {rank + 1}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-[16px] font-semibold leading-snug text-base-100">
            {h.title}
          </h3>
          <p className="mt-1.5 text-sm leading-relaxed text-base-200">{h.statement}</p>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-2xl font-semibold tabular-nums text-base-100">
            {h.score}
          </div>
          <div className="text-[11px] uppercase tracking-wide text-base-400">балл</div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2.5 sm:grid-cols-4">
        <ScoreBar label="Новизна" value={h.novelty} />
        <ScoreBar label="Реализуемость" value={h.feasibility} />
        <ScoreBar label="Эффект" value={h.impact} />
        <ScoreBar label="Риск" value={h.risk} inverted />
      </div>

      <div className="mt-4 space-y-3">
        <Section icon={BookOpen} title="Обоснование и источники" defaultOpen>
          <RationaleText text={h.rationale} sources={h.sources} />
          {h.mechanism && (
            <p className="mt-2 text-sm leading-relaxed text-base-300">
              <span className="text-base-200">Механизм: </span>
              {h.mechanism}
            </p>
          )}
          {h.risks_text && (
            <p className="mt-2 text-sm leading-relaxed text-base-300">
              <span className="text-base-200">Риски: </span>
              {h.risks_text}
            </p>
          )}
          {h.sources?.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {h.sources.map((s) => (
                <div key={s.id} className="glass-soft px-3 py-2 text-xs">
                  <a
                    href={`/api/documents/${s.doc_id}/file`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 font-medium text-base-200 underline decoration-white/20 underline-offset-2 transition hover:text-base-100"
                  >
                    [{s.id}] {s.filename}
                    <ExternalLink size={11} className="text-base-400" />
                  </a>
                  {typeof s.relevance === 'number' && (
                    <span className="ml-2 text-base-400">
                      релевантность {(s.relevance * 100).toFixed(0)}%
                    </span>
                  )}
                  <p className="mt-1 leading-relaxed text-base-400">
                    «{s.snippet}…»
                  </p>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section icon={FlaskConical} title="Дорожная карта проверки — конструктор">
          <RoadmapEditor
            steps={h.roadmap || []}
            onChange={(steps) => onRoadmapChange(h.id, steps)}
          />
          {h.success_criteria && (
            <p className="mt-2.5 text-sm text-base-300">
              <span className="text-base-200">Критерий успеха: </span>
              {h.success_criteria}
            </p>
          )}
        </Section>

        {h.entities?.length > 1 && (
          <Section icon={Network} title="Граф связей гипотезы">
            <div className="glass-soft p-2">
              <MiniGraph entities={h.entities} relations={h.relations} />
            </div>
          </Section>
        )}
      </div>

      <div className="mt-4 flex items-center gap-2 border-t border-white/5 pt-3">
        <span className="mr-1 text-xs text-base-400">Оценка эксперта:</span>
        <button
          type="button"
          onClick={() => vote('confirmed')}
          disabled={!!voted}
          className={`btn-ghost flex items-center gap-1.5 px-3 py-1.5 text-xs ${
            voted === 'confirmed' ? 'border-white/30 text-base-100' : 'text-base-300'
          }`}
        >
          <ThumbsUp size={13} />
          Перспективна
        </button>
        <button
          type="button"
          onClick={() => vote('rejected')}
          disabled={!!voted}
          className={`btn-ghost flex items-center gap-1.5 px-3 py-1.5 text-xs ${
            voted === 'rejected' ? 'border-white/30 text-base-100' : 'text-base-300'
          }`}
        >
          <ThumbsDown size={13} />
          Отклонить
        </button>
        {voted && (
          <span className="fade-up text-xs text-base-400">
            Учтено — повлияет на следующие генерации
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <span className="mr-0.5 text-xs text-base-400">Скачать:</span>
          {['docx', 'json', 'csv'].map((fmt) => (
            <button
              key={fmt}
              type="button"
              onClick={() => download(fmt)}
              title={`Скачать гипотезу отдельным файлом (${fmt.toUpperCase()})`}
              className="btn-ghost flex items-center gap-1 px-2.5 py-1.5 text-xs uppercase text-base-300"
            >
              <Download size={12} />
              {fmt}
            </button>
          ))}
        </div>
      </div>
    </article>
  )
}

export default memo(HypothesisCard)
