from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from skyfield.api import load, EarthSatellite

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

ts = load.timescale()

ISS_NAME = "ISS (ZARYA)"
ISS_LINE1 = "1 25544U 98067A   26154.96745432  .00008451  00000+0  15807-3 0  9999"
ISS_LINE2 = "2 25544  51.6330   5.5404 0007081 130.0270 230.1341 15.49590346569704"

satellite = EarthSatellite(ISS_LINE1, ISS_LINE2, ISS_NAME, ts)

@app.get("/health")
def health():
    return {"status": "ok"}

@app.get("/iss")
def iss_position():
    t = ts.now()
    geocentric = satellite.at(t)
    subpoint = geocentric.subpoint()

    return {
        "lat": subpoint.latitude.degrees,
        "lon": subpoint.longitude.degrees,
        "alt": subpoint.elevation.km
    }

@app.get("/tle/iss")
def iss_tle():
    return {
        "name": ISS_NAME,
        "line1": ISS_LINE1,
        "line2": ISS_LINE2
    }