import { useState, useEffect, useRef } from 'react'
import {
  Ion, Cartesian3, Color, JulianDate,
  SampledPositionProperty,
} from 'cesium'
import { Viewer, Entity } from 'resium'
import * as satellite from 'satellite.js'
import { fetchISSTLE } from '../api/client'

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

function Globe() {
  const [issPosition, setIssPosition] = useState(null)
  const viewerRef = useRef(null)

  useEffect(() => {
    let cancelled = false

    async function refresh() {
      try {
        const tle = await fetchISSTLE()
        if (cancelled) return
        const satrec = satellite.twoline2satrec(tle.line1, tle.line2)
        const start = new Date()
        const durationSec = 95 * 60
        const property = buildPositionProperty(satrec, start, durationSec, 10)
        setIssPosition(property)

        const viewer = viewerRef.current?.cesiumElement
        if (viewer) {
          const startJulian = JulianDate.fromDate(start)
          const stopJulian = JulianDate.addSeconds(startJulian, durationSec, new JulianDate())
          viewer.clock.startTime = startJulian.clone()
          viewer.clock.currentTime = startJulian.clone()
          viewer.clock.stopTime = stopJulian.clone()
          viewer.clock.multiplier = 1
          viewer.clock.shouldAnimate = true
        }
      } catch (err) {
        console.error('Failed to refresh TLE:', err)
      }
    }

    refresh()
    const id = setInterval(refresh, 60 * 60 * 1000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  return (
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
  )
}

export default Globe