from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from skyfield.api import load, EarthSatellite
import httpx
import os

CELESTRAK_ISS_URL = "https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE"

allowed = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "http://localhost:5173").split(",")]

# Groups the frontend is allowed to request.
AVAILABLE_GROUPS = ["stations", "gps-ops", "starlink", "weather", "science"]

# CelesTrak can be slow or reject requests without a User-Agent from cloud IPs.
HEADERS = {"User-Agent": "satellite-tracker/1.0 (portfolio project)"}

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
        resp = httpx.get(CELESTRAK_ISS_URL, timeout=30.0, headers=HEADERS)
        resp.raise_for_status()
        lines = [line.strip() for line in resp.text.strip().splitlines()]
        _tle_cache["name"] = lines[0]
        _tle_cache["line1"] = lines[1]
        _tle_cache["line2"] = lines[2]
    except Exception as e:
        print(f"ISS TLE fetch failed, using fallback: {e}")
    return _tle_cache


def fetch_group(group):
    """Fetch and parse a named CelesTrak group, caching only on success."""
    if group not in AVAILABLE_GROUPS:
        return []
    try:
        resp = httpx.get(celestrak_group_url(group), timeout=30.0, headers=HEADERS)
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
        _group_cache[group] = sats   # only cache on success
    except Exception as e:
        print(f"Group '{group}' fetch failed: {e}")
        # Do not cache empty on failure, so the next request retries.
    return _group_cache.get(group, [])


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Fetch lazily on first request instead of at startup, when the network
    # is coldest and most likely to time out.
    yield


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed,
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
    # Refetch if the group is missing OR cached empty (a previous failure).
    if not _group_cache.get(group):
        fetch_group(group)
    return _group_cache.get(group, [])


@app.get("/tle/iss")
def iss_tle():
    # Fetch on first access if still on the fallback.
    return fetch_iss_tle()