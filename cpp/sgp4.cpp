#include "sgp4.h"
#include <cstring>
#include <cstdio>
#include <cstdlib>
#include <cmath>

static const double PI      = 3.141592653589793;
static const double TWOPI   = 6.283185307179586;
static const double RE      = 6378.137;          // km (WGS-84)
static const double XKE     = 0.0743669161;      // sqrt(GM), er^1.5/min
static const double J2      = 1.082616e-3;
static const double J3      = -2.53881e-6;
static const double J4      = -1.65597e-6;
static const double CK2     = J2 / 2.0;
static const double CK4     = -3.0 * J4 / 8.0;
static const double QOMS2T  = 1.880279e-9;       // (q0-s)^4, er^4
static const double S_CONST = 1.01222928;        // s = 78km/RE + 1, er
static const double A3OVK2  = -J3 / CK2;

static inline double sq(double x) { return x * x; }

static double parseDouble(const char* line, int col, int len) {
    char buf[32];
    strncpy(buf, line + col, (size_t)len);
    buf[len] = '\0';
    char* p = buf;
    while (*p == ' ') p++;
    return atof(p);
}

static double parseDecimalImplied(const char* line, int col, int len) {
    // eccentricity field has no leading decimal point in TLE format
    char buf[32];
    buf[0] = '0'; buf[1] = '.';
    strncpy(buf + 2, line + col, (size_t)len);
    buf[2 + len] = '\0';
    return atof(buf);
}

static double parseSciNotation(const char* line, int col, int len) {
    // BSTAR stored as ±NNNNN±N: implied decimal, base-10 exponent
    char buf[32];
    strncpy(buf, line + col, (size_t)len);
    buf[len] = '\0';
    char* p = buf;
    while (*p == ' ') p++;
    if (*p == '\0') return 0.0;
    int sign = 1;
    if (*p == '-') { sign = -1; p++; }
    else if (*p == '+') p++;
    char mant[16];
    char* ep = p + strlen(p) - 2;
    strncpy(mant, p, (size_t)(ep - p));
    mant[ep - p] = '\0';
    char exp_[4];
    exp_[0] = *ep; exp_[1] = *(ep+1); exp_[2] = '\0';
    double m = atof(mant) * 1e-5;
    int e = atoi(exp_);
    return sign * m * pow(10.0, e);
}

// Vallado algorithm 14 — TLE epoch (yyddd.dddddddd) to Julian date.
static void epochToJulian(double epoch, double& jd, double& jdF) {
    int year = (int)(epoch / 1000.0);
    double doy = epoch - year * 1000.0;
    year += (year < 57) ? 2000 : 1900;

    int mon = 1, d = (int)doy;
    int days_in_month[] = {31,28,31,30,31,30,31,31,30,31,30,31};
    if (year % 4 == 0 && (year % 100 != 0 || year % 400 == 0))
        days_in_month[1] = 29;
    while (d > days_in_month[mon - 1]) {
        d -= days_in_month[mon - 1];
        mon++;
    }
    double frac = doy - (int)doy;
    int hr   = (int)(frac * 24.0);
    int min_ = (int)((frac * 24.0 - hr) * 60.0);
    double sec = ((frac * 24.0 - hr) * 60.0 - min_) * 60.0;

    int A = (14 - mon) / 12;
    int Y = year + 4800 - A;
    int M = mon + 12 * A - 3;
    double JD = d + (153 * M + 2) / 5 + 365 * Y + Y / 4 - Y / 100 + Y / 400 - 32045;
    double JDF = (hr + min_ / 60.0 + sec / 3600.0) / 24.0 - 0.5;
    if (JDF < 0.0) { JD -= 1.0; JDF += 1.0; }
    jd  = JD;
    jdF = JDF;
}

bool twoline2satrec(const char* line1, const char* line2, elsetrec& satrec) {
    memset(&satrec, 0, sizeof(satrec));

    if (line1[0] != '1' || line2[0] != '2') return false;

    double epochRaw = parseDouble(line1, 18, 14);

    // BSTAR (col 53, 8 chars): ±NNNNN±N format
    {
        char buf[12];
        strncpy(buf, line1 + 53, 8); buf[8] = '\0';
        char* p = buf;
        while (*p == ' ') p++;
        int sign = 1;
        if (*p == '-') { sign = -1; p++; }
        else if (*p == '+') { p++; }
        char mant[8] = "0";
        int mi = 0;
        while (*p && *p != '-' && *p != '+' && mi < 6)
            mant[mi++] = *p++;
        mant[mi] = '\0';
        double m = atof(mant) * pow(10.0, -(double)mi);
        int exp_ = 0;
        if (*p) exp_ = atoi(p);
        satrec.bstar = sign * m * pow(10.0, (double)exp_);
    }

    satrec.inclo    = parseDouble(line2, 8, 8)  * PI / 180.0;
    satrec.nodeo    = parseDouble(line2, 17, 8) * PI / 180.0;
    satrec.ecco     = parseDecimalImplied(line2, 26, 7);
    satrec.argpo    = parseDouble(line2, 34, 8) * PI / 180.0;
    satrec.mo       = parseDouble(line2, 43, 8) * PI / 180.0;
    satrec.no_kozai = parseDouble(line2, 52, 11) * TWOPI / 1440.0; // rev/day → rad/min

    epochToJulian(epochRaw, satrec.jdsatepoch, satrec.jdsatepochF);
    satrec.error = 0;
    sgp4init(satrec);
    return (satrec.error == 0);
}

void sgp4init(elsetrec& satrec) {
    const double temp4 = 1.5e-12;

    double no_kozai = satrec.no_kozai;
    double ecco  = satrec.ecco;
    double inclo = satrec.inclo;
    double nodeo = satrec.nodeo;
    double argpo = satrec.argpo;
    double mo    = satrec.mo;
    double bstar = satrec.bstar;

    double cosio  = cos(inclo);
    double cosio2 = cosio * cosio;
    double sinio  = sin(inclo);
    double eosq   = ecco * ecco;
    double betao2 = 1.0 - eosq;
    double betao  = sqrt(betao2);

    // Kozai → Brouwer mean motion recovery
    double a1    = pow(XKE / no_kozai, 2.0 / 3.0);
    double tsi   = 1.0 / (a1 - S_CONST);
    double eta   = a1 * ecco * tsi;
    double etasq = eta * eta;
    double eeta  = ecco * eta;
    double psisq = fabs(1.0 - etasq);
    double coef  = QOMS2T * pow(tsi, 4.0);
    double coef1 = coef / pow(psisq, 3.5);

    double cc2   = coef1 * no_kozai * (a1 * (1.0 + 1.5 * etasq + eeta * (4.0 + etasq))
                   + 0.75 * CK2 * tsi / psisq * satrec.con41 * (8.0 + 3.0 * etasq * (8.0 + etasq)));
    double del1  = 1.5 * CK2 * cosio2 / (a1 * a1 * betao * betao2);
    double ao    = a1 * (1.0 - del1 * (0.5 * (2.0 / 3.0) + del1 * (1.0 + 134.0 / 81.0 * del1)));
    double delo  = 1.5 * CK2 * cosio2 / (ao * ao * betao * betao2);
    double xnodp = no_kozai / (1.0 + delo);
    double ainv  = 1.0 / ao;

    satrec.con41   = 3.0 * cosio2 - 1.0;
    satrec.x1mth2  = 1.0 - cosio2;
    satrec.x7thm1  = 7.0 * cosio2 - 1.0;
    satrec.no      = xnodp;
    satrec.a       = pow(xnodp / XKE, -(2.0 / 3.0));

    // Period >= 225 min → deep space; fall back to secular-only perturbations.
    double period  = TWOPI / satrec.no;
    satrec.method  = (period >= 225.0) ? 'd' : 'n';
    satrec.isimp   = 0;

    if (satrec.method == 'n') {
        double po    = ao * betao2;
        double pov2  = 1.0 / (po * po);
        double pov4  = pov2 * pov2;

        double theta2 = cosio2;
        double theta4 = theta2 * theta2;
        double temp1  = 3.0 * CK2 * pov2 * satrec.no;
        double temp2  = temp1 * CK2 * pov2;
        double temp3  = 1.25 * CK4 * pov4 * satrec.no;

        satrec.mdot    = satrec.no + 0.5 * temp1 * betao * satrec.con41
                         + 0.0625 * temp2 * betao * (13.0 - 78.0 * theta2 + 137.0 * theta4);
        satrec.argpdot = -0.5 * temp1 * satrec.x7thm1
                         + 0.0625 * temp2 * (7.0 - 114.0 * theta2 + 395.0 * theta4)
                         + temp3 * (3.0 - 36.0 * theta2 + 49.0 * theta4);
        double xhdot1   = -temp1 * cosio;
        satrec.nodedot  = xhdot1 + (0.5 * temp2 * (4.0 - 19.0 * theta2)
                          + 2.0 * temp3 * (3.0 - 7.0 * theta2)) * cosio;
        satrec.nodecf   = 3.5 * betao2 * xhdot1 * satrec.cc1;

        double perige = (satrec.a * (1.0 - ecco) - 1.0) * RE;
        double sfour = S_CONST;
        if (perige < 220.0) {
            sfour = perige / RE + 1.0;
        }
        double tsi2   = 1.0 / (satrec.a - sfour);
        double eta2   = satrec.a * ecco * tsi2;
        double etasq2 = eta2 * eta2;
        double psisq2 = fabs(1.0 - etasq2);
        satrec.eta    = eta2;
        double coef2  = QOMS2T * pow(tsi2, 4.0) / pow(psisq2, 3.5);
        double eeta2  = ecco * eta2;

        satrec.cc1  = bstar * coef2 * satrec.no
                      * (satrec.a * (1.0 + 1.5 * etasq2 + eeta2 * (4.0 + etasq2))
                         + 0.75 * CK2 * tsi2 / psisq2 * satrec.con41
                           * (8.0 + 3.0 * etasq2 * (8.0 + etasq2)));
        satrec.cc4  = 2.0 * satrec.no * coef2 * satrec.a * betao2
                      * (eta2 * (2.0 + 0.5 * etasq2)
                         + ecco * (0.5 + 2.0 * etasq2)
                         - CK2 * tsi2 / (satrec.a * psisq2)
                           * (-3.0 * satrec.con41 * (1.0 - 2.0 * eeta2 + etasq2 * (1.5 - 0.5 * eeta2))
                              + 0.75 * satrec.x1mth2 * (2.0 * etasq2 - eeta2 * (1.0 + etasq2))
                                * cos(2.0 * argpo)));
        satrec.cc5  = 2.0 * coef2 * satrec.a * betao2
                      * (1.0 + 2.75 * (etasq2 + eeta2) + eeta2 * etasq2);

        satrec.t2cof = 1.5 * satrec.cc1;

        if (fabs(cosio + 1.0) > 1.5e-12) {
            satrec.xlcof = -0.25 * A3OVK2 * sinio * (3.0 + 5.0 * cosio) / (1.0 + cosio);
        } else {
            satrec.xlcof = -0.25 * A3OVK2 * sinio * (3.0 + 5.0 * cosio) / temp4;
        }
        satrec.aycof  = -0.5 * A3OVK2 * sinio;
        satrec.delmo  = pow(1.0 + satrec.eta * cos(mo), 3.0);
        satrec.sinmao = sin(mo);

        double cc3 = 0.0;
        if (ecco > 1.0e-4)
            cc3 = coef2 * 2.0 * satrec.no * tsi2 / ecco * A3OVK2 * sinio * cos(argpo);
        satrec.omgcof = bstar * cc3;
        satrec.xmcof  = (ecco > 1.0e-4)
                        ? -2.0 / 3.0 * coef2 * bstar / eeta2
                        : 0.0;

        if (perige >= 220.0) {
            double d2    = 4.0 * satrec.a * tsi2 * satrec.cc1 * satrec.cc1;
            double temp5 = d2 * tsi2 * satrec.cc1 / 3.0;
            double d3    = (17.0 * satrec.a + sfour) * temp5;
            double d4    = 0.5 * temp5 * satrec.a * tsi2 * (221.0 * satrec.a + 31.0 * sfour)
                           * satrec.cc1;
            satrec.d2    = d2;
            satrec.d3    = d3;
            satrec.d4    = d4;
            satrec.t3cof = d2 + 2.0 * satrec.cc1 * satrec.cc1;
            satrec.t4cof = 0.25 * (3.0 * d3 + satrec.cc1 * (12.0 * d2 + 10.0 * satrec.cc1 * satrec.cc1));
            satrec.t5cof = 0.2 * (3.0 * d4 + 12.0 * satrec.cc1 * d3
                           + 6.0 * d2 * d2 + 15.0 * satrec.cc1 * satrec.cc1 * (2.0 * d2 + satrec.cc1 * satrec.cc1));
        } else {
            satrec.isimp = 1;
        }
    } else {
        // method='d': secular-only perturbations (no lunar/solar). Accurate enough for display.
        satrec.isimp = 1;

        double po    = satrec.a * betao2;
        double pov2  = 1.0 / (po * po);
        double theta2 = cosio2;
        double theta4 = theta2 * theta2;
        double temp1  = 3.0 * CK2 * pov2 * satrec.no;
        double temp2  = temp1 * CK2 * pov2;
        double temp3  = 1.25 * CK4 * pov2 * pov2 * satrec.no;

        satrec.mdot    = satrec.no + 0.5 * temp1 * betao * satrec.con41
                         + 0.0625 * temp2 * betao * (13.0 - 78.0 * theta2 + 137.0 * theta4);
        satrec.argpdot = -0.5 * temp1 * satrec.x7thm1
                         + 0.0625 * temp2 * (7.0 - 114.0 * theta2 + 395.0 * theta4)
                         + temp3 * (3.0 - 36.0 * theta2 + 49.0 * theta4);
        satrec.nodedot = -temp1 * cosio
                         + (0.5 * temp2 * (4.0 - 19.0 * theta2)
                         + 2.0 * temp3 * (3.0 - 7.0 * theta2)) * cosio;
        satrec.nodecf  = 0.0;
        satrec.cc1     = 0.0;
        satrec.t2cof   = 0.0;
        satrec.xlcof   = fabs(cosio + 1.0) > 1.5e-12
                         ? -0.25 * A3OVK2 * sinio * (3.0 + 5.0 * cosio) / (1.0 + cosio)
                         : -0.25 * A3OVK2 * sinio * (3.0 + 5.0 * cosio) / 1.5e-12;
        satrec.aycof   = -0.5 * A3OVK2 * sinio;
        satrec.delmo   = pow(1.0 + satrec.eta * cos(mo), 3.0);
        satrec.sinmao  = sin(mo);
        satrec.eta     = satrec.a * ecco * (1.0 / (satrec.a - S_CONST));
    }
}

PropResult sgp4(elsetrec& satrec, double tsince) {
    PropResult res;
    res.valid = false;
    satrec.error = 0;

    const double vkmpersec = RE * XKE / 60.0;

    double xmdf   = satrec.mo     + satrec.mdot    * tsince;
    double argpdf = satrec.argpo  + satrec.argpdot * tsince;
    double nodedf = satrec.nodeo  + satrec.nodedot * tsince;
    double argpm  = argpdf;
    double mm     = xmdf;
    double t2     = tsince * tsince;
    double nodem  = nodedf + satrec.nodecf * t2;
    double tempa  = 1.0 - satrec.cc1 * tsince;
    double tempe  = satrec.bstar * satrec.cc4 * tsince;
    double templ  = satrec.t2cof * t2;

    double em, inclm;

    if (satrec.isimp == 1) {
        double delomg = satrec.omgcof * tsince;
        double delm   = satrec.xmcof * (pow(1.0 + satrec.eta * cos(xmdf), 3.0) - satrec.delmo);
        mm     = xmdf + delomg + delm;
        argpm  = argpdf - delomg - delm;
        em     = satrec.ecco - satrec.bstar * satrec.cc4 * tsince;
        inclm  = satrec.inclo;
    } else {
        double delomg = satrec.omgcof * tsince;
        double delm   = satrec.xmcof * (pow(1.0 + satrec.eta * cos(xmdf), 3.0) - satrec.delmo);
        mm     = xmdf + delomg + delm;
        argpm  = argpdf - delomg - delm;
        inclm  = satrec.inclo;
        double t3 = t2 * tsince;
        double t4 = t3 * tsince;
        tempa  = tempa - satrec.d2 * t2 - satrec.d3 * t3 - satrec.d4 * t4;
        tempe += satrec.bstar * satrec.cc5 * (sin(mm) - satrec.sinmao);
        templ += satrec.t3cof * t3 + t4 * (satrec.t4cof + tsince * satrec.t5cof);
        em    = satrec.ecco - tempe;
    }

    if (em < 1.0e-6) em = 1.0e-6;
    if (em >= 1.0)  { satrec.error = 2; return res; }

    mm += satrec.no * templ;

    double am = pow(XKE / satrec.no, 2.0 / 3.0) * sq(tempa);
    if (am < 0.95) { satrec.error = 4; return res; }

    double xlm   = mm + argpm + nodem;
    double sinim = sin(inclm);
    double cosim = cos(inclm);

    // Kepler's equation: E - e*sin(E) = M  (Newton-Raphson)
    double ep = em;
    mm = fmod(xlm - nodem - argpm, TWOPI);
    if (mm < 0.0) mm += TWOPI;

    double pm = am * (1.0 - ep * ep);
    if (pm < 0.0) { satrec.error = 4; return res; }

    double E = mm;
    for (int i = 0; i < 10; ++i) {
        double dE = (mm - E + ep * sin(E)) / (1.0 - ep * cos(E));
        E += dE;
        if (fabs(dE) < 1.0e-12) break;
    }
    double sinE = sin(E), cosE = cos(E);

    double sinv = (sqrt(1.0 - ep * ep) * sinE) / (1.0 - ep * cosE);
    double cosv = (cosE - ep) / (1.0 - ep * cosE);
    double nu   = atan2(sinv, cosv);
    double r    = am * (1.0 - ep * cosE);
    if (r < 0.5 || r > 1.5e5) { satrec.error = 6; return res; }
    double rdot  = XKE / sqrt(pm) * ep * sinv;
    double rvdot = XKE * sqrt(pm) / r;

    double u     = nu + argpm;
    double sin2u = sin(2.0 * u);
    double cos2u = cos(2.0 * u);

    // Short-period oblateness corrections
    double temp1  = CK2 / pm;
    double temp2  = temp1 / pm;
    double rk     = r * (1.0 - 1.5 * temp2 * sqrt(1.0 - sq(sinim) * sq(sinim)) * cos2u)
                    + 0.5 * temp1 * satrec.x1mth2 * cos2u;
    double uk     = u - 0.25 * temp2 * satrec.x7thm1 * sin2u;
    double xnodek = nodem + 1.5 * temp2 * cosim * sin2u;
    double xinck  = inclm + 1.5 * temp2 * cosim * sinim * cos2u;

    double sinuk  = sin(uk), cosuk = cos(uk);
    double sinik  = sin(xinck), cosik = cos(xinck);
    double sinnok = sin(xnodek), cosnok = cos(xnodek);

    double xmx = -sinnok * cosik;
    double xmy =  cosnok * cosik;
    double ux  = xmx * sinuk + cosnok * cosuk;
    double uy  = xmy * sinuk + sinnok * cosuk;
    double uz  = sinik * sinuk;
    double vx  = xmx * cosuk - cosnok * sinuk;
    double vy  = xmy * cosuk - sinnok * sinuk;
    double vz  = sinik * cosuk;

    double mrt = rk * RE;
    res.rx = mrt * ux;
    res.ry = mrt * uy;
    res.rz = mrt * uz;
    res.vx = (rdot * ux + rvdot * vx) * vkmpersec;
    res.vy = (rdot * uy + rvdot * vy) * vkmpersec;
    res.vz = (rdot * uz + rvdot * vz) * vkmpersec;
    res.valid = true;
    return res;
}

double gstime(double jd) {
    double tut1 = (jd - 2451545.0) / 36525.0;
    double theta = -6.2e-6 * tut1 * tut1 * tut1
                   + 0.093104 * tut1 * tut1
                   + (876600.0 * 3600.0 + 8640184.812866) * tut1
                   + 67310.54841;
    theta = fmod(theta, 86400.0) / 240.0 * PI / 180.0;
    if (theta < 0.0) theta += TWOPI;
    return theta;
}

Geodetic eciToGeodetic(double rx, double ry, double rz,
                       double vx, double vy, double vz, double gmst) {
    const double f   = 1.0 / 298.257223563;  // WGS-84 flattening
    const double e2  = f * (2.0 - f);
    const double REq = RE;

    // ECI → ECEF via GMST rotation
    double cosg = cos(gmst), sing = sin(gmst);
    double xe   = rx * cosg + ry * sing;
    double ye   = -rx * sing + ry * cosg;
    double ze   = rz;

    double lon = atan2(ye, xe);

    // Bowring's method — 5 iterations is good to cm accuracy
    double p   = sqrt(xe * xe + ye * ye);
    double lat = atan2(ze, p * (1.0 - e2));
    for (int i = 0; i < 5; ++i) {
        double sinlat = sin(lat);
        double N = REq / sqrt(1.0 - e2 * sinlat * sinlat);
        lat = atan2(ze + e2 * N * sinlat, p);
    }
    double sinlat = sin(lat);
    double N   = REq / sqrt(1.0 - e2 * sinlat * sinlat);
    double alt = (fabs(lat) < 0.7854)
                 ? p / cos(lat) - N
                 : ze / sin(lat) - N * (1.0 - e2);

    Geodetic g;
    g.lat   = lat;
    g.lon   = lon;
    g.alt   = alt;
    g.speed = sqrt(vx * vx + vy * vy + vz * vz);
    return g;
}
