import { Viewer } from 'resium'
import { Ion } from 'cesium'

Ion.defaultAccessToken = import.meta.env.VITE_CESIUM_ION_TOKEN

function Globe() {
    return (
        <Viewer
            full
            timeline={false}
            animation={false}
            baseLayerPicker={false}
        >
            {/* Add Cesium components here, such as Camera, Entity, etc. */}
        </Viewer>
    )
}

export default Globe