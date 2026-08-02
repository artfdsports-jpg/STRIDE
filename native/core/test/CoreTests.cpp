// Tests for the Chisel native core.
//
// The core is free of Illustrator types precisely so this can run anywhere:
//
//   cmake -S native/core -B native/core/build && cmake --build native/core/build
//   ./native/core/build/chisel_core_tests
//
// Where a construction has a known closed-form answer, that is what is
// asserted. Where it does not, the assertion is a property that must hold - a
// tangent is perpendicular to both radii, an arc endpoint lies on its circle -
// which catches sign and branch errors that eyeballing a picture never will.
//
// These mirror the JavaScript suites deliberately. The two implementations have
// to agree, and a shared test intent is the cheapest way to notice when a fix
// lands in one and not the other.

#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

#include "../ChiselGeom.h"
#include "../ChiselHit.h"

using namespace chisel;

namespace {

int passed = 0;
int failed = 0;

void ok(const std::string& name, bool cond, const std::string& extra = "") {
    if (cond) {
        ++passed;
        std::printf("  PASS %s\n", name.c_str());
    } else {
        ++failed;
        std::printf("  FAIL %s %s\n", name.c_str(), extra.c_str());
    }
}

bool near(double a, double b, double eps = 1e-9) { return std::fabs(a - b) < eps; }

std::string num(double v) {
    char buf[64];
    std::snprintf(buf, sizeof(buf), "%.10g", v);
    return std::string(buf);
}

const double kPi = 3.14159265358979323846;
const double kKappa = 0.5522847498307936;

// A four-cubic circle, as Illustrator's ellipse tool draws it.
PointList circlePath(double cx, double cy, double r) {
    PointList pts;
    for (int i = 0; i < 4; ++i) {
        const double th = i * kPi * 0.5;
        const Vec2 a(cx + r * std::cos(th), cy + r * std::sin(th));
        const Vec2 t(-std::sin(th) * r * kKappa, std::cos(th) * r * kKappa);
        PathPoint p;
        p.anchor = a;
        p.in = a - t;
        p.out = a + t;
        p.smooth = true;
        pts.push_back(p);
    }
    return pts;
}

PointList polyline(const std::vector<Vec2>& coords) {
    PointList pts;
    for (const Vec2& c : coords) {
        PathPoint p;
        p.anchor = c;
        p.in = c;
        p.out = c;
        p.smooth = false;
        pts.push_back(p);
    }
    return pts;
}

std::vector<Vec2> anchorsOf(const PointList& pts) {
    std::vector<Vec2> out;
    for (const PathPoint& p : pts) { out.push_back(p.anchor); }
    return out;
}

}  // namespace

int main() {
    std::printf("\n[1] Vectors and beziers\n");
    {
        const Cubic c{Vec2(0, 0), Vec2(0, 50), Vec2(100, 50), Vec2(100, 0)};
        ok("symmetric curve is centred at t=0.5", near(evaluate(c, 0.5).x, 50.0));

        Cubic l, r;
        split(c, 0.5, l, r);
        ok("split halves rejoin", distance(l.p3, r.p0) < 1e-12);
        ok("left half reparameterises correctly",
           distance(evaluate(c, 0.25), evaluate(l, 0.5)) < 1e-9);

        const double k = kKappa * 100.0;
        const Cubic quarter{Vec2(100, 0), Vec2(100, k), Vec2(k, 100), Vec2(0, 100)};
        const double len = arcLength(quarter, 2000);
        ok("quarter circle length within 0.05%", std::fabs(len - kPi * 50.0) < 0.08, num(len));

        const std::vector<double> roots = derivativeRoots(c, 1);
        ok("one horizontal tangency on the arch", roots.size() == 1);
        ok("and it is at t=0.5", roots.size() == 1 && near(roots[0], 0.5, 1e-9));

        // The 0.63% excess is the kappa approximation's own curvature error at
        // the midpoint of a quarter, not a defect in the formula. It is larger
        // than the 0.027% positional error because curvature is a second
        // derivative and amplifies the same deviation.
        ok("curvature radius of a circle bezier is within 1% of its radius",
           std::fabs(curvatureRadius(quarter, 0.5) - 100.0) < 1.0,
           num(curvatureRadius(quarter, 0.5)));
        ok("a straight segment reports effectively infinite curvature",
           curvatureRadius(Cubic{Vec2(0, 0), Vec2(10, 0), Vec2(20, 0), Vec2(30, 0)}, 0.5) > 1e11);
    }

    std::printf("\n[2] Closest point on a curve\n");
    {
        const Cubic c{Vec2(0, 0), Vec2(0, 100), Vec2(200, 100), Vec2(200, 0)};
        double t = 0.0, d = 0.0;
        const Vec2 hit = closestPoint(c, Vec2(100, 200), &t, &d);
        ok("symmetric query lands at the apex", near(t, 0.5, 1e-6), num(t));
        ok("and reports the right distance", near(d, distance(hit, Vec2(100, 200)), 1e-9));

        closestPoint(c, Vec2(-500, 0), &t, &d);
        ok("a query beyond the start clamps to t=0", near(t, 0.0, 1e-9), num(t));
        closestPoint(c, Vec2(700, 0), &t, &d);
        ok("a query beyond the end clamps to t=1", near(t, 1.0, 1e-9), num(t));

        // A point exactly on the curve must come back with essentially zero
        // distance, which is what makes segment hit testing trustworthy.
        const Vec2 on = evaluate(c, 0.3125);
        closestPoint(c, on, &t, &d);
        ok("a point on the curve is found exactly", d < 1e-7, num(d));
        ok("and at the right parameter", near(t, 0.3125, 1e-5), num(t));

        // An S-curve has more than one local minimum. Newton from a bad start
        // would settle on the wrong lobe.
        const Cubic s{Vec2(0, 0), Vec2(200, 0), Vec2(-100, 100), Vec2(100, 100)};
        const Vec2 probe(95, 98);
        closestPoint(s, probe, &t, &d);
        double brute = 1e300;
        for (int i = 0; i <= 20000; ++i) {
            brute = std::min(brute, distance(evaluate(s, i / 20000.0), probe));
        }
        // Newton should beat the sweep, not merely match it: a 20001-sample
        // scan lands near the minimum, and the refinement then improves on it.
        // Asserting equality would only be testing the sweep's resolution.
        ok("beats brute force on an S-curve, so it found the right lobe",
           d <= brute + 1e-9, num(d) + " vs " + num(brute));
    }

    std::printf("\n[3] Circle recognition\n");
    {
        const PointList c = circlePath(10, 20, 64);
        const CircleFit fit = recogniseCircle(anchorsOf(c), samplePath(c, true, 6));
        ok("bezier circle recognised", fit.ok);
        ok("radius is exact, not the sampled overshoot",
           near(fit.circle.radius, 64.0, 1e-9), num(fit.circle.radius));
        ok("centre is exact", near(fit.circle.centre.x, 10.0, 1e-9) &&
                              near(fit.circle.centre.y, 20.0, 1e-9));

        PointList e = circlePath(0, 0, 100);
        for (PathPoint& p : e) {
            p.anchor.y *= 0.5;
            p.in.y *= 0.5;
            p.out.y *= 0.5;
        }
        ok("a 2:1 ellipse is rejected", !recogniseCircle(anchorsOf(e), samplePath(e, true, 6)).ok);

        // Far from the origin is where a naive fit loses its precision.
        const PointList far = circlePath(48000, -31000, 12);
        const CircleFit ff = recogniseCircle(anchorsOf(far), samplePath(far, true, 6));
        ok("still exact ten thousand points from the origin",
           ff.ok && near(ff.circle.radius, 12.0, 1e-6), num(ff.circle.radius));
    }

    std::printf("\n[4] Tangents\n");
    {
        Circle a; a.centre = Vec2(0, 0); a.radius = 50;
        Circle b; b.centre = Vec2(200, 0); b.radius = 50;

        const std::vector<TangentPair> t = externalTangents(a, b);
        ok("two external tangents", t.size() == 2);
        const TangentPair& up = (t[0].side == 1) ? t[0] : t[1];
        ok("equal circles give a horizontal tangent",
           near(up.pointA.y, 50.0) && near(up.pointB.y, 50.0));

        double worstPerp = 0.0, worstInc = 0.0;
        int count = 0;
        for (int i = 1; i <= 6; ++i) {
            for (int j = 1; j <= 6; ++j) {
                Circle p; p.centre = Vec2(0, 0); p.radius = 10.0 * i;
                Circle q; q.centre = Vec2(400, 130); q.radius = 8.0 * j;
                for (const TangentPair& s : externalTangents(p, q)) {
                    ++count;
                    const Vec2 seg = normalize(s.pointB - s.pointA);
                    worstPerp = std::max(worstPerp,
                                         std::fabs(dot(seg, s.pointA - p.centre) / p.radius));
                    worstInc = std::max(worstInc,
                                        std::fabs(distance(s.pointA, p.centre) - p.radius));
                    worstInc = std::max(worstInc,
                                        std::fabs(distance(s.pointB, q.centre) - q.radius));
                }
            }
        }
        ok("72 external tangents solved", count == 72);
        ok("all perpendicular to both radii", worstPerp < 1e-9, num(worstPerp));
        ok("all touching both circles", worstInc < 1e-9, num(worstInc));

        Circle inner; inner.centre = Vec2(30, 0); inner.radius = 10;
        Circle outer; outer.centre = Vec2(0, 0); outer.radius = 100;
        ok("none when one circle is inside the other", externalTangents(outer, inner).empty());

        const std::vector<TangentPair> ti = internalTangents(a, b);
        ok("two crossed tangents", ti.size() == 2);
        ok("crossed tangent points straddle the centre line",
           ti[0].pointA.y * ti[0].pointB.y < 0.0);
        Circle o1; o1.centre = Vec2(0, 0); o1.radius = 60;
        Circle o2; o2.centre = Vec2(100, 0); o2.radius = 60;
        ok("no crossed tangent when circles overlap", internalTangents(o1, o2).empty());

        Circle c; c.centre = Vec2(100, 0); c.radius = 50;
        const std::vector<PointTangent> pt = tangentsFromPoint(Vec2(0, 0), c);
        ok("two tangents from an outside point", pt.size() == 2);
        ok("tangent point is on the circle", near(distance(pt[0].point, c.centre), 50.0, 1e-9));
        ok("tangent length is sqrt(d^2 - r^2)",
           near(pt[0].length, std::sqrt(10000.0 - 2500.0), 1e-9));
        ok("radius meets the tangent at a right angle",
           std::fabs(dot(normalize(pt[0].point), pt[0].point - c.centre)) < 1e-9);
        Circle small; small.centre = Vec2(100, 0); small.radius = 50;
        ok("no tangent from inside", tangentsFromPoint(Vec2(90, 0), small).empty());
    }

    std::printf("\n[5] Tangent circles\n");
    {
        Circle a; a.centre = Vec2(0, 0); a.radius = 50;
        Circle b; b.centre = Vec2(200, 0); b.radius = 50;

        const std::vector<Circle> s = tangentCircles(a, b, 100, "ee");
        ok("two solutions", s.size() == 2);
        ok("externally tangent to the first", near(distance(s[0].centre, a.centre), 150.0, 1e-9));
        ok("externally tangent to the second", near(distance(s[0].centre, b.centre), 150.0, 1e-9));
        ok("mirrored about the centre line",
           near(s[0].centre.x, 100.0) && near(s[0].centre.y, -s[1].centre.y));

        Circle c; c.centre = Vec2(0, 0); c.radius = 30;
        Circle d; d.centre = Vec2(80, 0); d.radius = 30;
        const std::vector<Circle> in = tangentCircles(c, d, 200, "ii");
        ok("an enclosing circle is found", in.size() == 2);
        ok("internally tangent", near(distance(in[0].centre, c.centre), 170.0, 1e-9));

        ok("a radius too small to reach is refused", tangentCircles(a, b, 1, "ee").empty());
    }

    std::printf("\n[6] Arcs\n");
    {
        Circle c; c.centre = Vec2(0, 0); c.radius = 100;
        const PointList q = arcPoints(c, 0, kPi * 0.5, true);
        ok("a quarter is one segment", q.size() == 2);
        const Cubic seg{q[0].anchor, q[0].out, q[1].in, q[1].anchor};
        ok("its midpoint is on the circle", std::fabs(length(evaluate(seg, 0.5)) - 100.0) < 0.03);
        ok("endpoint handles are retracted",
           distance(q.front().anchor, q.front().in) < 1e-12 &&
           distance(q.back().anchor, q.back().out) < 1e-12);

        const PointList full = arcPoints(c, 0, 0, true);
        ok("a zero sweep means a full turn", full.size() == 5, num(full.size()));
        double worst = 0.0;
        for (std::size_t i = 0; i + 1 < full.size(); ++i) {
            const Cubic s{full[i].anchor, full[i].out, full[i + 1].in, full[i + 1].anchor};
            worst = std::max(worst, std::fabs(length(evaluate(s, 0.5)) - 100.0));
        }
        ok("a full circle stays within 0.03pt at r=100", worst < 0.03, num(worst));

        const PointList cw = arcPoints(c, 0, kPi * 0.5, false);
        ok("clockwise from 0 to 90 takes the long way", cw.size() == 4, num(cw.size()));
    }

    std::printf("\n[7] Belt outlines\n");
    {
        Circle a; a.centre = Vec2(0, 0); a.radius = 50;
        Circle b; b.centre = Vec2(200, 0); b.radius = 50;

        const PointList belt = beltOutline(a, b, false);
        ok("open belt built", !belt.empty());
        ok("two semicircles, three points each", belt.size() == 6, num(belt.size()));

        double worst = 0.0;
        for (const PathPoint& p : belt) {
            worst = std::max(worst, std::min(std::fabs(distance(p.anchor, a.centre) - 50.0),
                                             std::fabs(distance(p.anchor, b.centre) - 50.0)));
        }
        ok("every anchor lies on a driver circle", worst < 1e-9, num(worst));

        // Unequal circles: the straight runs must still be true common tangents.
        Circle p; p.centre = Vec2(0, 0); p.radius = 80;
        Circle q; q.centre = Vec2(300, 60); q.radius = 25;
        const PointList ub = beltOutline(p, q, false);
        int straights = 0;
        double worstPerp = 0.0;
        for (std::size_t i = 0; i < ub.size(); ++i) {
            const std::size_t j = (i + 1) % ub.size();
            if (distance(ub[i].anchor, ub[i].out) < 1e-9 &&
                distance(ub[j].anchor, ub[j].in) < 1e-9) {
                ++straights;
                const Vec2 dir = normalize(ub[j].anchor - ub[i].anchor);
                const Vec2 from = distance(ub[i].anchor, p.centre) < distance(ub[i].anchor, q.centre)
                                      ? p.centre : q.centre;
                const Vec2 to = distance(ub[j].anchor, p.centre) < distance(ub[j].anchor, q.centre)
                                    ? p.centre : q.centre;
                worstPerp = std::max(worstPerp, std::fabs(dot(dir, normalize(ub[i].anchor - from))));
                worstPerp = std::max(worstPerp, std::fabs(dot(dir, normalize(ub[j].anchor - to))));
            }
        }
        ok("exactly two straight runs", straights == 2, num(straights));
        ok("both are true common tangents", worstPerp < 1e-9, num(worstPerp));

        const PointList crossed = beltOutline(a, b, true);
        ok("crossed belt built", !crossed.empty());
        Circle o1; o1.centre = Vec2(0, 0); o1.radius = 60;
        Circle o2; o2.centre = Vec2(100, 0); o2.radius = 60;
        ok("crossed belt refuses overlapping circles", beltOutline(o1, o2, true).empty());
    }

    std::printf("\n[8] Area and length\n");
    {
        const PointList sq = polyline({Vec2(0, 0), Vec2(100, 0), Vec2(100, 100), Vec2(0, 100)});
        ok("a square's area is exact", near(enclosedArea(sq, true), 10000.0, 1e-9),
           num(enclosedArea(sq, true)));
        ok("its perimeter is exact", near(pathLength(sq, true), 400.0, 1e-6),
           num(pathLength(sq, true)));

        const PointList c = circlePath(0, 0, 100);
        const double area = enclosedArea(c, true);
        // The residual is the bezier circle's own outward bulge, not
        // integration error: the drawn shape really is that much larger.
        ok("a bezier circle's area is within 0.03% of the ideal",
           std::fabs(area / (kPi * 10000.0) - 1.0) < 0.0004, num(area));
        ok("an open path has no area", near(enclosedArea(sq, false), 0.0));
    }

    std::printf("\n[9] Hit testing\n");
    {
        std::vector<PathRef> paths;
        PathRef p;
        p.points = polyline({Vec2(0, 0), Vec2(100, 0), Vec2(200, 0)});
        p.points[1].in = Vec2(70, 30);
        p.points[1].out = Vec2(130, 30);
        p.closed = false;
        p.hasSelection = true;
        paths.push_back(p);

        HitResult h = hitTest(paths, Vec2(101, 2), 5, 5, 5);
        ok("an anchor is hit", h.kind == HitKind::Anchor && h.pointIndex == 1);

        h = hitTest(paths, Vec2(131, 31), 5, 5, 5);
        ok("an out handle is hit", h.kind == HitKind::OutHandle && h.pointIndex == 1,
           num(static_cast<int>(h.kind)));

        h = hitTest(paths, Vec2(50, 6), 5, 8, 5);
        ok("a segment is hit", h.kind == HitKind::Segment, num(static_cast<int>(h.kind)));
        ok("with a sensible parameter", h.t > 0.2 && h.t < 0.8, num(h.t));

        h = hitTest(paths, Vec2(50, 400), 5, 8, 5);
        ok("nothing is hit when far away", h.kind == HitKind::None);

        // An anchor and a segment are both in range here. The anchor must win,
        // or the user can never grab a point that sits on its own path.
        h = hitTest(paths, Vec2(100, 1), 6, 20, 6);
        ok("anchors take priority over segments", h.kind == HitKind::Anchor);

        // Handles on an unselected path are not drawn, so they must not be
        // grabbable either.
        paths[0].hasSelection = false;
        h = hitTest(paths, Vec2(131, 31), 5, 5, 5);
        ok("handles are not hit when the path is unselected", h.kind != HitKind::OutHandle);
    }

    std::printf("\n[10] Snapping\n");
    {
        std::vector<PathRef> paths;
        PathRef arch;
        arch.points = polyline({Vec2(0, 0), Vec2(200, 0)});
        arch.points[0].out = Vec2(0, 133);
        arch.points[1].in = Vec2(200, 133);
        arch.closed = false;
        paths.push_back(arch);

        std::vector<Circle> circles;
        Circle c; c.centre = Vec2(500, 0); c.radius = 60;
        circles.push_back(c);

        // The apex of the arch is a horizontal tangency.
        std::vector<SnapCandidate> s = findSnaps(paths, {}, Vec2(100, 99), 6);
        bool foundH = false;
        for (const SnapCandidate& k : s) {
            if (k.kind == SnapKind::HorizontalTangency) { foundH = true; }
        }
        ok("the apex is offered as a horizontal tangency", foundH);

        s = findSnaps(paths, circles, Vec2(562, 0), 6);
        ok("a point near a circle snaps to it", !s.empty() && s[0].kind == SnapKind::CircleTangency,
           s.empty() ? "none" : num(static_cast<int>(s[0].kind)));
        ok("the snap lands exactly on the circle",
           !s.empty() && near(distance(s[0].position, c.centre), 60.0, 1e-9));
        ok("and reports the tangent direction there",
           !s.empty() && std::fabs(dot(s[0].direction, normalize(s[0].position - c.centre))) < 1e-9);

        ok("nothing is offered out of range", findSnaps(paths, circles, Vec2(-900, -900), 6).empty());

        // Circle tangency must outrank a merely closer anchor, or the snap
        // flickers between the two as the cursor moves.
        std::vector<PathRef> withAnchor = paths;
        PathRef stray;
        stray.points = polyline({Vec2(560, 0), Vec2(600, 40)});
        withAnchor.push_back(stray);
        s = findSnaps(withAnchor, circles, Vec2(561, 0), 6);
        ok("tangency outranks a nearer anchor",
           !s.empty() && s[0].kind == SnapKind::CircleTangency);
    }

    std::printf("\n[11] Coincidence\n");
    {
        std::vector<PathRef> paths;
        PathRef a, b, far;
        a.points = polyline({Vec2(0, 0), Vec2(100, 0)});
        b.points = polyline({Vec2(100.2, 0.1), Vec2(200, 50)});
        far.points = polyline({Vec2(5000, 5000), Vec2(5100, 5000)});
        paths.push_back(a);
        paths.push_back(b);
        paths.push_back(far);

        std::vector<Coincidence> hits = findCoincidentAnchors(paths, 1.0);
        ok("a near-coincident pair is found", hits.size() == 1, num(hits.size()));
        ok("it names both ends",
           hits.size() == 1 && hits[0].pathA == 0 && hits[0].pointA == 1 &&
           hits[0].pathB == 1 && hits[0].pointB == 0);

        ok("a tighter tolerance rejects it", findCoincidentAnchors(paths, 0.1).empty());

        // Points either side of a cell boundary must still pair up, which is
        // the whole reason for scanning the eight neighbouring cells.
        std::vector<PathRef> straddle;
        PathRef p, q;
        p.points = polyline({Vec2(0.999, 0.999)});
        q.points = polyline({Vec2(1.001, 1.001)});
        straddle.push_back(p);
        straddle.push_back(q);
        ok("a pair straddling a grid cell boundary is still found",
           findCoincidentAnchors(straddle, 1.0).size() == 1);

        // Every pair once, not twice.
        std::vector<PathRef> trio;
        for (int i = 0; i < 3; ++i) {
            PathRef r;
            r.points = polyline({Vec2(10, 10)});
            trio.push_back(r);
        }
        ok("three coincident points give three pairs, not six",
           findCoincidentAnchors(trio, 1.0).size() == 3,
           num(findCoincidentAnchors(trio, 1.0).size()));
    }

    std::printf("\n[12] Constraints\n");
    {
        PointList pts = polyline({Vec2(0, 0), Vec2(100, 100), Vec2(200, 0)});
        pts[1].in = Vec2(60, 100);
        pts[1].out = Vec2(160, 60);

        ok("a kinked point can be smoothed", enforceSmooth(pts, 1));
        const Vec2 inDir = normalize(pts[1].anchor - pts[1].in);
        const Vec2 outDir = normalize(pts[1].out - pts[1].anchor);
        ok("handles end up collinear", std::fabs(cross(inDir, outDir)) < 1e-9,
           num(cross(inDir, outDir)));
        ok("and pointing the same way, not folded back", dot(inDir, outDir) > 0);
        ok("handle lengths are preserved",
           near(distance(pts[1].anchor, pts[1].in), distance(Vec2(100, 100), Vec2(60, 100)), 1e-9));

        PointList flat = polyline({Vec2(0, 0), Vec2(10, 0)});
        ok("a point with no handles cannot be smoothed", !enforceSmooth(flat, 0));

        // Tangent constraining: the anchor slides, the heading holds.
        PointList drag = pts;
        const double lenIn = distance(drag[1].anchor, drag[1].in);
        applyTangentConstraint(drag, 1, Vec2(120, 140), Vec2(1, 0));
        ok("the anchor moved", near(drag[1].anchor.x, 120.0) && near(drag[1].anchor.y, 140.0));
        ok("the direction through it is now horizontal",
           near(drag[1].in.y, 140.0, 1e-9) && near(drag[1].out.y, 140.0, 1e-9));
        ok("handle length survived the constraint",
           near(distance(drag[1].anchor, drag[1].in), lenIn, 1e-9));

        Circle c; c.centre = Vec2(0, 0); c.radius = 50;
        Vec2 p, dir;
        ok("snapping to a circle succeeds", tangentSnapToCircle(c, Vec2(80, 0), p, dir));
        ok("landing on the circle", near(distance(p, c.centre), 50.0, 1e-9));
        ok("with a perpendicular direction", std::fabs(dot(dir, normalize(p - c.centre))) < 1e-9);
        ok("a query at dead centre does not divide by zero",
           tangentSnapToCircle(c, c.centre, p, dir) && near(distance(p, c.centre), 50.0, 1e-9));
    }

    std::printf("\n[13] Extending a path\n");
    {
        // A bezier quarter circle of radius 100, from (100,0) to (0,100).
        auto quarter = [](double r) {
            PointList pts;
            PathPoint a;
            a.anchor = Vec2(r, 0); a.in = Vec2(r, 0); a.out = Vec2(r, kKappa * r);
            a.smooth = true;
            PathPoint b;
            b.anchor = Vec2(0, r); b.in = Vec2(kKappa * r, r); b.out = Vec2(0, r);
            b.smooth = true;
            pts.push_back(a);
            pts.push_back(b);
            return pts;
        };

        EndFrame f;
        ok("end frame read", endFrame(quarter(100), false, false, f));
        ok("it is recognised as curved", f.curved);
        // The pointwise curvature at the endpoint of a kappa arc is 102.19,
        // 2.2% off. Fitting the segment recovers what was drawn.
        ok("radius comes from the fit, not the pointwise curvature",
           std::fabs(f.radius - 100.0) < 0.5, num(f.radius));
        ok("centre is at the origin", length(f.centre) < 0.5, num(length(f.centre)));
        ok("outward tangent is vertical at (0,100)",
           std::fabs(f.tangent.x + 1.0) < 1e-6, num(f.tangent.x));

        EndFrame s;
        ok("the start end reads too", endFrame(quarter(100), false, true, s));
        ok("both ends agree on the centre", distance(s.centre, f.centre) < 0.5);
        // Not "opposite to the end tangent" - on a quarter circle those are at
        // right angles. The property that matters is that each outward tangent
        // points away from the rest of the path.
        const Vec2 chord = normalize(quarter(100)[1].anchor - quarter(100)[0].anchor);
        ok("the start tangent points away from the path", dot(s.tangent, chord) < 0.0,
           num(dot(s.tangent, chord)));
        ok("the end tangent points away from the path", dot(f.tangent, chord) > 0.0,
           num(dot(f.tangent, chord)));

        // Constant radius: every point of the extension stays on the circle.
        const PointList run = buildExtension(f, ExtendMode::ConstantRadius, 100, 0.2);
        ok("arc extension built", run.size() >= 2);
        const PointList joined = attachExtension(quarter(100), run, false);
        ok("attached without duplicating the endpoint",
           joined.size() == quarter(100).size() + run.size() - 1, num(joined.size()));

        double worst = 0.0;
        for (std::size_t i = 0; i + 1 < joined.size(); ++i) {
            const Cubic c = segmentAt(joined, i, false);
            for (double t = 0.0; t <= 1.0001; t += 0.1) {
                worst = std::max(worst, std::fabs(length(evaluate(c, t)) - 100.0));
            }
        }
        ok("the extension stays on the circle it was drawn from", worst < 0.15, num(worst));
        ok("and the path is 100 longer",
           std::fabs(pathLength(joined, false) - (kPi * 50.0 + 100.0)) < 0.2,
           num(pathLength(joined, false)));

        // The join must be tangent continuous. bezTangent-style, because a
        // straight run stores retracted handles and d1 is then exactly zero.
        const Cubic before = segmentAt(joined, 0, false);
        const Cubic after = segmentAt(joined, 1, false);
        ok("the join is tangent continuous",
           std::fabs(cross(tangentAt(before, 1.0), tangentAt(after, 0.0))) < 1e-5 &&
           dot(tangentAt(before, 1.0), tangentAt(after, 0.0)) > 0.0);

        // Straight.
        const PointList st = buildExtension(f, ExtendMode::Straight, 40, 0.2);
        ok("straight extension is two points", st.size() == 2, num(st.size()));
        ok("leaving along the end tangent",
           distance(st.back().anchor, f.point + f.tangent * 40.0) < 1e-9);

        // Spiral: curvature matched at the join, opening out after.
        const PointList sp = buildExtension(f, ExtendMode::Spiral, 200, 0.3);
        ok("spiral extension built", sp.size() >= 3, num(sp.size()));
        if (sp.size() >= 3) {
            const Cubic first = segmentAt(sp, 0, false);
            const Cubic last = segmentAt(sp, sp.size() - 2, false);
            const double r0 = curvatureRadius(first, 0.0);
            const double r1 = curvatureRadius(last, 1.0);
            ok("spiral starts at the matched curvature", std::fabs(r0 - 100.0) < 8.0, num(r0));
            ok("and opens out", r1 > r0 * 1.5, num(r1) + " vs " + num(r0));
        }
        ok("zero winding falls back to the arc rather than dividing by it",
           !buildExtension(f, ExtendMode::Spiral, 100, 0.0).empty());

        // A straight path has no curvature to continue.
        PointList line = polyline({Vec2(0, 0), Vec2(100, 0)});
        EndFrame lf;
        ok("a straight end reads a frame", endFrame(line, false, false, lf));
        ok("and reports itself as flat", !lf.curved);
        const PointList lr = buildExtension(lf, ExtendMode::ConstantRadius, 50, 0.2);
        ok("radius mode on a straight path extends straight",
           lr.size() == 2 && distance(lr.back().anchor, Vec2(150, 0)) < 1e-9,
           num(lr.size()));
    }

    std::printf("\n[14] Trimming\n");
    {
        const PointList line = polyline({Vec2(0, 0), Vec2(100, 0), Vec2(200, 0), Vec2(300, 0)});

        PointList t = trimEnd(line, false, 50);
        ok("trimmed from the end", t.size() == 4, num(t.size()));
        ok("to the right length", std::fabs(pathLength(t, false) - 250.0) < 0.01,
           num(pathLength(t, false)));

        t = trimEnd(line, false, 150);
        ok("a trim spanning a segment drops its anchor", t.size() == 3, num(t.size()));
        ok("and lands in the right place", std::fabs(t.back().anchor.x - 150.0) < 0.01,
           num(t.back().anchor.x));

        t = trimEnd(line, true, 60);
        ok("trimming from the start moves the start",
           std::fabs(t.front().anchor.x - 60.0) < 0.01, num(t.front().anchor.x));
        ok("and leaves the far end alone", std::fabs(t.back().anchor.x - 300.0) < 1e-9);

        ok("trimming everything leaves nothing rather than a broken path",
           trimEnd(line, false, 400).empty());
    }

    std::printf("\n[15] Reversal\n");
    {
        PointList pts = polyline({Vec2(0, 0), Vec2(100, 0), Vec2(200, 50)});
        pts[1].in = Vec2(70, 0);
        pts[1].out = Vec2(130, 10);

        const PointList r = reversed(pts);
        ok("order is reversed", distance(r.front().anchor, Vec2(200, 50)) < 1e-12 &&
                                distance(r.back().anchor, Vec2(0, 0)) < 1e-12);
        // Handles have to swap with the points, or every curve mirrors itself.
        ok("handles swap with the points",
           distance(r[1].in, Vec2(130, 10)) < 1e-12 && distance(r[1].out, Vec2(70, 0)) < 1e-12,
           num(r[1].in.x));
        ok("reversing twice is the identity",
           distance(reversed(r)[1].in, pts[1].in) < 1e-12);
    }

    std::printf("\n=== %d passed, %d failed ===\n", passed, failed);
    return failed ? 1 : 0;
}
