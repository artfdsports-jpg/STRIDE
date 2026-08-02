#include "ChiselHit.h"

#include <algorithm>
#include <cmath>
#include <unordered_map>

namespace chisel {
namespace {

const double kEps = 1e-9;
const double kPiHalf = 1.57079632679489661923;
const double kPiQuarter = 0.785398163397448309616;

// Spatial hash cell key. Cells are sized to the tolerance, so any pair within
// tolerance shares a cell or sits in one of the eight neighbours.
struct CellKey {
    long long x = 0;
    long long y = 0;

    bool operator==(const CellKey& o) const { return x == o.x && y == o.y; }
};

struct CellHash {
    std::size_t operator()(const CellKey& k) const {
        // Two odd multipliers, xored. Grid coordinates are small and highly
        // correlated, so a plain sum collides constantly along diagonals.
        const unsigned long long a = static_cast<unsigned long long>(k.x) * 0x9E3779B97F4A7C15ull;
        const unsigned long long b = static_cast<unsigned long long>(k.y) * 0xC2B2AE3D27D4EB4Full;
        return static_cast<std::size_t>(a ^ (b + 0x165667B19E3779F9ull + (a << 6) + (a >> 2)));
    }
};

CellKey cellOf(const Vec2& p, double cell) {
    CellKey k;
    k.x = static_cast<long long>(std::floor(p.x / cell));
    k.y = static_cast<long long>(std::floor(p.y / cell));
    return k;
}

}  // namespace

// -------------------------------------------------------------- hit test

HitResult hitTest(const std::vector<PathRef>& paths,
                  const Vec2& query,
                  double pointTolerance,
                  double segmentTolerance,
                  double handleTolerance) {
    HitResult best;
    best.distance = 1e300;

    // Anchors first. A hit here ends the search for that priority band, but the
    // loop still runs to completion so the nearest anchor wins over the first.
    for (std::size_t pi = 0; pi < paths.size(); ++pi) {
        const PathRef& path = paths[pi];
        for (std::size_t i = 0; i < path.points.size(); ++i) {
            const double d = distance(path.points[i].anchor, query);
            if (d <= pointTolerance && d < best.distance) {
                best.kind = HitKind::Anchor;
                best.pathIndex = pi;
                best.pointIndex = i;
                best.distance = d;
                best.position = path.points[i].anchor;
            }
        }
    }
    if (best.kind != HitKind::None) { return best; }

    // Handles, but only where they would actually be drawn. Hit-testing an
    // invisible handle means the cursor grabs something the user cannot see.
    for (std::size_t pi = 0; pi < paths.size(); ++pi) {
        const PathRef& path = paths[pi];
        if (!path.hasSelection) { continue; }
        for (std::size_t i = 0; i < path.points.size(); ++i) {
            const PathPoint& p = path.points[i];

            const double dIn = distance(p.in, query);
            if (distance(p.in, p.anchor) > kEps && dIn <= handleTolerance && dIn < best.distance) {
                best.kind = HitKind::InHandle;
                best.pathIndex = pi;
                best.pointIndex = i;
                best.distance = dIn;
                best.position = p.in;
            }
            const double dOut = distance(p.out, query);
            if (distance(p.out, p.anchor) > kEps && dOut <= handleTolerance && dOut < best.distance) {
                best.kind = HitKind::OutHandle;
                best.pathIndex = pi;
                best.pointIndex = i;
                best.distance = dOut;
                best.position = p.out;
            }
        }
    }
    if (best.kind != HitKind::None) { return best; }

    for (std::size_t pi = 0; pi < paths.size(); ++pi) {
        const PathRef& path = paths[pi];
        const std::size_t n = segmentCount(path.points, path.closed);
        for (std::size_t i = 0; i < n; ++i) {
            const Cubic c = segmentAt(path.points, i, path.closed);
            double t = 0.0, d = 0.0;
            const Vec2 hit = closestPoint(c, query, &t, &d);
            if (d <= segmentTolerance && d < best.distance) {
                best.kind = HitKind::Segment;
                best.pathIndex = pi;
                best.pointIndex = i;
                best.t = t;
                best.distance = d;
                best.position = hit;
            }
        }
    }

    if (best.kind == HitKind::None) { best.distance = 0.0; }
    return best;
}

// ------------------------------------------------------------------ snaps

std::vector<SnapCandidate> findSnaps(const std::vector<PathRef>& paths,
                                     const std::vector<Circle>& circles,
                                     const Vec2& query,
                                     double tolerance) {
    std::vector<SnapCandidate> out;

    // Tangency to a circle. Offered first because it is the one the user is
    // deliberately reaching for; the others are conveniences.
    for (std::size_t ci = 0; ci < circles.size(); ++ci) {
        Vec2 p, dir;
        if (!tangentSnapToCircle(circles[ci], query, p, dir)) { continue; }
        const double d = distance(p, query);
        if (d > tolerance) { continue; }
        SnapCandidate s;
        s.kind = SnapKind::CircleTangency;
        s.position = p;
        s.direction = dir;
        s.distance = d;
        s.subject = ci;
        out.push_back(s);
    }

    // Axis tangencies: the points where a curve is momentarily level or
    // upright. These are the extremes of the shape, and the places anchors
    // belong if the outline is ever going to be edited again.
    for (std::size_t pi = 0; pi < paths.size(); ++pi) {
        const PathRef& path = paths[pi];
        const std::size_t n = segmentCount(path.points, path.closed);
        for (std::size_t i = 0; i < n; ++i) {
            const Cubic c = segmentAt(path.points, i, path.closed);
            for (int axis = 0; axis < 2; ++axis) {
                for (double t : derivativeRoots(c, axis)) {
                    const Vec2 p = evaluate(c, t);
                    const double d = distance(p, query);
                    if (d > tolerance) { continue; }
                    SnapCandidate s;
                    s.kind = (axis == 1) ? SnapKind::HorizontalTangency
                                         : SnapKind::VerticalTangency;
                    s.position = p;
                    s.direction = tangentAt(c, t);
                    s.distance = d;
                    s.subject = pi;
                    out.push_back(s);
                }
            }
        }
    }

    for (std::size_t pi = 0; pi < paths.size(); ++pi) {
        for (const PathPoint& p : paths[pi].points) {
            const double d = distance(p.anchor, query);
            if (d > tolerance) { continue; }
            SnapCandidate s;
            s.kind = SnapKind::Anchor;
            s.position = p.anchor;
            s.distance = d;
            s.subject = pi;
            out.push_back(s);
        }
    }

    // Stable ordering within each kind, so a snap does not swap between two
    // equidistant targets as the cursor jitters.
    std::stable_sort(out.begin(), out.end(),
                     [](const SnapCandidate& a, const SnapCandidate& b) {
                         if (a.kind != b.kind) { return a.kind < b.kind; }
                         return a.distance < b.distance;
                     });
    return out;
}

// ------------------------------------------------------------ coincidence

std::vector<Coincidence> findCoincidentAnchors(const std::vector<PathRef>& paths,
                                               double tolerance) {
    std::vector<Coincidence> out;
    if (tolerance <= 0.0) { return out; }

    struct Entry {
        std::size_t path;
        std::size_t point;
        Vec2 pos;
    };

    std::unordered_map<CellKey, std::vector<Entry>, CellHash> grid;
    for (std::size_t pi = 0; pi < paths.size(); ++pi) {
        for (std::size_t i = 0; i < paths[pi].points.size(); ++i) {
            const Vec2 a = paths[pi].points[i].anchor;
            grid[cellOf(a, tolerance)].push_back(Entry{pi, i, a});
        }
    }

    for (std::size_t pi = 0; pi < paths.size(); ++pi) {
        for (std::size_t i = 0; i < paths[pi].points.size(); ++i) {
            const Vec2 a = paths[pi].points[i].anchor;
            const CellKey home = cellOf(a, tolerance);

            for (long long dx = -1; dx <= 1; ++dx) {
                for (long long dy = -1; dy <= 1; ++dy) {
                    CellKey k;
                    k.x = home.x + dx;
                    k.y = home.y + dy;
                    auto it = grid.find(k);
                    if (it == grid.end()) { continue; }

                    for (const Entry& e : it->second) {
                        // Each unordered pair once. Comparing indices rather
                        // than deduplicating afterwards keeps this a single
                        // pass and costs nothing.
                        if (e.path < pi || (e.path == pi && e.point <= i)) { continue; }
                        const double gap = distance(a, e.pos);
                        if (gap > tolerance) { continue; }
                        out.push_back(Coincidence{pi, i, e.path, e.point, gap});
                    }
                }
            }
        }
    }
    return out;
}

// ------------------------------------------------------------ constraints

void applyTangentConstraint(PointList& pts, std::size_t index, const Vec2& newAnchor,
                            const Vec2& lockedDirection) {
    if (index >= pts.size()) { return; }
    PathPoint& p = pts[index];

    const double lenIn = distance(p.anchor, p.in);
    const double lenOut = distance(p.anchor, p.out);
    const Vec2 dir = normalize(lockedDirection);

    p.anchor = newAnchor;
    if (length(dir) < kEps) {
        // Nothing to hold on to; degrade to a plain move rather than flattening
        // the handles onto the anchor.
        return;
    }
    p.in = newAnchor - dir * lenIn;
    p.out = newAnchor + dir * lenOut;
    p.smooth = true;
}

bool enforceSmooth(PointList& pts, std::size_t index) {
    if (index >= pts.size()) { return false; }
    PathPoint& p = pts[index];

    const double lenIn = distance(p.anchor, p.in);
    const double lenOut = distance(p.anchor, p.out);
    if (lenIn < kEps && lenOut < kEps) { return false; }

    Vec2 dir = p.out - p.in;
    if (length(dir) < kEps) {
        // Both handles on the same side: take the direction from whichever one
        // still has length rather than inventing one.
        dir = (lenOut > lenIn) ? (p.out - p.anchor) : (p.anchor - p.in);
    }
    if (length(dir) < kEps) { return false; }
    dir = normalize(dir);

    p.in = p.anchor - dir * lenIn;
    p.out = p.anchor + dir * lenOut;
    p.smooth = true;
    return true;
}

// ------------------------------------------------------------- extending

PointList reversed(const PointList& pts) {
    PointList out;
    out.reserve(pts.size());
    for (std::size_t i = pts.size(); i > 0; --i) {
        PathPoint p = pts[i - 1];
        std::swap(p.in, p.out);
        out.push_back(p);
    }
    return out;
}

bool endFrame(const PointList& pts, bool closed, bool atStart, EndFrame& out) {
    if (pts.size() < 2 || closed) { return false; }

    const std::size_t i = atStart ? 0 : pts.size() - 2;
    const double t = atStart ? 0.0 : 1.0;
    const Cubic seg = segmentAt(pts, i, false);

    out.point = atStart ? seg.p0 : seg.p3;
    out.curved = false;

    Vec2 d1 = derivative(seg, t);
    if (length(d1) < kEps) {
        // A retracted handle collapses the first derivative at the endpoint.
        // The chord still says which way the segment runs.
        const Vec2 chord = atStart ? (seg.p0 - seg.p3) : (seg.p3 - seg.p0);
        if (length(chord) < kEps) { return false; }
        out.tangent = normalize(chord);
        out.radius = 1e12;
        return true;
    }

    out.tangent = normalize(d1);
    if (atStart) { out.tangent = out.tangent * -1.0; }

    const Vec2 d2 = secondDerivative(seg, t);
    const double turn = cross(d1, d2);
    double rho = curvatureRadius(seg, t);

    if (rho > 1e6 || std::fabs(turn) < kEps) {
        out.radius = 1e12;
        return true;
    }

    // Prefer a circle fitted to the whole terminal segment. Only the magnitude
    // is taken from it; the centre is placed on the exact normal at the
    // endpoint, so the join stays perfectly tangent even where the fit is not.
    std::vector<Vec2> samples;
    samples.reserve(13);
    for (int s = 0; s <= 12; ++s) { samples.push_back(evaluate(seg, s / 12.0)); }

    Circle fitted;
    double dev = 0.0;
    if (fitCircle(samples, fitted, &dev) && fitted.radius > kEps) {
        const double rel = dev / fitted.radius;
        if (rel <= 0.01 && fitted.radius < 1e6 &&
            fitted.radius > rho * 0.5 && fitted.radius < rho * 2.0) {
            rho = fitted.radius;
        }
    }

    Vec2 nrm = normalize(Vec2(-d1.y, d1.x));
    if (turn < 0.0) { nrm = nrm * -1.0; }

    out.radius = rho;
    out.centre = out.point + nrm * rho;
    out.curved = true;
    return true;
}

namespace {

// An arc given a signed sweep rather than an end angle. A tight extension arc
// can easily wrap more than a full turn, which two angles cannot express.
PointList arcBySweep(const Circle& c, double a0, double sweep) {
    int n = static_cast<int>(std::ceil(std::fabs(sweep) / (kPiHalf) - 1e-9));
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
    pts.back().out = pts.back().anchor;
    pts.back().smooth = false;
    return pts;
}

PointList straightRun(const Vec2& from, const Vec2& dir, double len) {
    const Vec2 to = from + dir * len;
    PointList pts;
    PathPoint a;
    a.anchor = from; a.in = from; a.out = from; a.smooth = false;
    pts.push_back(a);
    PathPoint b;
    b.anchor = to; b.in = to; b.out = to; b.smooth = false;
    pts.push_back(b);
    return pts;
}

/*
 * A logarithmic spiral continuing from a point with a known tangent and
 * curvature radius.
 *
 * In its own polar frame the spiral is r(th) = r0 e^(b th), with curvature
 * radius r sqrt(1+b^2) and arc length (sqrt(1+b^2)/b)(r - r0). Substituting
 * rho0 = r0 sqrt(1+b^2) collapses the arc-length inversion to
 *
 *     th(s) = ln(1 + s b / rho0) / b
 *
 * so the construction never has to integrate anything.
 */
PointList spiralRun(const Vec2& p, const Vec2& tan, double rho0, int turnSign,
                    double b, double len) {
    PointList pts;
    if (rho0 > 1e6 || std::fabs(b) < 1e-4 || len <= 0.0) { return pts; }

    const double root = std::sqrt(1.0 + b * b);
    const double r0 = rho0 / root;
    const double sigma = (turnSign >= 0) ? 1.0 : -1.0;

    const double inner = 1.0 + len * b / rho0;
    if (inner <= kEps) { return pts; }        // winds into its pole first
    const double thEnd = std::log(inner) / b;

    const double phi = std::atan2(tan.y, tan.x) - std::atan2(sigma, b);
    const double cosPhi = std::cos(phi), sinPhi = std::sin(phi);

    auto place = [&](double th) {
        const double r = r0 * std::exp(b * th);
        const double dx = r * std::cos(th) - r0;
        const double dy = sigma * r * std::sin(th);
        return Vec2(p.x + dx * cosPhi - dy * sinPhi, p.y + dx * sinPhi + dy * cosPhi);
    };
    auto unitTangent = [&](double th) {
        const double ct = std::cos(th), st = std::sin(th);
        double vx = b * ct - st;
        double vy = sigma * (b * st + ct);
        const double m = std::sqrt(vx * vx + vy * vy);
        if (m < kEps) { return tan; }
        vx /= m; vy /= m;
        return Vec2(vx * cosPhi - vy * sinPhi, vx * sinPhi + vy * cosPhi);
    };

    // One control point per 45 degrees of turn. Coarser than this and the drawn
    // curve starts to cut corners on a tight winding.
    int n = static_cast<int>(std::ceil(std::fabs(thEnd) / kPiQuarter));
    if (n < 2) { n = 2; }
    if (n > 400) { n = 400; }

    std::vector<Vec2> position(static_cast<std::size_t>(n) + 1);
    std::vector<Vec2> heading(static_cast<std::size_t>(n) + 1);
    std::vector<double> arc(static_cast<std::size_t>(n) + 1);
    for (int i = 0; i <= n; ++i) {
        const double th = thEnd * i / n;
        position[i] = place(th);
        heading[i] = unitTangent(th);
        arc[i] = rho0 * (std::exp(b * th) - 1.0) / b;
    }

    pts.reserve(static_cast<std::size_t>(n) + 1);
    for (int i = 0; i <= n; ++i) {
        const double dsIn = (i > 0) ? (arc[i] - arc[i - 1]) : 0.0;
        const double dsOut = (i < n) ? (arc[i + 1] - arc[i]) : 0.0;
        PathPoint pp;
        pp.anchor = position[i];
        pp.in = position[i] - heading[i] * (dsIn / 3.0);
        pp.out = position[i] + heading[i] * (dsOut / 3.0);
        pp.smooth = true;
        pts.push_back(pp);
    }
    pts.front().in = pts.front().anchor;
    pts.back().out = pts.back().anchor;
    pts.back().smooth = false;
    return pts;
}

}  // namespace

PointList buildExtension(const EndFrame& frame, ExtendMode mode, double len,
                         double spiralWinding) {
    if (len <= 0.0) { return PointList(); }

    if (mode == ExtendMode::Straight || !frame.curved) {
        return straightRun(frame.point, frame.tangent, len);
    }

    // Which way round the centre the outward tangent points decides the sweep
    // sign. Read from the geometry rather than assumed, so both ends of the
    // same arc curl the same way.
    const int turn = (cross(frame.point - frame.centre, frame.tangent) > 0.0) ? 1 : -1;

    if (mode == ExtendMode::Spiral) {
        PointList s = spiralRun(frame.point, frame.tangent, frame.radius, turn,
                                spiralWinding, len);
        if (!s.empty()) { return s; }
        // A winding of zero is a circle, which is a legitimate answer, so fall
        // through to the arc rather than failing.
    }

    Circle c;
    c.centre = frame.centre;
    c.radius = frame.radius;
    return arcBySweep(c, std::atan2(frame.point.y - frame.centre.y,
                                    frame.point.x - frame.centre.x),
                      (len / frame.radius) * turn);
}

PointList attachExtension(const PointList& pts, const PointList& run, bool atStart) {
    PointList out;
    if (pts.size() < 2 || run.size() < 2) { return out; }

    if (atStart) {
        const PointList rev = reversed(run);
        out.insert(out.end(), rev.begin(), rev.end() - 1);
        out.insert(out.end(), pts.begin(), pts.end());
        // The run's first point sits on the existing endpoint, so its outward
        // handle becomes that endpoint's incoming one.
        out[rev.size() - 1].in = run.front().out;
        out[rev.size() - 1].smooth = true;
    } else {
        out.insert(out.end(), pts.begin(), pts.end());
        out[pts.size() - 1].out = run.front().out;
        out[pts.size() - 1].smooth = true;
        out.insert(out.end(), run.begin() + 1, run.end());
    }
    return out;
}

PointList trimEnd(const PointList& pts, bool atStart, double amount) {
    PointList work = atStart ? reversed(pts) : pts;
    double remaining = amount;

    while (work.size() >= 2 && remaining > kEps) {
        const std::size_t i = work.size() - 2;
        const Cubic seg = segmentAt(work, i, false);
        const double segLen = arcLength(seg, 96);

        if (segLen <= remaining + kEps) {
            work.pop_back();
            remaining -= segLen;
            continue;
        }

        // Invert arc length on this segment by bisection. A table would be
        // faster, but this runs once per trim, not once per frame.
        double lo = 0.0, hi = 1.0;
        const double want = segLen - remaining;
        for (int k = 0; k < 60; ++k) {
            const double mid = (lo + hi) * 0.5;
            Cubic left, right;
            split(seg, mid, left, right);
            if (arcLength(left, 96) < want) { lo = mid; } else { hi = mid; }
        }
        Cubic left, right;
        split(seg, (lo + hi) * 0.5, left, right);

        work[i].out = left.p1;
        work[i + 1].in = left.p2;
        work[i + 1].anchor = left.p3;
        work[i + 1].out = left.p3;
        remaining = 0.0;
    }

    if (work.size() < 2) { return PointList(); }
    return atStart ? reversed(work) : work;
}

bool tangentSnapToCircle(const Circle& c, const Vec2& query, Vec2& outPoint, Vec2& outDirection) {
    if (c.radius < kEps) { return false; }
    Vec2 radial = query - c.centre;
    if (length(radial) < kEps) {
        // Dead centre: no unique nearest point. Pick one rather than dividing
        // by zero, so the caller gets something valid to reject on distance.
        radial = Vec2(1.0, 0.0);
    }
    radial = normalize(radial);
    outPoint = c.centre + radial * c.radius;
    outDirection = Vec2(-radial.y, radial.x);   // perpendicular to the radius
    return true;
}

}  // namespace chisel
