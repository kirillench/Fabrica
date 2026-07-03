import { ChevronDown, Loader2, Settings2, Sparkles } from 'lucide-react'
import { memo, useState } from 'react'

const WEIGHT_LABELS = {
  novelty: 'Новизна',
  feasibility: 'Реализуемость',
  impact: 'Эффект',
  risk: 'Низкий риск',
}

function GeneratorForm({ onGenerate, loading }) {
  const [goal, setGoal] = useState('')
  const [constraints, setConstraints] = useState('')
  const [excluded, setExcluded] = useState('')
  const [nHypotheses, setNHypotheses] = useState(5)
  const [showExpert, setShowExpert] = useState(false)
  const [weights, setWeights] = useState({
    novelty: 0.25,
    feasibility: 0.25,
    impact: 0.3,
    risk: 0.2,
  })

  const submit = (e) => {
    e.preventDefault()
    if (!goal.trim() || loading) return
    onGenerate({
      goal,
      constraints,
      excluded,
      n_hypotheses: nHypotheses,
      weights,
    })
  }

  return (
    <form onSubmit={submit} className="glass p-5">
      <label className="mb-1.5 block text-sm font-medium text-base-200">
        Целевое свойство или технологическая проблема
      </label>
      <textarea
        className="glass-input w-full resize-none px-4 py-3 text-[15px] text-base-100 placeholder:text-base-400"
        rows={2}
        placeholder="Например: повысить жаропрочность сплава на 15%"
        value={goal}
        onChange={(e) => setGoal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e)
        }}
      />

      <label className="mb-1.5 mt-4 block text-sm font-medium text-base-200">
        Ограничения <span className="font-normal text-base-400">(сырьё, бюджет, оборудование — опционально)</span>
      </label>
      <textarea
        className="glass-input w-full resize-none px-4 py-3 text-[15px] text-base-100 placeholder:text-base-400"
        rows={2}
        placeholder="Например: без применения кобальта, бюджет до 2 млн ₽, печи до 1200°C"
        value={constraints}
        onChange={(e) => setConstraints(e.target.value)}
      />

      <button
        type="button"
        className="mt-4 flex items-center gap-2 text-sm text-base-300 transition hover:text-base-100"
        onClick={() => setShowExpert((v) => !v)}
      >
        <Settings2 size={15} />
        Экспертная настройка
        <ChevronDown
          size={15}
          className={`transition-transform ${showExpert ? 'rotate-180' : ''}`}
        />
      </button>

      {showExpert && (
        <div className="glass-soft fade-up mt-3 space-y-4 p-4">
          <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            {Object.entries(WEIGHT_LABELS).map(([key, label]) => (
              <div key={key}>
                <div className="mb-1 flex justify-between text-xs">
                  <span className="text-base-300">{label}</span>
                  <span className="tabular-nums text-base-400">
                    {weights[key].toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  className="w-full"
                  value={weights[key]}
                  onChange={(e) =>
                    setWeights((w) => ({ ...w, [key]: Number(e.target.value) }))
                  }
                />
              </div>
            ))}
          </div>

          <div>
            <label className="mb-1 block text-xs text-base-300">
              Исключить направления
            </label>
            <input
              className="glass-input w-full px-3 py-2 text-sm text-base-100 placeholder:text-base-400"
              placeholder="Например: редкоземельные элементы, вакуумные технологии"
              value={excluded}
              onChange={(e) => setExcluded(e.target.value)}
            />
          </div>

          <div>
            <div className="mb-1 flex justify-between text-xs">
              <span className="text-base-300">Количество гипотез</span>
              <span className="tabular-nums text-base-400">{nHypotheses}</span>
            </div>
            <input
              type="range"
              min="3"
              max="10"
              step="1"
              className="w-full"
              value={nHypotheses}
              onChange={(e) => setNHypotheses(Number(e.target.value))}
            />
          </div>
        </div>
      )}

      <button
        type="submit"
        disabled={!goal.trim() || loading}
        className="btn-primary mt-5 flex w-full items-center justify-center gap-2 px-5 py-3 text-[15px]"
      >
        {loading ? (
          <>
            <Loader2 size={17} className="spin" />
            Анализ базы знаний и генерация…
          </>
        ) : (
          <>
            <Sparkles size={17} />
            Сгенерировать гипотезы
          </>
        )}
      </button>
    </form>
  )
}

export default memo(GeneratorForm)
