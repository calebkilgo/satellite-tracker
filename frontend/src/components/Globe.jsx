import { useState, useEffect, useRef } from 'react'
import {
  Ion, Cartesian3, Color, CallbackProperty,
  PointPrimitiveCollection,
  PolylineGlowMaterialProperty,
  BoundingSphere, HeadingPitchRange,
  Math as CesiumMath, Matrix4,
  ScreenSpaceEventHandler, ScreenSpaceEventType, defined,
} from 'cesium'
import { Viewer } from 'resium'
import {
  initPropagator, getPropagator,
  createSatrec, clearAll as wasmClearAll,
  getPeriodMin, propagateBatch, propagateOne,
  allocHandlesBuf, allocOutBuf, freeWasmBuf,
} from '../wasm/propagator'
import { fetchGroups, fetchGroupTLEs } from '../api/client'
import StatsPanel from './StatsPanel'
import GroupSelector from './GroupSelector'

Ion.defaultAccessToken = import.meta.env.VITE_CESIUM_ION_TOKEN

const GROUP_COLORS = {
  stations: Color.CYAN,
  'gps-ops': Color.YELLOW,
  starlink: Color.ORANGE,
  weather: Color.LIME,
  science: Color.MAGENTA,
}
const DEFAULT_COLOR = Color.WHITE
const RAD2DEG = 180 / Math.PI

// Negative pitch = camera above target in Cesium's HeadingPitchRange convention.
const TRACK_OFFSET = new HeadingPitchRange(0, CesiumMath.toRadians(-25), 1500000)

function geoToCartesian(geo) {
  if (!geo.valid) return null
  const lon = geo.lon * RAD2DEG
  const lat = geo.lat * RAD2DEG
  const alt = geo.alt * 1000  // km → m
  if (!isFinite(lat) || !isFinite(lon) || !isFinite(alt)) return null
  return Cartesian3.fromDegrees(lon, lat, alt)
}

function computeGroundTrack(handle) {
  const periodMin = getPeriodMin(handle)
  const durationMin = Math.min(periodMin * 2, 240)
  const stepSec = 10
  const steps = Math.ceil((durationMin * 60) / stepSec)
  const startMs = Date.now()
  const positions = []
  for (let i = 0; i <= steps; i++) {
    const geo = propagateOne(handle, startMs + i * stepSec * 1000)
    if (!geo.valid) continue
    const lon = geo.lon * RAD2DEG
    const lat = geo.lat * RAD2DEG
    const alt = geo.alt * 1000
    if (!isFinite(lat) || !isFinite(lon) || !isFinite(alt)) continue
    positions.push({ lon, lat, alt })
  }
  return positions
}

function splitAtAntimeridian(positions) {
  if (positions.length === 0) return []
  const segments = [[positions[0]]]
  for (let i = 1; i < positions.length; i++) {
    if (Math.abs(positions[i].lon - positions[i - 1].lon) > 180) segments.push([])
    segments[segments.length - 1].push(positions[i])
  }
  return segments.filter(s => s.length >= 2)
}

function Globe() {
  const [groups, setGroups] = useState([])
  const [activeGroups, setActiveGroups] = useState(new Set())
  const [selected, setSelected] = useState(null) // { name, handle, group, point }
  const [stats, setStats] = useState(null)
  const [showGroundTrack, setShowGroundTrack] = useState(false)
  const [wasmReady, setWasmReady] = useState(false)

  const viewerRef    = useRef(null)
  const pointsRef    = useRef(null)
  const satsRef      = useRef([])          // { name, handle, group, color, point }[]
  const selectedRef  = useRef(null)
  const selectionEntityRef  = useRef(null)
  const groundTrackEntitiesRef = useRef([])
  const trackingRef  = useRef(false)
  // WASM heap buffers for batch propagation — reallocated when satellite count changes
  const wasmBufsRef  = useRef({ handlesPtr: 0, outPtr: 0, count: 0 })

  useEffect(() => {
    initPropagator().then(() => setWasmReady(true)).catch(console.error)
  }, [])

  useEffect(() => {
    fetchGroups().then(setGroups).catch(console.error)
  }, [])

  useEffect(() => {
    if (!wasmReady) return
    const viewer = viewerRef.current?.cesiumElement
    if (!viewer || pointsRef.current) return
    pointsRef.current = viewer.scene.primitives.add(new PointPrimitiveCollection())

    const onPreRender = () => {
      const now  = Date.now()
      const sel  = selectedRef.current
      const sats = satsRef.current
      const bufs = wasmBufsRef.current

      // Manual camera tracking — avoids the mode-switch glitch from viewer.trackedEntity.
      if (trackingRef.current && sel) {
        const geo = propagateOne(sel.handle, now)
        const pos = geoToCartesian(geo)
        if (pos) viewer.camera.lookAt(pos, TRACK_OFFSET)
      }

      if (sats.length === 0 || bufs.count !== sats.length) return

      propagateBatch(bufs.handlesPtr, bufs.count, bufs.outPtr, now)

      // ALLOW_MEMORY_GROWTH can relocate the heap buffer, so recreate the view each frame.
      const out = new Float64Array(
        getPropagator().HEAPF64.buffer, bufs.outPtr, bufs.count * 5
      )

      for (let i = 0; i < sats.length; i++) {
        const sat   = sats[i]
        const base  = i * 5
        const valid = out[base + 4]

        if (sel && sel.point === sat.point) {
          sat.point.show = false
          continue
        }
        if (!valid) { sat.point.show = false; continue }

        sat.point.show = true
        const lon = out[base + 1] * RAD2DEG
        const lat = out[base + 0] * RAD2DEG
        const alt = out[base + 2] // already in meters
        sat.point.position = Cartesian3.fromDegrees(lon, lat, alt)
      }
    }

    viewer.scene.preRender.addEventListener(onPreRender)
    return () => viewer.scene.preRender.removeEventListener(onPreRender)
  }, [wasmReady, groups])

  useEffect(() => {
    if (!wasmReady) return
    let cancelled = false

    async function rebuild() {
      const viewer = viewerRef.current?.cesiumElement
      const points = pointsRef.current
      if (!viewer || !points) return

      const groupNames = Array.from(activeGroups)
      const results = await Promise.all(
        groupNames.map(g =>
          fetchGroupTLEs(g).then(list => ({ g, list })).catch(() => ({ g, list: [] }))
        )
      )
      if (cancelled) return

      wasmClearAll()
      const bufs = wasmBufsRef.current
      if (bufs.handlesPtr) { freeWasmBuf(bufs.handlesPtr); freeWasmBuf(bufs.outPtr) }

      wasmClearAll()
      points.removeAll()

      const sats = []
      const now  = Date.now()

      for (const { g, list } of results) {
        const color = GROUP_COLORS[g] || DEFAULT_COLOR
        for (const tle of list) {
          const handle = createSatrec(tle.line1, tle.line2)
          if (!handle) continue
          const geo = propagateOne(handle, now)
          if (!geo.valid) continue
          const pos = geoToCartesian(geo)
          if (!pos) continue
          const point = points.add({ position: pos, color, pixelSize: 4 })
          point.id = { name: tle.name, handle, group: g }
          sats.push({ name: tle.name, handle, group: g, color, point })
        }
      }

      satsRef.current = sats

      const n = sats.length
      if (n > 0) {
        const hb = allocHandlesBuf(n)
        const ob = allocOutBuf(n)
        for (let i = 0; i < n; i++) hb.view[i] = sats[i].handle
        wasmBufsRef.current = { handlesPtr: hb.ptr, outPtr: ob.ptr, count: n }
      } else {
        wasmBufsRef.current = { handlesPtr: 0, outPtr: 0, count: 0 }
      }
    }

    rebuild()
    return () => { cancelled = true }
  }, [activeGroups, wasmReady])

  useEffect(() => {
    const viewer = viewerRef.current?.cesiumElement
    if (!viewer) return
    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas)
    handler.setInputAction((click) => {
      const picked = viewer.scene.pick(click.position)
      if (defined(picked) && picked.id && picked.id.handle) {
        trackingRef.current = false
        viewer.camera.lookAtTransform(Matrix4.IDENTITY)
        const newSelected = {
          name: picked.id.name,
          handle: picked.id.handle,
          group: picked.id.group,
          point: picked.primitive,
        }
        selectedRef.current = newSelected
        setSelected(newSelected)
      } else {
        trackingRef.current = false
        viewer.camera.cancelFlight()
        viewer.camera.lookAtTransform(Matrix4.IDENTITY)
        selectedRef.current = null
        setSelected(null)
      }
    }, ScreenSpaceEventType.LEFT_CLICK)
    return () => handler.destroy()
  }, [groups])

  useEffect(() => {
    let cancelled = false
    let homeCommand = null, onHome = null
    function attach() {
      if (cancelled) return
      const viewer = viewerRef.current?.cesiumElement
      const cmd = viewer?.homeButton?.viewModel?.command
      if (!cmd) { setTimeout(attach, 200); return }
      homeCommand = cmd
      onHome = () => {
        trackingRef.current = false
        viewer.camera.lookAtTransform(Matrix4.IDENTITY)
        setSelected(null)
      }
      homeCommand.beforeExecute.addEventListener(onHome)
    }
    attach()
    return () => {
      cancelled = true
      if (homeCommand && onHome) homeCommand.beforeExecute.removeEventListener(onHome)
    }
  }, [])

  useEffect(() => {
    if (!selected) { setStats(null); return }
    const tick = () => {
      const geo = propagateOne(selected.handle, Date.now())
      if (!geo.valid) return
      setStats({
        name:  selected.name,
        lat:   geo.lat * RAD2DEG,
        lon:   geo.lon * RAD2DEG,
        alt:   geo.alt,
        speed: geo.speed,
      })
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [selected])

  useEffect(() => {
    const viewer = viewerRef.current?.cesiumElement
    if (!viewer) return

    if (!selected || !showGroundTrack || !wasmReady) {
      groundTrackEntitiesRef.current.forEach(e => viewer.entities.remove(e))
      groundTrackEntitiesRef.current = []
      return
    }

    const color = GROUP_COLORS[selected.group] || DEFAULT_COLOR
    const material = new PolylineGlowMaterialProperty({
      glowPower: 0.15,
      color: color.withAlpha(0.55),
    })

    const segments = splitAtAntimeridian(computeGroundTrack(selected.handle))
    const added = segments.map(seg => {
      const positions = seg.map(p => Cartesian3.fromDegrees(p.lon, p.lat, p.alt))
      return viewer.entities.add({ polyline: { positions, width: 2, material } })
    })
    groundTrackEntitiesRef.current = added

    return () => {
      added.forEach(e => viewer.entities.remove(e))
      groundTrackEntitiesRef.current = []
    }
  }, [selected, showGroundTrack, wasmReady])

  useEffect(() => {
    const viewer = viewerRef.current?.cesiumElement
    if (!viewer) return

    if (!selected) {
      viewer.selectedEntity = undefined
      return
    }

    const color  = GROUP_COLORS[selected.group] || DEFAULT_COLOR
    const handle = selected.handle
    const entity = viewer.entities.add({
      name: selected.name,
      position: new CallbackProperty(() => {
        const geo = propagateOne(handle, Date.now())
        return geoToCartesian(geo)
      }, false),
      point: { pixelSize: 8, color },
    })
    selectionEntityRef.current = entity
    viewer.selectedEntity = entity

    return () => {
      viewer.selectedEntity = undefined
      viewer.entities.remove(entity)
      selectionEntityRef.current = null
    }
  }, [selected])

  function toggleGroup(group) {
    setActiveGroups(prev => {
      const next = new Set(prev)
      next.has(group) ? next.delete(group) : next.add(group)
      return next
    })
  }

  function focusOnSatellite() {
    const viewer = viewerRef.current?.cesiumElement
    const sel    = selectedRef.current
    if (!viewer || !sel) return

    const geo = propagateOne(sel.handle, Date.now())
    const pos = geoToCartesian(geo)
    if (!pos) return

    viewer.camera.flyToBoundingSphere(
      new BoundingSphere(pos, 100000),
      {
        duration: 1.5,
        offset:   TRACK_OFFSET,
        complete: () => { if (selectedRef.current === sel) trackingRef.current = true },
        cancel:   () => {},
      }
    )
  }

  function deselect() {
    trackingRef.current = false
    const viewer = viewerRef.current?.cesiumElement
    if (viewer) {
      viewer.camera.cancelFlight()
      viewer.camera.lookAtTransform(Matrix4.IDENTITY)
    }
    selectedRef.current = null
    setSelected(null)
  }

  return (
    <>
      <Viewer
        ref={viewerRef}
        full
        timeline={false}
        animation={false}
        baseLayerPicker={false}
        geocoder={false}
        infoBox={false}
        selectionIndicator={true}
      />

      <GroupSelector
        groups={groups}
        activeGroups={activeGroups}
        colors={GROUP_COLORS}
        onToggle={toggleGroup}
      />

      {stats && (
        <StatsPanel
          stats={stats}
          onClose={deselect}
          onFocus={focusOnSatellite}
          showGroundTrack={showGroundTrack}
          onToggleGroundTrack={() => setShowGroundTrack(v => !v)}
        />
      )}
    </>
  )
}

export default Globe
