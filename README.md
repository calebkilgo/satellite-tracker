# Satellite Tracker

Real-time 3D satellite constellation tracker running on a CesiumJS globe. Orbital positions are computed by a custom SGP4 propagation engine written in C++ and compiled to WebAssembly — no satellite.js, no server-side propagation.

![Globe with satellite constellation](docs/screenshot.png)

---

## What makes it different

Most browser-based trackers delegate propagation to satellite.js (a JavaScript port of an old Fortran implementation). This one replaces that entirely with a C++17 SGP4/SDP4 implementation (Vallado 2006) compiled to WASM via Emscripten.

The main gains:

- **Batch propagation with zero GC pressure.** Satellite state is stored in pre-allocated WASM heap buffers. One call to `propagateBatch` per animation frame covers the entire constellation — no per-satellite JS overhead, no garbage produced on the hot path.
- **Glitch-free camera tracking.** Cesium's built-in `trackedEntity` triggers an internal reference-frame mode switch that produces a visible stutter on first selection. Instead, a `preRender` listener calls `camera.lookAt` every frame after a `flyToBoundingSphere` transition.
- **Orbital ground tracks** that correctly split at the antimeridian and cover 2 full orbital periods at 10-second steps (~110m interpolation error, imperceptible on the globe).

---

## Features

- Multiple satellite groups: GPS, weather, science, space stations — color-coded, toggleable
- Live TLE data fetched directly from CelesTrak
- Click any satellite to open a draggable stats panel (lat / lon / altitude / speed, 1 Hz update)
- Camera flyTo + lock-on tracking via the panel's camera button
- Orbital ground track toggle per selected satellite
- FastAPI backend for TLE proxying when direct CelesTrak requests are blocked

---

## Stack

| Layer | Tech |
|---|---|
| Globe | CesiumJS 1.142, Resium |
| Frontend | React 19, Vite 8 |
| Propagation | C++17 → Emscripten 6.0 → WebAssembly |
| TLE source | [CelesTrak](https://celestrak.org) (fetched from the browser) |
| Backend | Python 3, FastAPI |

---

## Prerequisites

- Node.js 18+
- Python 3.11+
- A free [Cesium Ion](https://cesium.com/ion/) token (for globe imagery)
- Emscripten SDK — only needed if you change the C++ propagator

### Install Emscripten (Windows)

```powershell
git clone https://github.com/emscripten-core/emsdk.git C:\emsdk
cd C:\emsdk
.\emsdk install latest
.\emsdk activate latest
```

### Install Emscripten (Mac / Linux)

```bash
git clone https://github.com/emscripten-core/emsdk.git ~/emsdk
cd ~/emsdk
./emsdk install latest
./emsdk activate latest
```

---

## Setup

```bash
# 1 — Clone
git clone <repo-url>
cd satellite-tracker

# 2 — Backend dependencies
cd backend
python -m venv venv
# Windows: .\venv\Scripts\activate
# Mac/Linux: source venv/bin/activate
pip install -r requirements.txt
cd ..

# 3 — Frontend dependencies
cd frontend
npm install
cd ..

# 4 — Cesium Ion token
echo "VITE_CESIUM_ION_TOKEN=your_token_here" > frontend/.env
```

### Build the WASM propagator

The compiled output (`sgp4.js` + `sgp4.wasm`) is not committed. Build it once before running the frontend:

**Windows:**
```powershell
& "C:\emsdk\emsdk_env.ps1"
powershell -File cpp/build.ps1
```

**Mac / Linux:**
```bash
source ~/emsdk/emsdk_env.sh
bash cpp/build.sh
```

Output goes to `frontend/public/`. Only rebuild when `cpp/` changes.

---

## Running locally

```bash
# Terminal 1 — backend
cd backend
uvicorn main:app --reload

# Terminal 2 — frontend
cd frontend
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

---

## How the propagator works

Each TLE is parsed once by `twoline2satrec` (C++) into an `elsetrec` struct containing the satellite's Kozai mean motion, drag coefficients, secular perturbation rates, and epoch. `sgp4init` pre-computes all frame-invariant terms so the per-frame propagation is just arithmetic — no trig beyond Kepler's equation.

On every animation frame (~16 ms):

```
JS  →  propagateBatch(handlesPtr, count, outPtr, timestampMs)
             │
WASM  →  for each handle:
              sgp4(rec, tsince)           // ECI position
              eciToGeodetic(pos, gmst)   // WGS-84 lat/lon/alt
              write [lat, lon, alt_m, speed, valid] to outPtr
             │
JS  ←  new Float64Array(mod.HEAPF64.buffer, outPtr, count * 5)
```

The output buffer view is recreated each frame because `ALLOW_MEMORY_GROWTH` can relocate the heap. The handles buffer is stable across frames and only reallocated when the active groups change.

---

## Project structure

```
├── cpp/
│   ├── sgp4.h           # elsetrec, PropResult, Geodetic structs + function declarations
│   ├── sgp4.cpp         # SGP4/SDP4 implementation (Vallado 2006)
│   ├── bindings.cpp     # Emscripten embind bindings + satrec handle registry
│   ├── build.ps1        # Windows build script (outputs to frontend/public/)
│   └── build.sh         # Mac/Linux build script
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Globe.jsx         # Globe, satellite rendering, camera, ground tracks
│   │   │   ├── StatsPanel.jsx    # Draggable satellite stats panel
│   │   │   └── GroupSelector.jsx # Group toggle sidebar
│   │   ├── wasm/
│   │   │   └── propagator.js     # WASM module loader + JS API surface
│   │   └── api/
│   │       └── client.js         # CelesTrak TLE fetch + parser
│   └── public/
│       ├── sgp4.js    ← generated by build.ps1 / build.sh, not committed
│       └── sgp4.wasm  ← generated by build.ps1 / build.sh, not committed
└── backend/
    └── main.py            # FastAPI — TLE proxy + group list endpoint
```

---

## Satellite groups

| Group | CelesTrak key | Typical size |
|---|---|---|
| Space Stations | `stations` | ~20 |
| GPS | `gps-ops` | ~30 |
| Weather | `weather` | ~20 |
| Science | `science` | ~60 |
| Starlink | `starlink` | 5000+ |

Starlink is available via the group selector but is off by default — loading 5000+ satellites will noticeably impact frame time depending on hardware.

---

## Known limitations

- **Deep-space satellites** (orbital period ≥ 225 min) use secular-only perturbations. Full SDP4 lunar/solar resonance terms are not implemented — positions will drift over multi-day propagations but are accurate enough for real-time display.
- **No auth on the backend.** Fine for local use; add a reverse proxy for anything public-facing.
- **TLE freshness.** CelesTrak data is fetched on demand and not cached between sessions. Positions degrade if TLEs are older than a few days.
