from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from skyfield.api import load, EarthSatellite
import httpx

CELESTRAK_ISS_URL = "https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE"

# Groups the frontend is allowed to request.
AVAILABLE_GROUPS = ["stations", "gps-ops", "starlink", "weather", "science"]

FALLBACK_TLE = {
    "name": "ISS (ZARYA)",
    "line1": "1 25544U 98067A   26154.96745432  .00008451  00000+0  15807-3 0  9999",
    "line2": "2 25544  51.6330   5.5404 0007081 130.0270 230.1341 15.49590346569704",
}

_tle_cache = dict(FALLBACK_TLE)
_group_cache = {}   # group_name -> [ {name, line1, line2}, ... ]

ts = load.timescale()


def celestrak_group_url(group):
    return f"https://celestrak.org/NORAD/elements/gp.php?GROUP={group}&FORMAT=TLE"


def fetch_iss_tle():
    """Fetch the current ISS TLE from CelesTrak, falling back if it fails."""
    try:
        resp = httpx.get(CELESTRAK_ISS_URL, timeout=10.0)
        resp.raise_for_status()
        lines = [line.strip() for line in resp.text.strip().splitlines()]
        _tle_cache["name"] = lines[0]
        _tle_cache["line1"] = lines[1]
        _tle_cache["line2"] = lines[2]
    except Exception as e:
        print(f"ISS TLE fetch failed, using fallback: {e}")
    return _tle_cache


def fetch_group(group):
    """Fetch and parse a named CelesTrak group, caching the result."""
    if group not in AVAILABLE_GROUPS:
        return []
    try:
        resp = httpx.get(celestrak_group_url(group), timeout=15.0)
        resp.raise_for_status()
        lines = [line.rstrip() for line in resp.text.strip().splitlines()]
        sats = []
        # TLEs arrive in repeating 3-line blocks: name, line1, line2.
        for i in range(0, len(lines) - 2, 3):
            sats.append({
                "name": lines[i].strip(),
                "line1": lines[i + 1],
                "line2": lines[i + 2],
            })
        _group_cache[group] = sats
    except Exception as e:
        print(f"Group '{group}' fetch failed: {e}")
        _group_cache.setdefault(group, [])
    return _group_cache[group]


@asynccontextmanager
async def lifespan(app: FastAPI):
    fetch_iss_tle()
    fetch_group("stations")   # pre-warm the small default group only
    yield


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/groups")
def list_groups():
    return AVAILABLE_GROUPS


@app.get("/tle/group/{group}")
def get_group(group: str):
    if group not in _group_cache:
        fetch_group(group)
    return _group_cache.get(group, [])


@app.get("/tle/iss")
def iss_tle():
    return _tle_cache