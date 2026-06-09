#pragma once
#include <cmath>
#include <cstring>

// SGP4/SDP4 propagator — Vallado 2006 "Revisiting Spacetrack Report #3"
// Units throughout: km, minutes, radians unless noted.

// All per-satellite state computed by sgp4init and consumed by sgp4.
struct elsetrec {
    // raw TLE fields
    double jdsatepoch;    // epoch Julian date (integer part)
    double jdsatepochF;   // epoch Julian date (fractional part)
    double no_kozai;      // kozai mean motion (rad/min)
    double ecco;          // eccentricity
    double inclo;         // inclination (rad)
    double nodeo;         // RAAN (rad)
    double argpo;         // argument of perigee (rad)
    double mo;            // mean anomaly (rad)
    double bstar;         // BSTAR drag term (1/earthRadii)

    // derived / initialized
    char   method;        // 'n' near-earth  'd' deep-space
    int    error;         // 0 = ok; set by sgp4()

    double a;             // semi-major axis (er)
    double no;            // recovered mean motion (rad/min)
    double con41;         // 1 - 5*cos²i
    double x1mth2;        // sin²i = 1 - cos²i
    double x7thm1;        // 7*cos²i - 1

    // near-earth drag/secular
    double cc1, cc4, cc5;
    double d2, d3, d4;
    double omgcof, xmcof, nodecf;
    double t2cof, t3cof, t4cof, t5cof;
    double eta, delmo, sinmao;
    double mdot, argpdot, nodedot;
    double xlcof, aycof;
    int    isimp;

    // deep-space (SDP4) fields
    double e3, ee2, peo, pgho, pho, pinco, plo;
    double se2, se3, sgh2, sgh3, sgh4, sh2, sh3;
    double si2, si3, sl2, sl3, sl4;
    double xgh2, xgh3, xgh4, xh2, xh3;
    double xi2, xi3, xl2, xl3, xl4;
    double zmol, zmos;
    double atime, xli, xni;
    double d2201, d2211, d3210, d3222;
    double d4410, d4422, d5220, d5232, d5421, d5433;
    double dedt, del1, del2, del3;
    double didt, dmdt, dnodt, domdt;
    double irez;         // 0=no resonance  1=one-day  2=half-day
    double ses, sghs, sghl, sgls, sgs, shs, sis, sls;
    double xlamo, xfact;
    int    init;
};

struct PropResult {
    double rx, ry, rz;   // ECI position km
    double vx, vy, vz;   // ECI velocity km/s
    bool   valid;
};

struct Geodetic {
    double lat;   // radians
    double lon;   // radians
    double alt;   // km
    double speed; // km/s
};

// Parse TLE lines (line1[0]='1', line2[0]='2') into satrec.
// Returns false on parse failure.
bool twoline2satrec(const char* line1, const char* line2, elsetrec& satrec);

// Initialize SGP4 constants — must be called once after twoline2satrec.
void sgp4init(elsetrec& satrec);

// Propagate satrec to tsince minutes past epoch.
// satrec.error is set on failure (non-zero).
PropResult sgp4(elsetrec& satrec, double tsince);

// Greenwich Mean Sidereal Time from Julian date (radians).
double gstime(double jd);

// ECI (km) → geodetic.  gmst = gstime(epoch + tsince/1440).
Geodetic eciToGeodetic(double rx, double ry, double rz,
                       double vx, double vy, double vz, double gmst);
