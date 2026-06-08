import { useState, useEffect, useRef } from 'react'
import { Ion, Cartesian3, Color } from 'cesium'
import { Viewer, Entity } from 'resium'
import * as satellite from 'satellite.js'
import { fetchISSTLE } from '../api/client'

Ion.defaultAccessToken = import.meta.env.VITE_CESIUM_ION_TOKEN

function Globe() {
  const [position, setPosition] = useState(null)
  const satrecRef = useRef(null)

  useEffect(() => {
    fetchISSTLE()
      .then((tle) => {
        satrecRef.current = satellite.twoline2satrec(tle.line1, tle.line2)
      })
      .catch((err) => console.error('Failed to fetch TLE:', err))
  }, [])

  useEffect(() => {
    const interval = setInterval(() => {
      const satrec = satrecRef.current
      if (!satrec) return

      const now = new Date()
      const posVel = satellite.propagate(satrec, now)
      if (!posVel.position) return

      const gmst = satellite.gstime(now)
      const geo = satellite.eciToGeodetic(posVel.position, gmst)

      const lat = satellite.degreesLat(geo.latitude)
      const lon = satellite.degreesLong(geo.longitude)
      const alt = geo.height

      setPosition({ lat, lon, alt })
    }, 1000)

    return () => clearInterval(interval)
  }, [])

  return (
    <Viewer full timeline={false} animation={false} baseLayerPicker={false}>
      {position && (
        <Entity
          name="ISS"
          position={Cartesian3.fromDegrees(position.lon, position.lat, position.alt * 1000)}
          point={{ pixelSize: 12, color: Color.RED }}
        />
      )}
    </Viewer>
  )
}

export default Globe