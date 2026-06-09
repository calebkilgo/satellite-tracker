#include "sgp4.h"
#include <emscripten/bind.h>
#include <unordered_map>
#include <vector>
#include <cmath>

using namespace emscripten;

static std::unordered_map<int, elsetrec> g_sats;
static int g_next_id = 1;

int createSatrec(const std::string& line1, const std::string& line2) {
    elsetrec rec;
    if (!twoline2satrec(line1.c_str(), line2.c_str(), rec)) return 0;
    if (rec.error != 0) return 0;
    int id = g_next_id++;
    g_sats[id] = rec;
    return id;
}

void freeSatrec(int id) { g_sats.erase(id); }
void clearAll()         { g_sats.clear(); g_next_id = 1; }

// Orbital period in minutes for the given handle.
double getPeriodMin(int id) {
    auto it = g_sats.find(id);
    if (it == g_sats.end()) return 90.0;
    return (2.0 * M_PI) / it->second.no;
}

// Accepts raw WASM heap pointers (ints in 32-bit WASM address space).
//   handlesPtr  → int[]      length `count`
//   outPtr      → double[]   length `count * 5`
//                 layout: [lat_rad, lon_rad, alt_m, speed_kms, valid(1/0)]
void propagateBatch(double timestampMs, int handlesPtr, int count, int outPtr) {
    const int*    handles = reinterpret_cast<const int*>(handlesPtr);
    double* const out     = reinterpret_cast<double*>(outPtr);

    const double JD_UNIX = 2440587.5;
    const double R2D = 180.0 / M_PI;
    double jd   = JD_UNIX + timestampMs / 86400000.0;
    double gmst = gstime(jd);

    for (int i = 0; i < count; ++i) {
        double* row = out + i * 5;
        row[4] = 0.0;

        auto it = g_sats.find(handles[i]);
        if (it == g_sats.end()) continue;

        elsetrec& rec     = it->second;
        double epochJD    = rec.jdsatepoch + rec.jdsatepochF;
        double tsince     = (jd - epochJD) * 1440.0;

        PropResult pr = sgp4(rec, tsince);
        if (!pr.valid || rec.error != 0) { rec.error = 0; continue; }

        Geodetic geo = eciToGeodetic(pr.rx, pr.ry, pr.rz,
                                     pr.vx, pr.vy, pr.vz, gmst);
        row[0] = geo.lat;
        row[1] = geo.lon;
        row[2] = geo.alt * 1000.0; // km → m for Cesium
        row[3] = geo.speed;
        row[4] = 1.0;
    }
}

val propagateOne(int id, double timestampMs) {
    val result = val::object();
    result.set("valid", false);

    auto it = g_sats.find(id);
    if (it == g_sats.end()) return result;

    elsetrec& rec  = it->second;
    const double JD_UNIX = 2440587.5;
    double jd      = JD_UNIX + timestampMs / 86400000.0;
    double epochJD = rec.jdsatepoch + rec.jdsatepochF;
    double tsince  = (jd - epochJD) * 1440.0;
    double gmst    = gstime(jd);

    PropResult pr = sgp4(rec, tsince);
    if (!pr.valid || rec.error != 0) { rec.error = 0; return result; }

    Geodetic geo = eciToGeodetic(pr.rx, pr.ry, pr.rz,
                                 pr.vx, pr.vy, pr.vz, gmst);
    result.set("valid", true);
    result.set("lat",   geo.lat);
    result.set("lon",   geo.lon);
    result.set("alt",   geo.alt);    // km
    result.set("speed", geo.speed);  // km/s
    return result;
}

double gstimeMs(double timestampMs) {
    return gstime(2440587.5 + timestampMs / 86400000.0);
}

EMSCRIPTEN_BINDINGS(sgp4_module) {
    function("createSatrec",   &createSatrec);
    function("freeSatrec",     &freeSatrec);
    function("clearAll",       &clearAll);
    function("getPeriodMin",   &getPeriodMin);
    function("propagateBatch", &propagateBatch, allow_raw_pointers());
    function("propagateOne",   &propagateOne);
    function("gstime",         &gstimeMs);
}
