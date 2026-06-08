const API_BASE = 'http://localhost:8000'

export async function fetchGroups() {
  const res = await fetch(`${API_BASE}/groups`)
  if (!res.ok) throw new Error(`Backend error: ${res.status}`)
  return res.json()   // array of group names
}

export async function fetchGroupTLEs(group) {
  const res = await fetch(`${API_BASE}/tle/group/${group}`)
  if (!res.ok) throw new Error(`Backend error: ${res.status}`)
  return res.json()   // array of { name, line1, line2 }
}