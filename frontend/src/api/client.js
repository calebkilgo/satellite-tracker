const CELESTRAK_BASE = 'https://celestrak.org/NORAD/elements/gp.php'

const GROUPS = ['stations', 'gps-ops', 'starlink', 'weather', 'science']

export async function fetchGroups() {
  return GROUPS
}

export async function fetchGroupTLEs(group) {
  if (import.meta.env.PROD) {
    // Production: use the Vercel serverless proxy at /api/tle/[group].
    // CelesTrak 403s browser requests from production domains; the proxy
    // makes the fetch server-side with a proper User-Agent header.
    const res = await fetch(`/api/tle/${group}`)
    if (!res.ok) throw new Error(`API error: ${res.status}`)
    return res.json()
  }

  const res = await fetch(`${CELESTRAK_BASE}?GROUP=${group}&FORMAT=TLE`)
  if (!res.ok) throw new Error(`CelesTrak error: ${res.status}`)
  return parseTLE(await res.text())
}

function parseTLE(text) {
  const lines = text.trim().split('\n').map((l) => l.trimEnd())
  const sats = []
  for (let i = 0; i + 2 < lines.length + 1; i += 3) {
    if (!lines[i + 1] || !lines[i + 2]) break
    sats.push({ name: lines[i].trim(), line1: lines[i + 1], line2: lines[i + 2] })
  }
  return sats
}
