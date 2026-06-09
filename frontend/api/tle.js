const ALLOWED = new Set(['stations', 'gps-ops', 'starlink', 'weather', 'science'])

export default async function handler(req, res) {
  const { group } = req.query
  if (!ALLOWED.has(group)) {
    return res.status(400).json({ error: 'Unknown group' })
  }

  const url = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=TLE`
  let upstream
  try {
    upstream = await fetch(url, {
      headers: { 'User-Agent': 'satellite-tracker/1.0 (portfolio project)' },
    })
  } catch (err) {
    return res.status(502).json({ error: 'CelesTrak unreachable' })
  }

  if (!upstream.ok) {
    return res.status(upstream.status).json({ error: `CelesTrak: ${upstream.status}` })
  }

  const text = await upstream.text()
  const lines = text.trim().split('\n').map((l) => l.trimEnd())
  const sats = []
  for (let i = 0; i + 2 < lines.length + 1; i += 3) {
    if (!lines[i + 1] || !lines[i + 2]) break
    sats.push({ name: lines[i].trim(), line1: lines[i + 1], line2: lines[i + 2] })
  }

  // Cache at Vercel's edge for 1 hour; serve stale for 2 hours while revalidating
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200')
  return res.json(sats)
}
