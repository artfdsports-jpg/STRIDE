#include "ChiselHit.h"

#include <algorithm>
#include <cmath>
#include <unordered_map>

namespace chisel {
namespace {

const double kEps = 1e-9;

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
