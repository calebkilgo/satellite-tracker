const CELESTRAK_BASE = 'https://celestrak.org/NORAD/elements/gp.php'

// The groups your app offers.
const GROUPS = ['stations', 'gps-ops', 'starlink', 'weather', 'science']

export async function fetchGroups() {
  return GROUPS   // no network call needed; it's a fixed list
}

export async function fetchGroupTLEs(group) {
  const url = `${CELESTRAK_BASE}?GROUP=${group}&FORMAT=TLE`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`CelesTrak error: ${res.status}`)
  const text = await res.text()
  return parseTLE(text)
}

// Parse CelesTrak's 3-line-per-satellite text into objects.
function parseTLE(text) {
  const lines = text.trim().split('\n').map((l) => l.trimEnd())
  const sats = []
  for (let i = 0; i + 2 < lines.length + 1; i += 3) {
    if (!lines[i + 1] || !lines[i + 2]) break
    sats.push({
      name: lines[i].trim(),
      line1: lines[i + 1],
      line2: lines[i + 2],
    })
  }
  return sats
}