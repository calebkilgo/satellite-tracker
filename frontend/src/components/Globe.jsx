import { useState, useEffect, useRef } from 'react'
import {
  Ion, Cartesian3, Color, CallbackProperty,
  PointPrimitiveCollection,
  ScreenSpaceEventHandler, ScreenSpaceEventType, defined,
} from 'cesium'
import { Viewer } from 'resium'
import * as satellite from 'satellite.js'
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

function propagateToCartesian(satrec, date) {
  const posVel = satellite.propagate(satrec, date)
  if (!posVel.position) return null
  const gmst = satellite.gstime(date)
  const geo = satellite.eciToGeodetic(posVel.position, gmst)
  const lat = satellite.degreesLat(geo.latitude)
  const lon = satellite.degreesLong(geo.longitude)
  const alt = geo.height * 1000
  if (!isFinite(lat) || !isFinite(lon) || !isFinite(alt)) return null
  return Cartesian3.fromDegrees(lon, lat, alt)
}

function computeStats(satrec, name) {
  const now = new Date()
  const posVel = satellite.propagate(satrec, now)
  if (!posVel.position) return null
  const gmst = satellite.gstime(now)
  const geo = satellite.eciToGeodetic(posVel.position, gmst)
  const v = posVel.velocity
  const speed = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)
  return {
    name,
    lat: satellite.degreesLat(geo.latitude),
    lon: satellite.degreesLong(geo.longitude),
    alt: geo.height,
    speed,
  }
}

function Globe() {
  const [groups, setGroups] = useState([])
  const [activeGroups, setActiveGroups] = useState(new Set())
  const [selected, setSelected] = useState(null)   // { name, satrec, group, point }
  const [stats, setStats] = useState(null)

  const viewerRef = useRef(null)
  const pointsRef = useRef(null)
  const satsRef = useRef([])
  const selectedRef = useRef(null)
  const selectionEntityRef = useRef(null)  // raw Cesium Entity

  // Load available groups once.
  useEffect(() => {
    fetchGroups().then(setGroups).catch((e) => console.error('Failed to load groups:', e))
  }, [])

  // Create the PointPrimitiveCollection and a per-frame position updater.
  useEffect(() => {
    const viewer = viewerRef.current?.cesiumElement
    if (!viewer || pointsRef.current) return
    pointsRef.current = viewer.scene.primitives.add(new PointPrimitiveCollection())

    const onPreRender = () => {
      const now = new Date()
      const sel = selectedRef.current
      const sats = satsRef.current
      for (let i = 0; i < sats.length; i++) {
        const sat = sats[i]
        // Hide the exact selected primitive; the entity draws it instead.
        if (sel && sel.point === sat.point) {
          sat.point.show = false
          continue
        }
        sat.point.show = true
        const pos = propagateToCartesian(sat.satrec, now)
        if (pos) sat.point.position = pos
      }
    }
    viewer.scene.preRender.addEventListener(onPreRender)
    return () => viewer.scene.preRender.removeEventListener(onPreRender)
  }, [groups])

  // Rebuild points when active groups change.
  useEffect(() => {
    let cancelled = false

    async function rebuild() {
      const viewer = viewerRef.current?.cesiumElement
      const points = pointsRef.current
      if (!viewer || !points) return

      const groupNames = Array.from(activeGroups)
      const results = await Promise.all(
        groupNames.map((g) => fetchGroupTLEs(g).then((list) => ({ g, list })).catch(() => ({ g, list: [] })))
      )
      if (cancelled) return

      points.removeAll()
      const sats = []
      const now = new Date()

      for (const { g, list } of results) {
        const color = GROUP_COLORS[g] || DEFAULT_COLOR
        for (const tle of list) {
          const satrec = satellite.twoline2satrec(tle.line1, tle.line2)
          if (satrec.error) continue
          const pos = propagateToCartesian(satrec, now)
          if (!pos) continue
          const point = points.add({ position: pos, color, pixelSize: 4 })
          point.id = { name: tle.name, satrec, group: g }
          sats.push({ name: tle.name, satrec, group: g, color, point })
        }
      }
      satsRef.current = sats
    }

    rebuild()
    return () => { cancelled = true }
  }, [activeGroups])

  // Click detection — capture the exact picked point.
  useEffect(() => {
    const viewer = viewerRef.current?.cesiumElement
    if (!viewer) return
    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas)
    handler.setInputAction((click) => {
      const picked = viewer.scene.pick(click.position)
      if (defined(picked) && picked.id && picked.id.satrec) {
        const newSelected = {
          name: picked.id.name,
          satrec: picked.id.satrec,
          group: picked.id.group,
          point: picked.primitive,
        }
        selectedRef.current = newSelected  // immediate: hides primitive on next preRender frame
        setSelected(newSelected)
      } else {
        selectedRef.current = null
        setSelected(null)
      }
    }, ScreenSpaceEventType.LEFT_CLICK)
    return () => handler.destroy()
  }, [groups])

  // Home button clears selection and tracking.
  useEffect(() => {
    let cancelled = false
    let homeCommand = null
    let onHome = null
    function attach() {
      if (cancelled) return
      const viewer = viewerRef.current?.cesiumElement
      const cmd = viewer?.homeButton?.viewModel?.command
      if (!cmd) { setTimeout(attach, 200); return }
      homeCommand = cmd
      onHome = () => {
        viewer.trackedEntity = undefined
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

  // Live stats once a second.
  useEffect(() => {
    if (!selected) { setStats(null); return }
    const tick = () => setStats(computeStats(selected.satrec, selected.name))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [selected])

  // Manage the Cesium entity for the selected satellite and drive the selection indicator.
  useEffect(() => {
    const viewer = viewerRef.current?.cesiumElement
    if (!viewer) return

    if (!selected) {
      viewer.selectedEntity = undefined
      return
    }

    const color = GROUP_COLORS[selected.group] || DEFAULT_COLOR
    const satrec = selected.satrec
    const entity = viewer.entities.add({
      name: selected.name,
      position: new CallbackProperty(() => propagateToCartesian(satrec, new Date()), false),
      point: { pixelSize: 8, color },
    })
    selectionEntityRef.current = entity
    viewer.selectedEntity = entity

    return () => {
      if (viewer.trackedEntity === entity) viewer.trackedEntity = undefined
      viewer.selectedEntity = undefined
      viewer.entities.remove(entity)
      selectionEntityRef.current = null
    }
  }, [selected])

  function toggleGroup(group) {
    setActiveGroups((prev) => {
      const next = new Set(prev)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }

  // Lock the camera to follow the selected satellite's entity.
  function focusOnSatellite() {
    const viewer = viewerRef.current?.cesiumElement
    const entity = selectionEntityRef.current
    if (!viewer || !entity) return
    viewer.trackedEntity = entity
  }

  function deselect() {
    const viewer = viewerRef.current?.cesiumElement
    if (viewer) viewer.trackedEntity = undefined
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
      >
      </Viewer>

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
        />
      )}
    </>
  )
}

export default Globe