import { RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

const TYPE_COLORS = {
  material: '#d7dbe2',
  process: '#aab2be',
  parameter: '#8a93a1',
  property: '#f0f2f5',
  reagent: '#b8c2d4',
  equipment: '#79818e',
}

const TYPE_LABELS = {
  material: 'Материал',
  process: 'Процесс',
  parameter: 'Параметр',
  property: 'Свойство',
  reagent: 'Реагент',
  equipment: 'Оборудование',
}

/**
 * Force-layout на чистом JS (без d3): отталкивание узлов, притяжение
 * по рёбрам, гравитация к центру. Считается один раз при загрузке данных.
 */
function computeLayout(nodes, edges, W, H, iterations = 260) {
  const pos = new Map()
  nodes.forEach((n, i) => {
    const angle = (i / nodes.length) * 2 * Math.PI
    pos.set(n.id, {
      x: W / 2 + (W / 3.2) * Math.cos(angle) + (Math.random() - 0.5) * 40,
      y: H / 2 + (H / 3.2) * Math.sin(angle) + (Math.random() - 0.5) * 40,
      vx: 0,
      vy: 0,
    })
  })
  const idx = new Map(nodes.map((n) => [n.id, n]))

  for (let it = 0; it < iterations; it++) {
    const cool = 1 - it / iterations
    // отталкивание
    for (const a of nodes) {
      const pa = pos.get(a.id)
      for (const b of nodes) {
        if (a.id >= b.id) continue
        const pb = pos.get(b.id)
        let dx = pa.x - pb.x
        let dy = pa.y - pb.y
        const d2 = dx * dx + dy * dy || 1
        const d = Math.sqrt(d2)
        const rep = (5200 / d2) * cool
        dx = (dx / d) * rep
        dy = (dy / d) * rep
        pa.vx += dx; pa.vy += dy
        pb.vx -= dx; pb.vy -= dy
      }
    }
    // притяжение по рёбрам
    for (const e of edges) {
      const pa = pos.get(e.source)
      const pb = pos.get(e.target)
      if (!pa || !pb) continue
      const dx = pb.x - pa.x
      const dy = pb.y - pa.y
      const d = Math.sqrt(dx * dx + dy * dy) || 1
      const att = ((d - 90) / d) * 0.02 * Math.min(e.weight || 1, 4) * cool
      pa.vx += dx * att; pa.vy += dy * att
      pb.vx -= dx * att; pb.vy -= dy * att
    }
    // гравитация к центру + интеграция
    for (const n of nodes) {
      const p = pos.get(n.id)
      p.vx += (W / 2 - p.x) * 0.004 * cool
      p.vy += (H / 2 - p.y) * 0.004 * cool
      p.x += Math.max(-14, Math.min(14, p.vx))
      p.y += Math.max(-14, Math.min(14, p.vy))
      p.vx *= 0.55; p.vy *= 0.55
      const r = 8 + Math.min((idx.get(n.id)?.mentions || 1) * 1.5, 16)
      p.x = Math.max(r + 60, Math.min(W - r - 60, p.x))
      p.y = Math.max(r + 26, Math.min(H - r - 14, p.y))
    }
  }
  return pos
}

export default function KnowledgeGraph({ docs }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState(null)
  const [typeFilter, setTypeFilter] = useState(null)
  const boxRef = useRef(null)

  const load = () => {
    setLoading(true)
    fetch('/api/graph?max_nodes=90')
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const W = 900
  const H = 560

  const layout = useMemo(() => {
    if (!data?.nodes?.length) return null
    return computeLayout(data.nodes, data.edges, W, H)
  }, [data])

  if (loading && !data) {
    return (
      <div className="glass p-10 text-center text-sm text-base-400">
        Загрузка графа знаний…
      </div>
    )
  }

  if (!data?.nodes?.length) {
    return (
      <div className="glass p-10 text-center text-sm text-base-400">
        Граф знаний пуст. Загрузите документы в базу знаний — сущности
        (материалы, процессы, параметры, реагенты) и связи между ними
        будут извлечены автоматически.
      </div>
    )
  }

  const visible = typeFilter
    ? new Set(data.nodes.filter((n) => n.type === typeFilter).map((n) => n.id))
    : null

  const docName = (id) => docs.find((d) => d.id === id)?.filename || id

  const types = [...new Set(data.nodes.map((n) => n.type))].filter(Boolean)

  return (
    <div className="space-y-3">
      <div className="glass flex flex-wrap items-center gap-2 px-4 py-3">
        <span className="text-sm text-base-300">
          {data.total_nodes} сущностей · {data.total_edges} связей
        </span>
        <span className="glass-soft px-2.5 py-1 text-xs text-base-400">
          хранилище: {data.backend === 'neo4j' ? 'Neo4j' : 'встроенное'}
        </span>
        <div className="ml-auto flex flex-wrap gap-1.5">
          {types.map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(typeFilter === t ? null : t)}
              className={`btn-ghost px-2.5 py-1 text-xs ${
                typeFilter === t ? 'border-white/30 text-base-100' : 'text-base-300'
              }`}
            >
              <span
                className="mr-1.5 inline-block h-2 w-2 rounded-full"
                style={{ background: TYPE_COLORS[t] || '#888' }}
              />
              {TYPE_LABELS[t] || t}
            </button>
          ))}
          <button onClick={load} className="btn-ghost px-2.5 py-1 text-xs text-base-300">
            <RefreshCw size={12} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      <div className="glass overflow-hidden" ref={boxRef}>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" onClick={() => setSelected(null)}>
          {data.edges.map((e, i) => {
            const a = layout.get(e.source)
            const b = layout.get(e.target)
            if (!a || !b) return null
            const dim =
              visible && !(visible.has(e.source) || visible.has(e.target))
            const hot =
              selected && (e.source === selected.id || e.target === selected.id)
            return (
              <g key={i} opacity={dim ? 0.08 : hot ? 0.9 : 0.3}>
                <line
                  x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                  stroke={hot ? '#e8eaee' : 'rgba(255,255,255,0.35)'}
                  strokeWidth={Math.min(0.6 + (e.weight || 1) * 0.35, 2.6)}
                />
                {hot && e.label && (
                  <text
                    x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 4}
                    textAnchor="middle" fontSize="10" fill="#9aa1ab"
                  >
                    {e.label}
                  </text>
                )}
              </g>
            )
          })}
          {data.nodes.map((n) => {
            const p = layout.get(n.id)
            if (!p) return null
            const r = 5 + Math.min(n.mentions * 1.2, 13)
            const dim = visible && !visible.has(n.id)
            const isSel = selected?.id === n.id
            return (
              <g
                key={n.id}
                opacity={dim ? 0.15 : 1}
                className="cursor-pointer"
                onClick={(ev) => {
                  ev.stopPropagation()
                  setSelected(isSel ? null : n)
                }}
              >
                {isSel && (
                  <circle cx={p.x} cy={p.y} r={r + 6} fill="none"
                    stroke="#e8eaee" strokeOpacity="0.5" />
                )}
                <circle
                  cx={p.x} cy={p.y} r={r}
                  fill={TYPE_COLORS[n.type] || '#9aa1ab'}
                  opacity="0.88"
                />
                <text
                  x={p.x} y={p.y - r - 5}
                  textAnchor="middle" fontSize="10.5"
                  fill={isSel ? '#ffffff' : '#c6cbd3'}
                  fontWeight={isSel ? 600 : 400}
                >
                  {n.id}
                </text>
              </g>
            )
          })}
        </svg>
      </div>

      {selected && (
        <div className="glass fade-up px-4 py-3">
          <div className="flex items-baseline gap-2.5">
            <span className="font-semibold text-base-100">{selected.id}</span>
            <span className="text-xs text-base-400">
              {TYPE_LABELS[selected.type] || selected.type} · упоминаний:{' '}
              {selected.mentions} · связей: {selected.degree}
            </span>
          </div>
          {selected.docs?.length > 0 && (
            <p className="mt-1.5 text-xs text-base-400">
              Источники:{' '}
              {selected.docs.map((d, i) => (
                <span key={d}>
                  {i > 0 && ', '}
                  <a
                    href={`/api/documents/${d}/file`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-base-300 underline decoration-white/20 hover:text-base-100"
                  >
                    {docName(d)}
                  </a>
                </span>
              ))}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
