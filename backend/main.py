from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from skyfield.api import load, EarthSatellite
import httpx

CELESTRAK_ISS_URL = "https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE"

FALLBACK_TLE = {
    "name": "ISS (ZARYA)",
    "line1": "1 25544U 98067A   26154.96745432  .00008451  00000+0  15807-3 0  9999",
    "line2": "2 25544  51.6330   5.5404 0007081 130.0270 230.1341 15.49590346569704",
}

_tle_cache = dict(FALLBACK_TLE)

ts = load.timescale()


def fetch_iss_tle():
    try:
        resp = httpx.get(CELESTRAK_ISS_URL, timeout=10.0)
        resp.raise_for_status()
        lines = [line.strip() for line in resp.text.strip().splitlines()]
        _tle_cache["name"] = lines[0]
        _tle_cache["line1"] = lines[1]
        _tle_cache["line2"] = lines[2]
    except Exception as e:
        print(f"TLE fetch failed, using cached/fallback TLE: {e}")
    return _tle_cache


@asynccontextmanager
async def lifespan(app: FastAPI):
    fetch_iss_tle()
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


@app.get("/iss")
def iss_position():
    satellite = EarthSatellite(_tle_cache["line1"], _tle_cache["line2"], _tle_cache["name"], ts)
    t = ts.now()
    subpoint = satellite.at(t).subpoint()
    return {
        "lat": subpoint.latitude.degrees,
        "lon": subpoint.longitude.degrees,
        "alt": subpoint.elevation.km,
    }


@app.get("/tle/iss")
def iss_tle():
    return _tle_cache