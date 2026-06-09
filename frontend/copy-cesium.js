import { cpSync, mkdirSync } from 'fs'

const src = 'node_modules/cesium/Build/Cesium'
const dest = 'public/cesium'

mkdirSync(dest, { recursive: true })
for (const folder of ['Workers', 'Assets', 'ThirdParty', 'Widgets']) {
  cpSync(`${src}/${folder}`, `${dest}/${folder}`, { recursive: true })
}
console.log('Cesium assets copied to public/cesium')