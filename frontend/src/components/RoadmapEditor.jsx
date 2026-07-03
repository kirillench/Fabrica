import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'

const fmtMoney = (v) =>
  v ? `${Number(v).toLocaleString('ru-RU')} ₽` : '—'

/**
 * Визуальный конструктор дорожной карты проверки гипотезы:
 * редактируемые шаги (название / дни / стоимость / ресурсы),
 * перестановка, Гант-таймлайн и итоги по срокам и бюджету.
 * Изменения попадают в экспорт отчёта.
 */
export default function RoadmapEditor({ steps, onChange }) {
  const update = (i, field, value) => {
    const next = steps.map((s, j) => (j === i ? { ...s, [field]: value } : s))
    onChange(next)
  }

  const move = (i, dir) => {
    const j = i + dir
    if (j < 0 || j >= steps.length) return
    const next = [...steps]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }

  const remove = (i) => onChange(steps.filter((_, j) => j !== i))

  const add = () =>
    onChange([
      ...steps,
      { name: 'Новый шаг', duration_days: 7, cost: 0, resources: '' },
    ])

  const totalDays = steps.reduce((s, x) => s + (Number(x.duration_days) || 0), 0)
  const totalCost = steps.reduce((s, x) => s + (Number(x.cost) || 0), 0)

  // Гант: последовательные шаги, ширина пропорциональна длительности
  let offset = 0
  const bars = steps.map((s) => {
    const d = Number(s.duration_days) || 0
    const bar = { start: offset, width: d }
    offset += d
    return bar
  })

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {steps.map((s, i) => (
          <div key={i} className="glass-soft flex flex-wrap items-center gap-2 px-3 py-2">
            <span className="w-5 shrink-0 text-center text-xs tabular-nums text-base-400">
              {i + 1}
            </span>
            <input
              className="glass-input min-w-[180px] flex-1 px-2.5 py-1.5 text-sm text-base-100"
              value={s.name}
              onChange={(e) => update(i, 'name', e.target.value)}
            />
            <label className="flex items-center gap-1 text-xs text-base-400">
              <input
                type="number"
                min="0"
                className="glass-input w-16 px-2 py-1.5 text-right text-sm text-base-100"
                value={s.duration_days}
                onChange={(e) => update(i, 'duration_days', Number(e.target.value))}
              />
              дн.
            </label>
            <label className="flex items-center gap-1 text-xs text-base-400">
              <input
                type="number"
                min="0"
                step="10000"
                className="glass-input w-28 px-2 py-1.5 text-right text-sm text-base-100"
                value={s.cost}
                onChange={(e) => update(i, 'cost', Number(e.target.value))}
              />
              ₽
            </label>
            <input
              className="glass-input w-44 px-2.5 py-1.5 text-xs text-base-200"
              placeholder="ресурсы / оборудование"
              value={s.resources}
              onChange={(e) => update(i, 'resources', e.target.value)}
            />
            <div className="flex gap-1">
              <button type="button" onClick={() => move(i, -1)} className="btn-ghost p-1.5" title="Выше">
                <ArrowUp size={13} className="text-base-400" />
              </button>
              <button type="button" onClick={() => move(i, 1)} className="btn-ghost p-1.5" title="Ниже">
                <ArrowDown size={13} className="text-base-400" />
              </button>
              <button type="button" onClick={() => remove(i)} className="btn-ghost p-1.5" title="Удалить">
                <Trash2 size={13} className="text-base-400" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={add}
        className="btn-ghost flex items-center gap-1.5 px-3 py-1.5 text-xs text-base-300"
      >
        <Plus size={13} />
        Добавить шаг
      </button>

      {totalDays > 0 && (
        <div className="glass-soft p-3">
          <div className="mb-2 flex justify-between text-xs text-base-400">
            <span>Таймлайн (последовательное выполнение)</span>
            <span>
              Итого: <span className="text-base-200">{totalDays} дн.</span> ·{' '}
              <span className="text-base-200">{fmtMoney(totalCost)}</span>
            </span>
          </div>
          <svg viewBox={`0 0 100 ${steps.length * 8 + 2}`} className="w-full" preserveAspectRatio="none" style={{ height: steps.length * 26 }}>
            {steps.map((s, i) => {
              const b = bars[i]
              const x = (b.start / totalDays) * 100
              const w = Math.max((b.width / totalDays) * 100, 0.5)
              return (
                <g key={i}>
                  <rect
                    x={x} y={i * 8 + 1} width={w} height="6" rx="1.2"
                    fill={`rgba(232,234,238,${0.25 + (i % 2) * 0.12})`}
                  />
                </g>
              )
            })}
          </svg>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
            {steps.map((s, i) => (
              <span key={i} className="text-[11px] text-base-400">
                {i + 1}. {s.name?.slice(0, 30)} — {s.duration_days} дн.
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
