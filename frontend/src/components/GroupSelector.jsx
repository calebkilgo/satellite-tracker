const SANS = "'Inter', 'Helvetica Neue', Arial, sans-serif"

// Turn a Cesium Color into a CSS rgb string for the swatch.
function cssColor(c) {
  if (!c) return '#fff'
  return `rgb(${Math.round(c.red * 255)}, ${Math.round(c.green * 255)}, ${Math.round(c.blue * 255)})`
}

function GroupSelector({ groups, activeGroups, colors, onToggle }) {
  return (
    <div style={{
      position: 'absolute',
      top: 24,
      left: 24,
      width: 200,
      background: 'rgba(13, 17, 23, 0.92)',
      border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: 2,
      fontFamily: SANS,
      color: '#fff',
    }}>
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        fontSize: 11,
        fontWeight: 500,
        letterSpacing: 2,
        textTransform: 'uppercase',
        color: 'rgba(255,255,255,0.7)',
      }}>
        Satellite groups
      </div>
      <div style={{ padding: '8px 0' }}>
        {groups.map((g) => {
          const active = activeGroups.has(g)
          return (
            <div
              key={g}
              onClick={() => onToggle(g)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 16px',
                cursor: 'pointer',
                opacity: active ? 1 : 0.45,
              }}
            >
              <span style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: cssColor(colors[g]),
                border: active ? 'none' : '1px solid rgba(255,255,255,0.3)',
                flexShrink: 0,
              }} />
              <span style={{
                fontSize: 12,
                letterSpacing: 1,
                textTransform: 'uppercase',
                flex: 1,
              }}>
                {g}
              </span>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>
                {active ? 'ON' : 'OFF'}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default GroupSelector