/*
 * Chisel: tangency engine
 *
 * Everything here is pure construction: given circles, produce the exact
 * tangent geometry between them. Nothing in this file touches metadata or
 * decides when to re-solve; chisel-constraints.jsx owns that.
 *
 * The circles are never assumed to be Chisel objects. A circle is recognised
 * by fitting one to whatever path you selected, so an ellipse drawn years ago
 * with the plain ellipse tool is a valid input. Geometry is the source of
 * truth, always: if a stored radius and the actual path disagree, the path
 * wins. That is what makes a constraint survive being scaled with the
 * selection tool, which is how people actually resize things.
 *
 * Depends on: chisel.jsx, chisel-meta.jsx
 */

var TAN = {};

TAN.CIRCLE_TOL = 0.004;   // max radial deviation, as a fraction of radius
TAN.EPS = 1e-9;

//= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =
// 1. Angles
//= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =

var TAU = Math.PI * 2;

function normAng(a) {
    a = a % TAU;
    if (a < 0) { a += TAU; }
    return a;
}

function dirAt(a) { return [Math.cos(a), Math.sin(a)]; }

/*
 * True when sweeping from a0 to a1 in the given direction passes through x.
 * Used to choose which of the two possible arcs between two tangent points is
 * the one that belongs to the outline.
 */
function arcContains(a0, a1, x, ccw) {
    var span, off;
    if (ccw) {
        span = normAng(a1 - a0);
        off = normAng(x - a0);
    } else {
        span = normAng(a0 - a1);
        off = normAng(a0 - x);
    }
    if (span < TAN.EPS) { span = TAU; }
    return off <= span + TAN.EPS;
}

//= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =
// 2. Circle recognition
//= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =

/* Sample points along a path, four per segment plus the final anchor. */
function samplePath(pts, closed, per) {
    var out = [], i, j, s, n = segCount(pts, closed);
    if (!per) { per = 4; }
    for (i = 0; i < n; i++) {
        s = segOf(pts, i, closed);
        if (!s) { continue; }
        for (j = 0; j < per; j++) {
            out.push(bezAt(s[0], s[1], s[2], s[3], j / per));
        }
    }
    if (!closed && pts.length) { out.push([pts[pts.length - 1].a[0], pts[pts.length - 1].a[1]]); }
    return out;
}

/*
 * Kasa algebraic circle fit. Minimises the algebraic residual rather than the
 * true geometric distance, which for a full closed loop of well spread samples
 * is indistinguishable from the geometric fit and needs no iteration. Points
 * are centred on their mean first, because the raw normal equations are badly
 * conditioned for artwork sitting far from the origin, and Illustrator
 * coordinates routinely are.
 */
function fitCircle(samples) {
    var n = samples.length, i, mx = 0, my = 0;
    if (n < 3) { return null; }
    for (i = 0; i < n; i++) { mx += samples[i][0]; my += samples[i][1]; }
    mx /= n; my /= n;

    var Suu = 0, Suv = 0, Svv = 0, Suuu = 0, Svvv = 0, Suvv = 0, Svuu = 0, u, v;
    for (i = 0; i < n; i++) {
        u = samples[i][0] - mx;
        v = samples[i][1] - my;
        Suu += u * u;
        Suv += u * v;
        Svv += v * v;
        Suuu += u * u * u;
        Svvv += v * v * v;
        Suvv += u * v * v;
        Svuu += v * u * u;
    }
    var det = Suu * Svv - Suv * Suv;
    if (Math.abs(det) < TAN.EPS) { return null; }

    var b1 = (Suuu + Suvv) / 2;
    var b2 = (Svvv + Svuu) / 2;
    var uc = (b1 * Svv - b2 * Suv) / det;
    var vc = (b2 * Suu - b1 * Suv) / det;
    var rsq = uc * uc + vc * vc + (Suu + Svv) / n;
    if (rsq <= 0) { return null; }

    var c = [uc + mx, vc + my];
    var r = Math.sqrt(rsq);

    var worst = 0, dev;
    for (i = 0; i < n; i++) {
        dev = Math.abs(vDist(samples[i], c) - r);
        if (dev > worst) { worst = dev; }
    }
    return { c: c, r: r, dev: worst, rel: (r > TAN.EPS ? worst / r : 1e9) };
}

/*
 * Recognise a PathItem as a circle. Returns {c,r,rel,ok} so callers can decide
 * whether to insist on a true circle or accept a best-fit; the tangent
 * constructions themselves only need a centre and a radius.
 */
function circleOfPath(path) {
    var pts, fit, i, anchors, dense, dev, worst;
    try { pts = readPath(path); } catch (e) { return null; }
    if (!pts || pts.length < 2) { return null; }

    /*
     * Fit the anchors, not the sampled curve. Illustrator's own circles are
     * four cubics whose anchors sit exactly on the true circle while the curve
     * between them bulges out by about 0.027% of the radius. Fitting samples
     * therefore returns a radius a shade too large, and every tangent built
     * from it inherits that error. Fitting anchors returns the exact radius,
     * and the dense samples are then used only to prove it really is a circle.
     */
    anchors = [];
    for (i = 0; i < pts.length; i++) { anchors.push(pts[i].a); }
    fit = (anchors.length >= 3) ? fitCircle(anchors) : null;
    if (!fit) { fit = fitCircle(samplePath(pts, path.closed, 6)); }
    if (!fit) { return null; }

    dense = samplePath(pts, path.closed, 6);
    worst = 0;
    for (i = 0; i < dense.length; i++) {
        dev = Math.abs(vDist(dense[i], fit.c) - fit.r);
        if (dev > worst) { worst = dev; }
    }
    fit.dev = worst;
    fit.rel = (fit.r > TAN.EPS) ? worst / fit.r : 1e9;
    fit.ok = (fit.rel <= TAN.CIRCLE_TOL) && path.closed;
    return fit;
}

//= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =
// 3. Tangent solvers
//= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =

/*
 * External (open belt) tangents. Both radius vectors point the same way, so a
 * single unit direction u describes the pair of tangent points:
 *
 *     P1 = c1 + r1*u,  P2 = c2 + r2*u
 *
 * Perpendicularity of the connecting line to u reduces to u . (c2-c1) = r1-r2,
 * which is one cosine and therefore two solutions, mirrored about the centre
 * line. They exist whenever one circle is not strictly inside the other.
 *
 * Returns [{u, p1, p2, side}] with side +1 and -1 naming the two solutions
 * consistently, so a stored choice still means the same side after the circles
 * move.
 */
function tangentsExternal(c1, r1, c2, r2) {
    var dv = vSub(c2, c1), d = vLen(dv);
    if (d < TAN.EPS) { return []; }
    var q = (r1 - r2) / d;
    if (q > 1 || q < -1) { return []; }
    var base = Math.atan2(dv[1], dv[0]);
    var alpha = Math.acos(q);
    var out = [], k, ang, u;
    for (k = 0; k < 2; k++) {
        ang = base + (k === 0 ? alpha : -alpha);
        u = dirAt(ang);
        out.push({
            u: u,
            ang: ang,
            side: (k === 0 ? 1 : -1),
            p1: vAdd(c1, vMul(u, r1)),
            p2: vAdd(c2, vMul(u, r2))
        });
    }
    return out;
}

/*
 * Internal (crossed belt) tangents: the line passes between the circles, so
 * the radius vectors oppose. u . (c2-c1) = r1+r2, requiring the circles to be
 * clear of each other.
 */
function tangentsInternal(c1, r1, c2, r2) {
    var dv = vSub(c2, c1), d = vLen(dv);
    if (d < TAN.EPS) { return []; }
    var q = (r1 + r2) / d;
    if (q > 1) { return []; }              // circles overlap: no crossed tangent
    var base = Math.atan2(dv[1], dv[0]);
    var alpha = Math.acos(q);
    var out = [], k, ang, u;
    for (k = 0; k < 2; k++) {
        ang = base + (k === 0 ? alpha : -alpha);
        u = dirAt(ang);
        out.push({
            u: u,
            ang: ang,
            side: (k === 0 ? 1 : -1),
            p1: vAdd(c1, vMul(u, r1)),
            p2: vSub(c2, vMul(u, r2))
        });
    }
    return out;
}

/*
 * Tangent points on a circle from an external point. The point, the centre and
 * the tangent point form a right angle at the tangent point, so the half angle
 * at p is asin(r/d) and the tangent length is sqrt(d^2 - r^2).
 */
function tangentsFromPoint(p, c, r) {
    var dv = vSub(c, p), d = vLen(dv);
    if (d <= r + TAN.EPS) { return []; }
    var base = Math.atan2(dv[1], dv[0]);
    var alpha = Math.asin(r / d);
    var len = Math.sqrt(d * d - r * r);
    var out = [], k, ang;
    for (k = 0; k < 2; k++) {
        ang = base + (k === 0 ? alpha : -alpha);
        out.push({
            side: (k === 0 ? 1 : -1),
            p: vAdd(p, vMul(dirAt(ang), len)),
            len: len
        });
    }
    return out;
}

/* The two intersection points of two circles, or [] when they do not meet. */
function circleIntersect(c1, R1, c2, R2) {
    var dv = vSub(c2, c1), d = vLen(dv);
    if (d < TAN.EPS) { return []; }
    if (d > R1 + R2 + 1e-7) { return []; }
    if (d < Math.abs(R1 - R2) - 1e-7) { return []; }
    var a = (R1 * R1 - R2 * R2 + d * d) / (2 * d);
    var hsq = R1 * R1 - a * a;
    if (hsq < 0) { hsq = 0; }
    var h = Math.sqrt(hsq);
    var base = vAdd(c1, vMul(dv, a / d));
    var perp = [-dv[1] / d, dv[0] / d];
    return [vAdd(base, vMul(perp, h)), vSub(base, vMul(perp, h))];
}

/*
 * A circle of the given radius tangent to two others. Each circle contributes
 * a locus for the new centre that is itself a circle, so the whole problem is
 * one circle-circle intersection:
 *
 *   externally tangent  ->  |X - ci| = ri + r
 *   internally tangent  ->  |X - ci| = |r - ri|   (the new circle wraps it)
 *
 * mode is two characters, one per driver: "ee", "ii", "ei", "ie".
 */
function tangentCircle(c1, r1, c2, r2, r, mode) {
    if (!mode) { mode = "ee"; }
    var R1 = (mode.charAt(0) === "i") ? Math.abs(r - r1) : (r1 + r);
    var R2 = (mode.charAt(1) === "i") ? Math.abs(r - r2) : (r2 + r);
    var hits = circleIntersect(c1, R1, c2, R2), out = [], i;
    for (i = 0; i < hits.length; i++) {
        out.push({ c: hits[i], r: r });
    }
    return out;
}

//= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =
// 4. Arcs as beziers
//= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =

/*
 * Exact-as-cubics-allow circular arc. Split at 90 degrees or finer, with the
 * standard handle constant k = 4/3 * tan(sweep/4), which makes the curve touch
 * the true circle at both ends and at the midpoint. Error peaks around
 * 2.7e-4 of the radius per quarter, well under a device pixel at any sane zoom.
 *
 * Endpoints come back with retracted handles on their outward side, because an
 * arc is nearly always stitched to a straight tangent line there. Callers that
 * want a smooth join overwrite them.
 */
function arcPoints(c, r, a0, a1, ccw) {
    var sweep = ccw ? normAng(a1 - a0) : -normAng(a0 - a1);
    if (Math.abs(sweep) < 1e-12) { sweep = ccw ? TAU : -TAU; }

    var n = Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9);
    if (n < 1) { n = 1; }
    var step = sweep / n;
    var k = (4 / 3) * Math.tan(step / 4);

    var pts = [], i, th, p, tv;
    for (i = 0; i <= n; i++) {
        th = a0 + step * i;
        p = [c[0] + r * Math.cos(th), c[1] + r * Math.sin(th)];
        tv = [-Math.sin(th) * r * k, Math.cos(th) * r * k];
        pts.push({
            a: [p[0], p[1]],
            l: [p[0] - tv[0], p[1] - tv[1]],
            r: [p[0] + tv[0], p[1] + tv[1]],
            t: "s",
            sel: false
        });
    }
    pts[0].l = [pts[0].a[0], pts[0].a[1]];
    pts[0].t = "c";
    pts[n].r = [pts[n].a[0], pts[n].a[1]];
    pts[n].t = "c";
    return pts;
}

/* The arc from a0 to a1 that passes through `via`, direction chosen for you. */
function arcThrough(c, r, a0, a1, via) {
    var ccw = arcContains(a0, a1, via, true);
    return arcPoints(c, r, a0, a1, ccw);
}

/* A straight two-point run, handles retracted. */
function linePoints(p, q) {
    return [
        { a: [p[0], p[1]], l: [p[0], p[1]], r: [p[0], p[1]], t: "c", sel: false },
        { a: [q[0], q[1]], l: [q[0], q[1]], r: [q[0], q[1]], t: "c", sel: false }
    ];
}

//= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =
// 5. Composite outlines
//= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =

/*
 * The belt: one closed outline wrapping both circles, joined by their common
 * tangents. This is the shape people mean by "connect two circles at their
 * tangents" - a pulley, a capsule, a link in a chain - and getting it by hand
 * means drawing tangent lines, trimming arcs, and joining, every time either
 * circle moves.
 *
 * Open belt uses the external tangents and wraps the far side of each circle.
 * Crossed belt uses the internal ones; the tangent points on the second circle
 * sit half a turn round, and the same "wrap the far side" rule then produces
 * the figure eight.
 *
 * Returns a point array ready for writePath, closed.
 */
function beltOutline(c1, r1, c2, r2, crossed) {
    var t = crossed ? tangentsInternal(c1, r1, c2, r2)
                    : tangentsExternal(c1, r1, c2, r2);
    if (t.length < 2) { return null; }

    var dv = vSub(c2, c1);
    var base = Math.atan2(dv[1], dv[0]);   // c1 -> c2
    var flip = crossed ? Math.PI : 0;

    // Angles of the tangent points, measured at their own circle's centre.
    var a1A = t[0].ang, a1B = t[1].ang;                  // on circle 1
    var a2A = t[0].ang + flip, a2B = t[1].ang + flip;    // on circle 2

    // Wrap the side of each circle facing away from the other.
    var arc2 = arcThrough(c2, r2, a2A, a2B, base);
    var arc1 = arcThrough(c1, r1, a1B, a1A, base + Math.PI);

    var pts = [], i;
    for (i = 0; i < arc2.length; i++) { pts.push(arc2[i]); }
    for (i = 0; i < arc1.length; i++) { pts.push(arc1[i]); }
    return pts;
}

/*
 * The tangent line alone, as an open two-point path. side picks which of the
 * pair; +1 and -1 keep meaning the same side as the circles move, which is the
 * whole point of storing it rather than re-picking the nearest one each solve.
 */
function tangentSegment(c1, r1, c2, r2, crossed, side) {
    var t = crossed ? tangentsInternal(c1, r1, c2, r2)
                    : tangentsExternal(c1, r1, c2, r2);
    var i;
    for (i = 0; i < t.length; i++) {
        if (t[i].side === side) { return linePoints(t[i].p1, t[i].p2); }
    }
    return null;
}

//= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =
// 6. Document helpers
//= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =

/*
 * New path in the same container as its driver, so a constraint built inside a
 * group stays inside that group and moves with it.
 */
function newPathBeside(sibling, pts, closed) {
    var parent = sibling ? sibling.parent : app.activeDocument;
    var p = parent.pathItems.add();
    // add() seeds a default point on some builds; writePath clears the block.
    writePath(p, pts, closed);
    return p;
}

/*
 * Borrow the driver's stroke so generated geometry does not arrive in whatever
 * the last-used appearance happened to be. Fill is left off for open runs and
 * copied for closed outlines, which is what the shape is usually for.
 */
function styleFrom(target, src, wantFill) {
    try {
        target.stroked = src.stroked;
        if (src.stroked) {
            target.strokeColor = src.strokeColor;
            target.strokeWidth = src.strokeWidth;
        }
    } catch (e) {}
    try {
        if (wantFill && src.filled) {
            target.filled = true;
            target.fillColor = src.fillColor;
        } else {
            target.filled = false;
        }
    } catch (e2) {}
}

/*
 * Read the two driver circles for a command. Accepts any two selected closed
 * paths that fit a circle; reports precisely which one failed, because "select
 * two circles" is useless feedback when you believe you did.
 */
function twoCircles() {
    var paths = selectedPaths();
    if (paths.length !== 2) {
        return { err: "Select exactly two circles. Found " + paths.length + " path" + (paths.length === 1 ? "" : "s") + "." };
    }
    var a = circleOfPath(paths[0]), b = circleOfPath(paths[1]);
    if (!a || !a.ok) { return { err: "The first path is not a circle (deviation " + (a ? Math.round(a.rel * 1000) / 10 : "?") + "% of radius)." }; }
    if (!b || !b.ok) { return { err: "The second path is not a circle (deviation " + (b ? Math.round(b.rel * 1000) / 10 : "?") + "% of radius)." }; }
    return { pathA: paths[0], pathB: paths[1], A: a, B: b };
}
