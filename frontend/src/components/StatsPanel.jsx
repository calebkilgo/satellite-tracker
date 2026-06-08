import { useState, useRef, useEffect } from 'react'

const SANS = "'Inter', 'Helvetica Neue', Arial, sans-serif"
const ACCENT = '#5b9dd9'

function StatsPanel({ stats, onClose, onFocus }) {
  const [pos, setPos] = useState({ x: 24, y: 320 })
  const drag = useRef({ active: false, offsetX: 0, offsetY: 0 })

  function onMouseDown(e) {
    if (e.target.closest('button')) return
    drag.current = { active: true, offsetX: e.clientX - pos.x, offsetY: e.clientY - pos.y }
    e.preventDefault()
  }

  useEffect(() => {
    function onMouseMove(e) {
      if (!drag.current.active) return
      setPos({ x: e.clientX - drag.current.offsetX, y: e.clientY - drag.current.offsetY })
    }
    function onMouseUp() { drag.current.active = false }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  return (
    <div
      onMouseDown={onMouseDown}
      style={{
        position: 'absolute',
        left: pos.x,
        top: pos.y,
        width: 260,
        background: 'rgba(13, 17, 23, 0.92)',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        borderRadius: 2,
        fontFamily: SANS,
        color: '#fff',
        cursor: 'move',
        userSelect: 'none',
      }}
    >
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '14px 16px',
        borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={onFocus}
            title="Track with camera"
            style={{
                background: 'none',
                border: '1px solid rgba(255,255,255,0.25)',
                borderRadius: 2,
                color: '#fff',
                cursor: 'pointer',
                padding: '4px 6px',
                lineHeight: 0,
                display: 'flex',
                alignItems: 'center',
            }}
            >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
            </svg>
          </button>
          <span style={{
            fontSize: 12,
            fontWeight: 500,
            letterSpacing: 2,
            textTransform: 'uppercase',
          }}>
            {stats.name}
          </span>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: 'rgba(255,255,255,0.5)',
            cursor: 'pointer',
            fontFamily: SANS,
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: 1.5,
            textTransform: 'uppercase',
            padding: 0,
          }}
        >
          Close
        </button>
      </div>

      <div style={{ padding: '6px 16px 14px' }}>
        <Row label="Latitude" value={stats.lat.toFixed(3)} unit="°" />
        <Row label="Longitude" value={stats.lon.toFixed(3)} unit="°" />
        <Row label="Altitude" value={stats.alt.toFixed(1)} unit="km" />
        <Row label="Velocity" value={stats.speed.toFixed(2)} unit="km/s" />
      </div>
    </div>
  )
}

function Row({ label, value, unit }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      padding: '10px 0',
      borderBottom: '1px solid rgba(255,255,255,0.06)',
    }}>
      <span style={{
        fontSize: 10,
        fontWeight: 500,
        letterSpacing: 1.5,
        textTransform: 'uppercase',
        color: 'rgba(255,255,255,0.5)',
      }}>
        {label}
      </span>
      <span style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
        <span style={{
          fontSize: 17,
          fontWeight: 400,
          fontVariantNumeric: 'tabular-nums',
          color: '#fff',
        }}>
          {value}
        </span>
        <span style={{ fontSize: 11, color: ACCENT, fontWeight: 500 }}>{unit}</span>
      </span>
    </div>
  )
}

export default StatsPanel