#include "ChiselGeom.h"

#include <algorithm>
#include <cmath>

namespace chisel {
namespace {

const double kEps = 1e-9;
const double kPi  = 3.14159265358979323846264338327950288;
const double kTau = 6.28318530717958647692528676655900577;

// M_PI is not standard C++ and MSVC hides it behind _USE_MATH_DEFINES, so the
// constants above are the ones this file uses.

// Three-point Gauss-Legendre on [0,1]. The area integrand for a cubic is
// degree five, and this is exact to degree five, so three samples per segment
// is the answer rather than an approximation.
const double kGaussT[3] = {0.5 - 0.5 * 0.7745966692414834,
                           0.5,
                           0.5 + 0.5 * 0.7745966692414834};
const double kGaussW[3] = {5.0 / 18.0, 8.0 / 18.0, 5.0 / 18.0};

}  // namespace

// ---------------------------------------------------------------- vectors

Vec2 operator+(const Vec2& a, const Vec2& b) { return Vec2(a.x + b.x, a.y + b.y); }
Vec2 operator-(const Vec2& a, const Vec2& b) { return Vec2(a.x - b.x, a.y - b.y); }
Vec2 operator*(const Vec2& a, double s) { return Vec2(a.x * s, a.y * s); }

double dot(const Vec2& a, const Vec2& b) { return a.x * b.x + a.y * b.y; }
double cross(const Vec2& a, const Vec2& b) { return a.x * b.y - a.y * b.x; }
double length(const Vec2& a) { return std::sqrt(a.x * a.x + a.y * a.y); }
double distance(const Vec2& a, const Vec2& b) { return length(b - a); }

Vec2 normalize(const Vec2& a) {
    const double n = length(a);
    return (n < kEps) ? Vec2(0.0, 0.0) : Vec2(a.x / n, a.y / n);
}

Vec2 rotate(const Vec2& a, double radians) {
    const double c = std::cos(radians), s = std::sin(radians);
    return Vec2(a.x * c - a.y * s, a.x * s + a.y * c);
}

Vec2 fromAngle(double radians) { return Vec2(std::cos(radians), std::sin(radians)); }
double angleOf(const Vec2& a) { return std::atan2(a.y, a.x); }

double normalizeAngle(double radians) {
    double a = std::fmod(radians, kTau);
    if (a < 0.0) { a += kTau; }
    return a;
}

// ---------------------------------------------------------------- beziers

Vec2 evaluate(const Cubic& c, double t) {
    const double u = 1.0 - t;
    const double a = u * u * u, b = 3.0 * u * u * t, d = 3.0 * u * t * t, e = t * t * t;
    return Vec2(a * c.p0.x + b * c.p1.x + d * c.p2.x + e * c.p3.x,
                a * c.p0.y + b * c.p1.y + d * c.p2.y + e * c.p3.y);
}

Vec2 derivative(const Cubic& c, double t) {
    const double u = 1.0 - t;
    const double a = 3.0 * u * u, b = 6.0 * u * t, d = 3.0 * t * t;
    return Vec2(a * (c.p1.x - c.p0.x) + b * (c.p2.x - c.p1.x) + d * (c.p3.x - c.p2.x),
                a * (c.p1.y - c.p0.y) + b * (c.p2.y - c.p1.y) + d * (c.p3.y - c.p2.y));
}

Vec2 secondDerivative(const Cubic& c, double t) {
    const double u = 1.0 - t;
    return Vec2(6.0 * u * (c.p2.x - 2.0 * c.p1.x + c.p0.x) +
                    6.0 * t * (c.p3.x - 2.0 * c.p2.x + c.p1.x),
                6.0 * u * (c.p2.y - 2.0 * c.p1.y + c.p0.y) +
                    6.0 * t * (c.p3.y - 2.0 * c.p2.y + c.p1.y));
}

Vec2 tangentAt(const Cubic& c, double t) {
    Vec2 d = derivative(c, t);
    if (length(d) > kEps) { return normalize(d); }
    // A retracted handle collapses the first derivative at the endpoint. The
    // second derivative still points along the curve there.
    d = secondDerivative(c, t);
    if (length(d) > kEps) { return normalize(d); }
    return normalize(c.p3 - c.p0);
}

double curvatureRadius(const Cubic& c, double t) {
    const Vec2 d1 = derivative(c, t);
    const Vec2 d2 = secondDerivative(c, t);
    const double num = length(d1);
    const double den = std::fabs(cross(d1, d2));
    if (den < kEps) { return 1e12; }
    return (num * num * num) / den;
}

void split(const Cubic& c, double t, Cubic& left, Cubic& right) {
    const Vec2 p01 = c.p0 + (c.p1 - c.p0) * t;
    const Vec2 p12 = c.p1 + (c.p2 - c.p1) * t;
    const Vec2 p23 = c.p2 + (c.p3 - c.p2) * t;
    const Vec2 p012 = p01 + (p12 - p01) * t;
    const Vec2 p123 = p12 + (p23 - p12) * t;
    const Vec2 mid = p012 + (p123 - p012) * t;

    left.p0 = c.p0;  left.p1 = p01;  left.p2 = p012; left.p3 = mid;
    right.p0 = mid;  right.p1 = p123; right.p2 = p23; right.p3 = c.p3;
}

double arcLength(const Cubic& c, int steps) {
    if (steps < 1) { steps = 1; }
    double total = 0.0;
    Vec2 prev = c.p0;
    for (int i = 1; i <= steps; ++i) {
        const Vec2 cur = evaluate(c, static_cast<double>(i) / steps);
        total += distance(prev, cur);
        prev = cur;
    }
    return total;
}

bool isStraight(const Cubic& c, double eps) {
    return distance(c.p0, c.p1) < eps && distance(c.p3, c.p2) < eps;
}

std::vector<double> derivativeRoots(const Cubic& c, int axis) {
    const double v0 = axis ? c.p0.y : c.p0.x;
    const double v1 = axis ? c.p1.y : c.p1.x;
    const double v2 = axis ? c.p2.y : c.p2.x;
    const double v3 = axis ? c.p3.y : c.p3.x;

    // B'(t) as a quadratic in t.
    const double a = 3.0 * (-v0 + 3.0 * v1 - 3.0 * v2 + v3);
    const double b = 6.0 * (v0 - 2.0 * v1 + v2);
    const double d = 3.0 * (v1 - v0);

    std::vector<double> roots;
    auto keep = [&roots](double t) {
        if (t > 1e-6 && t < 1.0 - 1e-6) { roots.push_back(t); }
    };

    if (std::fabs(a) < kEps) {
        if (std::fabs(b) > kEps) { keep(-d / b); }
    } else {
        const double disc = b * b - 4.0 * a * d;
        if (disc >= 0.0) {
            const double s = std::sqrt(disc);
            keep((-b + s) / (2.0 * a));
            keep((-b - s) / (2.0 * a));
        }
    }
    std::sort(roots.begin(), roots.end());
    return roots;
}

Vec2 closestPoint(const Cubic& c, const Vec2& p, double* tOut, double* distOut, int samples) {
    if (samples < 4) { samples = 4; }

    // Bracket with a coarse sweep. Newton alone is unreliable here: the
    // distance function to a cubic can have three local minima, and starting
    // from the wrong one snaps the cursor to the far side of a loop.
    double bestT = 0.0;
    double bestD = distance(evaluate(c, 0.0), p);
    for (int i = 1; i <= samples; ++i) {
        const double t = static_cast<double>(i) / samples;
        const double d = distance(evaluate(c, t), p);
        if (d < bestD) { bestD = d; bestT = t; }
    }

    // Refine: minimise f(t) = |B(t) - p|^2, so f'(t) = 2 (B - p) . B'.
    double t = bestT;
    for (int i = 0; i < 12; ++i) {
        const Vec2 b = evaluate(c, t);
        const Vec2 d1 = derivative(c, t);
        const Vec2 d2 = secondDerivative(c, t);
        const Vec2 diff = b - p;
        const double f = dot(diff, d1);
        const double df = dot(d1, d1) + dot(diff, d2);
        if (std::fabs(df) < kEps) { break; }
        double next = t - f / df;
        if (next < 0.0) { next = 0.0; }
        if (next > 1.0) { next = 1.0; }
        if (std::fabs(next - t) < 1e-12) { t = next; break; }
        t = next;
    }

    const Vec2 hit = evaluate(c, t);
    const double d = distance(hit, p);
    // Newton can wander to a worse stationary point; keep the better of the two.
    if (d > bestD) {
        if (tOut) { *tOut = bestT; }
        if (distOut) { *distOut = bestD; }
        return evaluate(c, bestT);
    }
    if (tOut) { *tOut = t; }
    if (distOut) { *distOut = d; }
    return hit;
}

// ---------------------------------------------------------------- circles

bool fitCircle(const std::vector<Vec2>& samples, Circle& out, double* worstDev) {
    const std::size_t n = samples.size();
    if (n < 3) { return false; }

    double mx = 0.0, my = 0.0;
    for (const Vec2& s : samples) { mx += s.x; my += s.y; }
    mx /= static_cast<double>(n);
    my /= static_cast<double>(n);

    double Suu = 0, Suv = 0, Svv = 0, Suuu = 0, Svvv = 0, Suvv = 0, Svuu = 0;
    for (const Vec2& s : samples) {
        const double u = s.x - mx, v = s.y - my;
        Suu += u * u;
        Suv += u * v;
        Svv += v * v;
        Suuu += u * u * u;
        Svvv += v * v * v;
        Suvv += u * v * v;
        Svuu += v * u * u;
    }

    const double det = Suu * Svv - Suv * Suv;
    if (std::fabs(det) < kEps) { return false; }

    const double b1 = (Suuu + Suvv) * 0.5;
    const double b2 = (Svvv + Svuu) * 0.5;
    const double uc = (b1 * Svv - b2 * Suv) / det;
    const double vc = (b2 * Suu - b1 * Suv) / det;
    const double rsq = uc * uc + vc * vc + (Suu + Svv) / static_cast<double>(n);
    if (rsq <= 0.0) { return false; }

    out.centre = Vec2(uc + mx, vc + my);
    out.radius = std::sqrt(rsq);

    if (worstDev) {
        double worst = 0.0;
        for (const Vec2& s : samples) {
            worst = std::max(worst, std::fabs(distance(s, out.centre) - out.radius));
        }
        *worstDev = worst;
    }
    return true;
}

CircleFit recogniseCircle(const std::vector<Vec2>& anchors,
                          const std::vector<Vec2>& denseSamples,
                          double tolerance) {
    CircleFit result;
    Circle c;

    const bool fitted = (anchors.size() >= 3) ? fitCircle(anchors, c, nullptr)
                                              : fitCircle(denseSamples, c, nullptr);
    if (!fitted) { return result; }

    result.circle = c;

    double worst = 0.0;
    const std::vector<Vec2>& check = denseSamples.empty() ? anchors : denseSamples;
    for (const Vec2& s : check) {
        worst = std::max(worst, std::fabs(distance(s, c.centre) - c.radius));
    }
    result.deviation = worst;
    result.relative = (c.radius > kEps) ? worst / c.radius : 1e9;
    result.ok = result.relative <= tolerance;
    return result;
}

// --------------------------------------------------------------- tangents

std::vector<TangentPair> externalTangents(const Circle& a, const Circle& b) {
    std::vector<TangentPair> out;
    const Vec2 dv = b.centre - a.centre;
    const double d = length(dv);
    if (d < kEps) { return out; }

    // Perpendicularity of the connecting line to the shared radius direction u
    // reduces to u . (cB - cA) = rA - rB: one cosine, so two mirrored answers.
    const double q = (a.radius - b.radius) / d;
    if (q > 1.0 || q < -1.0) { return out; }

    const double base = std::atan2(dv.y, dv.x);
    const double alpha = std::acos(q);
    for (int k = 0; k < 2; ++k) {
        TangentPair t;
        t.angle = base + (k == 0 ? alpha : -alpha);
        t.direction = fromAngle(t.angle);
        t.side = (k == 0) ? 1 : -1;
        t.pointA = a.centre + t.direction * a.radius;
        t.pointB = b.centre + t.direction * b.radius;
        out.push_back(t);
    }
    return out;
}

std::vector<TangentPair> internalTangents(const Circle& a, const Circle& b) {
    std::vector<TangentPair> out;
    const Vec2 dv = b.centre - a.centre;
    const double d = length(dv);
    if (d < kEps) { return out; }

    const double q = (a.radius + b.radius) / d;
    if (q > 1.0) { return out; }   // overlapping: nothing passes between them

    const double base = std::atan2(dv.y, dv.x);
    const double alpha = std::acos(q);
    for (int k = 0; k < 2; ++k) {
        TangentPair t;
        t.angle = base + (k == 0 ? alpha : -alpha);
        t.direction = fromAngle(t.angle);
        t.side = (k == 0) ? 1 : -1;
        t.pointA = a.centre + t.direction * a.radius;
        t.pointB = b.centre - t.direction * b.radius;
        out.push_back(t);
    }
    return out;
}

std::vector<PointTangent> tangentsFromPoint(const Vec2& p, const Circle& c) {
    std::vector<PointTangent> out;
    const Vec2 dv = c.centre - p;
    const double d = length(dv);
    if (d <= c.radius + kEps) { return out; }

    const double base = std::atan2(dv.y, dv.x);
    const double alpha = std::asin(c.radius / d);
    const double len = std::sqrt(d * d - c.radius * c.radius);
    for (int k = 0; k < 2; ++k) {
        PointTangent t;
        t.side = (k == 0) ? 1 : -1;
        t.length = len;
        t.point = p + fromAngle(base + (k == 0 ? alpha : -alpha)) * len;
        out.push_back(t);
    }
    return out;
}

std::vector<Vec2> circleIntersections(const Circle& a, const Circle& b) {
    std::vector<Vec2> out;
    const Vec2 dv = b.centre - a.centre;
    const double d = length(dv);
    if (d < kEps) { return out; }
    if (d > a.radius + b.radius + 1e-7) { return out; }
    if (d < std::fabs(a.radius - b.radius) - 1e-7) { return out; }

    const double t = (a.radius * a.radius - b.radius * b.radius + d * d) / (2.0 * d);
    double hsq = a.radius * a.radius - t * t;
    if (hsq < 0.0) { hsq = 0.0; }
    const double h = std::sqrt(hsq);

    const Vec2 mid = a.centre + dv * (t / d);
    const Vec2 perp(-dv.y / d, dv.x / d);
    out.push_back(mid + perp * h);
    out.push_back(mid - perp * h);
    return out;
}

std::vector<Circle> tangentCircles(const Circle& a, const Circle& b,
                                   double radius, const char* mode) {
    // Each driver constrains the new centre to a circle of its own, so the
    // whole problem collapses to one circle-circle intersection.
    const bool insideA = mode && mode[0] == 'i';
    const bool insideB = mode && mode[0] && mode[1] == 'i';

    Circle locusA;
    locusA.centre = a.centre;
    locusA.radius = insideA ? std::fabs(radius - a.radius) : (a.radius + radius);

    Circle locusB;
    locusB.centre = b.centre;
    locusB.radius = insideB ? std::fabs(radius - b.radius) : (b.radius + radius);

    std::vector<Circle> out;
    for (const Vec2& hit : circleIntersections(locusA, locusB)) {
        Circle c;
        c.centre = hit;
        c.radius = radius;
        out.push_back(c);
    }
    return out;
}

// ------------------------------------------------------------------ paths

std::size_t segmentCount(const PointList& pts, bool closed) {
    if (pts.size() < 2) { return 0; }
    return closed ? pts.size() : pts.size() - 1;
}

Cubic segmentAt(const PointList& pts, std::size_t i, bool closed) {
    Cubic c;
    if (pts.size() < 2 || i >= pts.size()) { return c; }
    // The wrap is only legitimate on a closed path. Asking an open path for the
    // segment after its last point would otherwise return a phantom closing
    // segment that is not in the artwork.
    if (!closed && i + 1 >= pts.size()) { return c; }
    const std::size_t j = (i + 1) % pts.size();
    c.p0 = pts[i].anchor;
    c.p1 = pts[i].out;
    c.p2 = pts[j].in;
    c.p3 = pts[j].anchor;
    return c;
}

namespace {

bool arcContains(double a0, double a1, double via, bool ccw) {
    double span, off;
    if (ccw) {
        span = normalizeAngle(a1 - a0);
        off = normalizeAngle(via - a0);
    } else {
        span = normalizeAngle(a0 - a1);
        off = normalizeAngle(a0 - via);
    }
    if (span < kEps) { span = kTau; }
    return off <= span + kEps;
}

}  // namespace

PointList arcPoints(const Circle& c, double a0, double a1, bool counterClockwise) {
    double sweep = counterClockwise ? normalizeAngle(a1 - a0) : -normalizeAngle(a0 - a1);
    // A zero sweep means a full turn. An empty arc is never what the caller
    // wanted; a whole circle sometimes is.
    if (std::fabs(sweep) < 1e-12) { sweep = counterClockwise ? kTau : -kTau; }

    int n = static_cast<int>(std::ceil(std::fabs(sweep) / (kPi * 0.5) - 1e-9));
    if (n < 1) { n = 1; }
    const double step = sweep / n;
    const double k = (4.0 / 3.0) * std::tan(step * 0.25);

    PointList pts;
    pts.reserve(static_cast<std::size_t>(n) + 1);
    for (int i = 0; i <= n; ++i) {
        const double th = a0 + step * i;
        const Vec2 p(c.centre.x + c.radius * std::cos(th),
                     c.centre.y + c.radius * std::sin(th));
        const Vec2 tv(-std::sin(th) * c.radius * k, std::cos(th) * c.radius * k);

        PathPoint pp;
        pp.anchor = p;
        pp.in = p - tv;
        pp.out = p + tv;
        pp.smooth = true;
        pts.push_back(pp);
    }
    pts.front().in = pts.front().anchor;
    pts.front().smooth = false;
    pts.back().out = pts.back().anchor;
    pts.back().smooth = false;
    return pts;
}

PointList arcThrough(const Circle& c, double a0, double a1, double via) {
    return arcPoints(c, a0, a1, arcContains(a0, a1, via, true));
}

PointList linePoints(const Vec2& a, const Vec2& b) {
    PointList pts;
    PathPoint p;
    p.anchor = a; p.in = a; p.out = a; p.smooth = false;
    pts.push_back(p);
    p.anchor = b; p.in = b; p.out = b; p.smooth = false;
    pts.push_back(p);
    return pts;
}

PointList beltOutline(const Circle& a, const Circle& b, bool crossed) {
    const std::vector<TangentPair> t = crossed ? internalTangents(a, b) : externalTangents(a, b);
    if (t.size() < 2) { return PointList(); }

    const Vec2 dv = b.centre - a.centre;
    const double base = std::atan2(dv.y, dv.x);      // a -> b
    const double flip = crossed ? kPi : 0.0;

    // Wrap the side of each circle that faces away from the other. For the
    // crossed belt the tangent points on b sit half a turn round, and that same
    // rule then produces the figure eight without a special case.
    const PointList arcB = arcThrough(b, t[0].angle + flip, t[1].angle + flip, base);
    const PointList arcA = arcThrough(a, t[1].angle, t[0].angle, base + kPi);

    PointList out;
    out.reserve(arcA.size() + arcB.size());
    out.insert(out.end(), arcB.begin(), arcB.end());
    out.insert(out.end(), arcA.begin(), arcA.end());
    return out;
}

PointList tangentSegment(const Circle& a, const Circle& b, bool crossed, int side) {
    const std::vector<TangentPair> t = crossed ? internalTangents(a, b) : externalTangents(a, b);
    for (const TangentPair& p : t) {
        if (p.side == side) { return linePoints(p.pointA, p.pointB); }
    }
    return PointList();
}

double enclosedArea(const PointList& pts, bool closed) {
    if (!closed) { return 0.0; }
    double total = 0.0;
    const std::size_t n = segmentCount(pts, closed);
    for (std::size_t i = 0; i < n; ++i) {
        const Cubic c = segmentAt(pts, i, closed);
        for (int g = 0; g < 3; ++g) {
            const Vec2 p = evaluate(c, kGaussT[g]);
            const Vec2 d = derivative(c, kGaussT[g]);
            total += kGaussW[g] * (p.x * d.y - p.y * d.x);
        }
    }
    return std::fabs(total) * 0.5;
}

double pathLength(const PointList& pts, bool closed) {
    double total = 0.0;
    const std::size_t n = segmentCount(pts, closed);
    for (std::size_t i = 0; i < n; ++i) {
        total += arcLength(segmentAt(pts, i, closed), 32);
    }
    return total;
}

std::vector<Vec2> samplePath(const PointList& pts, bool closed, int perSegment) {
    std::vector<Vec2> out;
    if (perSegment < 1) { perSegment = 1; }
    const std::size_t n = segmentCount(pts, closed);
    for (std::size_t i = 0; i < n; ++i) {
        const Cubic c = segmentAt(pts, i, closed);
        for (int j = 0; j < perSegment; ++j) {
            out.push_back(evaluate(c, static_cast<double>(j) / perSegment));
        }
    }
    if (!closed && !pts.empty()) { out.push_back(pts.back().anchor); }
    return out;
}

}  // namespace chisel
