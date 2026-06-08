import { useState, useRef, useEffect } from 'react'

function StatsPanel({ stats, onClose }) {
  const [pos, setPos] = useState({ x: 20, y: 20 })   // top-left by default
  const dragRef = useRef(null)

  // Track drag state without triggering re-renders mid-drag.
  const drag = useRef({ active: false, offsetX: 0, offsetY: 0 })

  function onMouseDown(e) {
    // Don't start a drag when clicking the close button.
    if (e.target.closest('button')) return
    drag.current = {
      active: true,
      offsetX: e.clientX - pos.x,   // where in the panel you grabbed it
      offsetY: e.clientY - pos.y,
    }
    e.preventDefault()
  }

  useEffect(() => {
    function onMouseMove(e) {
      if (!drag.current.active) return
      setPos({
        x: e.clientX - drag.current.offsetX,
        y: e.clientY - drag.current.offsetY,
      })
    }
    function onMouseUp() {
      drag.current.active = false
    }
    // Listen on window so the drag keeps working even if the cursor
    // moves faster than the panel can follow.
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  return (
    <div
      ref={dragRef}
      onMouseDown={onMouseDown}
      style={{
        position: 'absolute',
        left: pos.x,
        top: pos.y,
        width: 260,
        padding: '16px 20px',
        background: 'rgba(10, 20, 40, 0.85)',
        color: '#e0e8f0',
        borderRadius: 8,
        fontFamily: 'system-ui, sans-serif',
        fontSize: 14,
        backdropFilter: 'blur(4px)',
        border: '1px solid rgba(100, 150, 200, 0.3)',
        cursor: 'move',
        userSelect: 'none',   // stop text from highlighting while dragging
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <strong style={{ fontSize: 16 }}>{stats.name}</strong>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: '#8aa', cursor: 'pointer', fontSize: 18 }}
        >
          ×
        </button>
      </div>
      <Row label="Latitude" value={`${stats.lat.toFixed(2)}°`} />
      <Row label="Longitude" value={`${stats.lon.toFixed(2)}°`} />
      <Row label="Altitude" value={`${stats.alt.toFixed(1)} km`} />
      <Row label="Speed" value={`${stats.speed.toFixed(2)} km/s`} />
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
      <span style={{ color: '#8aa' }}>{label}</span>
      <span>{value}</span>
    </div>
  )
}

export default StatsPanel