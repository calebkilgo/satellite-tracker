import { useState, useEffect, useRef } from 'react'
import {
  Ion, Cartesian3, Color, JulianDate,
  SampledPositionProperty,
  ScreenSpaceEventHandler, ScreenSpaceEventType, defined,
} from 'cesium'
import { Viewer, Entity } from 'resium'
import * as satellite from 'satellite.js'
import { fetchISSTLE } from '../api/client'
import StatsPanel from './StatsPanel'

Ion.defaultAccessToken = import.meta.env.VITE_CESIUM_ION_TOKEN

function buildPositionProperty(satrec, start, durationSec, stepSec) {
  const property = new SampledPositionProperty()
  for (let t = 0; t <= durationSec; t += stepSec) {
    const sampleDate = new Date(start.getTime() + t * 1000)
    const posVel = satellite.propagate(satrec, sampleDate)
    if (!posVel.position) continue
    const gmst = satellite.gstime(sampleDate)
    const geo = satellite.eciToGeodetic(posVel.position, gmst)
    const lat = satellite.degreesLat(geo.latitude)
    const lon = satellite.degreesLong(geo.longitude)
    const alt = geo.height * 1000
    property.addSample(JulianDate.fromDate(sampleDate), Cartesian3.fromDegrees(lon, lat, alt))
  }
  return property
}

// Compute live stats (lat/lon/alt + speed) for a satrec at the current time.
function computeStats(satrec, name) {
  const now = new Date()
  const posVel = satellite.propagate(satrec, now)
  if (!posVel.position) return null

  const gmst = satellite.gstime(now)
  const geo = satellite.eciToGeodetic(posVel.position, gmst)

  // Velocity is a vector in km/s; its magnitude is the orbital speed.
  const v = posVel.velocity
  const speed = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)

  return {
    name,
    lat: satellite.degreesLat(geo.latitude),
    lon: satellite.degreesLong(geo.longitude),
    alt: geo.height,        // km
    speed,                  // km/s
  }
}

function Globe() {
  const [issPosition, setIssPosition] = useState(null)
  const [selected, setSelected] = useState(null)   // which satellite is selected
  const [stats, setStats] = useState(null)         // live stats for the selected one
  const viewerRef = useRef(null)
  const satrecRef = useRef(null)                    // ISS satrec, reused for stats

  // Fetch TLE, build the animation track, store the satrec.
  useEffect(() => {
    fetchISSTLE()
      .then((tle) => {
        const satrec = satellite.twoline2satrec(tle.line1, tle.line2)
        satrecRef.current = satrec
        const start = new Date()
        const durationSec = 95 * 60
        setIssPosition(buildPositionProperty(satrec, start, durationSec, 10))

        const viewer = viewerRef.current?.cesiumElement
        if (viewer) {
          const startJ = JulianDate.fromDate(start)
          const stopJ = JulianDate.addSeconds(startJ, durationSec, new JulianDate())
          viewer.clock.startTime = startJ.clone()
          viewer.clock.currentTime = startJ.clone()
          viewer.clock.stopTime = stopJ.clone()
          viewer.clock.multiplier = 1
          viewer.clock.shouldAnimate = true
        }
      })
      .catch((err) => console.error('Failed to fetch TLE:', err))
  }, [])

  // Set up click detection once the viewer exists.
  useEffect(() => {
    const viewer = viewerRef.current?.cesiumElement
    if (!viewer) return

    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas)
    handler.setInputAction((click) => {
      const picked = viewer.scene.pick(click.position)
      if (defined(picked) && picked.id && picked.id.name) {
        setSelected(picked.id.name)   // the entity's name identifies it
      } else {
        setSelected(null)             // clicked empty space -> deselect
      }
    }, ScreenSpaceEventType.LEFT_CLICK)

    return () => handler.destroy()
  }, [issPosition])   // re-run once the entity exists

  // While something is selected, update its stats every second.
  useEffect(() => {
    if (!selected || !satrecRef.current) {
      setStats(null)
      return
    }
    const tick = () => setStats(computeStats(satrecRef.current, selected))
    tick()                                 // immediate first update
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [selected])

  return (
    <>
      <Viewer ref={viewerRef} full timeline={false} animation={false} baseLayerPicker={false}>
        {issPosition && (
          <Entity
            name="ISS"
            position={issPosition}
            point={{ pixelSize: 12, color: Color.RED }}
            path={{ width: 2, material: Color.CYAN, leadTime: 0, trailTime: 600 }}
          />
        )}
      </Viewer>
      {stats && <StatsPanel stats={stats} onClose={() => setSelected(null)} />}
    </>
  )
}

export default Globe