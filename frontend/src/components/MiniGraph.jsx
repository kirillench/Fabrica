const TYPE_COLORS = {
  material: '#c6cbd3',
  process: '#9aa1ab',
  parameter: '#7d858f',
  property: '#e8eaee',
}

/**
 * Лёгкий SVG-граф «сущности → связи» без сторонних библиотек:
 * узлы раскладываются по эллипсу, рёбра подписываются в середине.
 */
export default function MiniGraph({ entities = [], relations = [] }) {
  if (entities.length < 2) return null

  const W = 640
  const H = 230
  const cx = W / 2
  const cy = H / 2
  const rx = W / 2 - 90
  const ry = H / 2 - 42

  const pos = {}
  entities.forEach((e, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / entities.length
    pos[e.id] = { x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) }
  })

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {relations.map((r, i) => {
        const a = pos[r.source]
        const b = pos[r.target]
        if (!a || !b) return null
        const mx = (a.x + b.x) / 2
        const my = (a.y + b.y) / 2
        return (
          <g key={i}>
            <line
              x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke="rgba(255,255,255,0.18)"
              strokeWidth="1.2"
            />
            {r.label && (
              <text
                x={mx} y={my - 5}
                textAnchor="middle"
                fontSize="10"
                fill="#6b7280"
              >
                {r.label}
              </text>
            )}
          </g>
        )
      })}
      {entities.map((e) => {
        const p = pos[e.id]
        const color = TYPE_COLORS[e.type] || '#9aa1ab'
        return (
          <g key={e.id}>
            <circle cx={p.x} cy={p.y} r="6" fill={color} opacity="0.9" />
            <circle cx={p.x} cy={p.y} r="11" fill="none" stroke={color} strokeOpacity="0.25" />
            <text
              x={p.x}
              y={p.y + (p.y > cy ? 26 : -18)}
              textAnchor="middle"
              fontSize="11.5"
              fill="#c6cbd3"
            >
              {e.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
