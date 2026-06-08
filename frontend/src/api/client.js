const API_BASE = 'http://localhost:8000'

export async function fetchISS() {
  const res = await fetch(`${API_BASE}/iss`)
  if (!res.ok) throw new Error(`Backend error: ${res.status}`)
  return res.json()
}

export async function fetchISSTLE() {
  const res = await fetch(`${API_BASE}/tle/iss`)
  if (!res.ok) throw new Error(`Backend error: ${res.status}`)
  return res.json()
}