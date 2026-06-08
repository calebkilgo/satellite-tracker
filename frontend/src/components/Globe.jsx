import { useState, useEffect } from 'react'
import { Ion, Cartesian3, Color } from 'cesium'
import { Viewer, Entity } from 'resium'
import { fetchISS } from '../api/client'

Ion.defaultAccessToken = import.meta.env.VITE_CESIUM_ION_TOKEN

function Globe() {
  const [iss, setIss] = useState(null)

  useEffect(() => {
    fetchISS()
      .then(setIss)
      .catch((err) => console.error('Failed to fetch ISS:', err))
  }, [])

  return (
    <Viewer full timeline={false} animation={false} baseLayerPicker={false}>
      {iss && (
        <Entity
          name="ISS"
          position={Cartesian3.fromDegrees(iss.lon, iss.lat, iss.alt * 1000)}
          point={{ pixelSize: 12, color: Color.RED }}
        />
      )}
    </Viewer>
  )
}

export default Globe