/*
 * Chisel: precision path tools for Adobe Illustrator
 * ExtendScript geometry engine. Target: Illustrator 29 (2025) and above.
 *
 * ExtendScript is roughly ES3. No let, const, arrow functions, Array.map,
 * JSON, or trailing commas. Everything below stays inside that dialect.
 *
 * Entry point: chiselRun(command, argLiteral)
 *   argLiteral is a JS object literal as a string, e.g. "{tol:10,mode:'equal'}"
 */

//= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =
// 0. Small utilities
//= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =

var CH = {};
CH.EPS = 1e-9;
CH.VERSION = "1.0.0";

function chNum(v, d) { return (typeof v === "number" && !isNaN(v)) ? v : d; }
function chStr(v, d) { return (typeof v === "string") ? v : d; }
function chBool(v, d) { return (typeof v === "boolean") ? v : d; }

function vSub(a, b) { return [a[0] - b[0], a[1] - b[1]]; }
function vAdd(a, b) { return [a[0] + b[0], a[1] + b[1]]; }
function vMul(a, s) { return [a[0] * s, a[1] * s]; }
function vDot(a, b) { return a[0] * b[0] + a[1] * b[1]; }
function vCross(a, b) { return a[0] * b[1] - a[1] * b[0]; }
function vLen(a) { return Math.sqrt(a[0] * a[0] + a[1] * a[1]); }
function vDist(a, b) { return vLen(vSub(a, b)); }
function vNorm(a) {
    var l = vLen(a);
    if (l < CH.EPS) { return [0, 0]; }
    return [a[0] / l, a[1] / l];
}
function vRot(a, ang) {
    var c = Math.cos(ang), s = Math.sin(ang);
    return [a[0] * c - a[1] * s, a[0] * s + a[1] * c];
}
function vAng(a) { return Math.atan2(a[1], a[0]); }
function deg(r) { return r * 180 / Math.PI; }
function rad(d) { return d * Math.PI / 180; }

function gcdInt(a, b) {
    a = Math.abs(Math.round(a)); b = Math.abs(Math.round(b));
    while (b) { var t = b; b = a % b; a = t; }
    return a || 1;
}

//= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =
// 1. Cubic bezier mathematics
//= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =

// Evaluate cubic bezier at t
function bezAt(p0, p1, p2, p3, t) {
    var mt = 1 - t;
    var a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, d = t * t * t;
    return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
            a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
}

// First derivative
function bezD1(p0, p1, p2, p3, t) {
    var mt = 1 - t;
    var x = 3 * mt * mt * (p1[0] - p0[0]) + 6 * mt * t * (p2[0] - p1[0]) + 3 * t * t * (p3[0] - p2[0]);
    var y = 3 * mt * mt * (p1[1] - p0[1]) + 6 * mt * t * (p2[1] - p1[1]) + 3 * t * t * (p3[1] - p2[1]);
    return [x, y];
}

// Second derivative
function bezD2(p0, p1, p2, p3, t) {
    var mt = 1 - t;
    var x = 6 * mt * (p2[0] - 2 * p1[0] + p0[0]) + 6 * t * (p3[0] - 2 * p2[0] + p1[0]);
    var y = 6 * mt * (p2[1] - 2 * p1[1] + p0[1]) + 6 * t * (p3[1] - 2 * p2[1] + p1[1]);
    return [x, y];
}

// Unit tangent, with degenerate-handle fallback
function bezTangent(p0, p1, p2, p3, t) {
    var d = bezD1(p0, p1, p2, p3, t);
    if (vLen(d) > CH.EPS) { return vNorm(d); }
    d = bezD2(p0, p1, p2, p3, t);
    if (vLen(d) > CH.EPS) { return vNorm(d); }
    return vNorm(vSub(p3, p0));
}

// Radius of curvature at t (Infinity when straight)
function bezCurvatureRadius(p0, p1, p2, p3, t) {
    var d1 = bezD1(p0, p1, p2, p3, t);
    var d2 = bezD2(p0, p1, p2, p3, t);
    var num = Math.pow(vLen(d1), 3);
    var den = Math.abs(vCross(d1, d2));
    if (den < CH.EPS) { return Infinity; }
    return num / den;
}

// de Casteljau split. Returns {left:[4 pts], right:[4 pts]}
function bezSplit(p0, p1, p2, p3, t) {
    var p01 = vAdd(vMul(p0, 1 - t), vMul(p1, t));
    var p12 = vAdd(vMul(p1, 1 - t), vMul(p2, t));
    var p23 = vAdd(vMul(p2, 1 - t), vMul(p3, t));
    var p012 = vAdd(vMul(p01, 1 - t), vMul(p12, t));
    var p123 = vAdd(vMul(p12, 1 - t), vMul(p23, t));
    var mid = vAdd(vMul(p012, 1 - t), vMul(p123, t));
    return { left: [p0, p01, p012, mid], right: [mid, p123, p23, p3] };
}

// Extract sub-curve between t0 and t1
function bezSub(p0, p1, p2, p3, t0, t1) {
    var r = bezSplit(p0, p1, p2, p3, t0).right;
    var u = (t1 - t0) / (1 - t0);
    if (!isFinite(u)) { u = 0; }
    return bezSplit(r[0], r[1], r[2], r[3], u).left;
}

// Arc length via adaptive sampling (fast and sufficient for editor work)
function bezLength(p0, p1, p2, p3, steps) {
    steps = steps || 64;
    var len = 0, prev = p0, i, cur;
    for (i = 1; i <= steps; i++) {
        cur = bezAt(p0, p1, p2, p3, i / steps);
        len += vDist(prev, cur);
        prev = cur;
    }
    return len;
}

// Build cumulative arc-length table, then invert: t for a given arc distance
function bezTableForLength(p0, p1, p2, p3, steps) {
    steps = steps || 100;
    var tbl = [0], prev = p0, i, cur, acc = 0;
    for (i = 1; i <= steps; i++) {
        cur = bezAt(p0, p1, p2, p3, i / steps);
        acc += vDist(prev, cur);
        tbl.push(acc);
        prev = cur;
    }
    return tbl;
}

function bezTAtLength(tbl, s) {
    var steps = tbl.length - 1;
    var total = tbl[steps];
    if (total < CH.EPS) { return 0; }
    if (s <= 0) { return 0; }
    if (s >= total) { return 1; }
    var lo = 0, hi = steps, mid;
    while (hi - lo > 1) {
        mid = Math.floor((lo + hi) / 2);
        if (tbl[mid] < s) { lo = mid; } else { hi = mid; }
    }
    var span = tbl[hi] - tbl[lo];
    var frac = span < CH.EPS ? 0 : (s - tbl[lo]) / span;
    return (lo + frac) / steps;
}

// Roots of the derivative component. axis 0 = x' (vertical tangency),
// axis 1 = y' (horizontal tangency). Returns t values strictly inside (0,1).
function bezDerivRoots(p0, p1, p2, p3, axis) {
    var c0 = p1[axis] - p0[axis];
    var c1 = p2[axis] - p1[axis];
    var c2 = p3[axis] - p2[axis];
    var a = c0 - 2 * c1 + c2;
    var b = 2 * (c1 - c0);
    var c = c0;
    var out = [], t;
    if (Math.abs(a) < 1e-12) {
        if (Math.abs(b) > 1e-12) {
            t = -c / b;
            if (t > 1e-6 && t < 1 - 1e-6) { out.push(t); }
        }
        return out;
    }
    var disc = b * b - 4 * a * c;
    if (disc < 0) { return out; }
    var sq = Math.sqrt(disc);
    var t1 = (-b + sq) / (2 * a);
    var t2 = (-b - sq) / (2 * a);
    if (t1 > 1e-6 && t1 < 1 - 1e-6) { out.push(t1); }
    if (t2 > 1e-6 && t2 < 1 - 1e-6) { out.push(t2); }
    out.sort(function (x, y) { return x - y; });
    return out;
}

function bezBBox(p0, p1, p2, p3) {
    var xs = [p0[0], p3[0]], ys = [p0[1], p3[1]], i, r, pt;
    r = bezDerivRoots(p0, p1, p2, p3, 0);
    for (i = 0; i < r.length; i++) { pt = bezAt(p0, p1, p2, p3, r[i]); xs.push(pt[0]); }
    r = bezDerivRoots(p0, p1, p2, p3, 1);
    for (i = 0; i < r.length; i++) { pt = bezAt(p0, p1, p2, p3, r[i]); ys.push(pt[1]); }
    var minx = xs[0], maxx = xs[0], miny = ys[0], maxy = ys[0];
    for (i = 1; i < xs.length; i++) { if (xs[i] < minx) minx = xs[i]; if (xs[i] > maxx) maxx = xs[i]; }
    for (i = 1; i < ys.length; i++) { if (ys[i] < miny) miny = ys[i]; if (ys[i] > maxy) maxy = ys[i]; }
    return [minx, miny, maxx, maxy];
}

function bboxOverlap(a, b, pad) {
    pad = pad || 0;
    return !(a[2] + pad < b[0] || b[2] + pad < a[0] || a[3] + pad < b[1] || b[3] + pad < a[1]);
}

/*
 * Bezier-bezier intersection by recursive subdivision on bounding boxes.
 * Returns array of {t1, t2}. Tolerance in document points.
 */
function bezIntersect(A, B, tol) {
    tol = tol || 0.01;
    var out = [];
    var stack = [{ a: A, b: B, t1a: 0, t1b: 1, t2a: 0, t2b: 1, depth: 0 }];
    var guard = 0;
    while (stack.length && guard < 20000) {
        guard++;
        var it = stack.pop();
        var ba = bezBBox(it.a[0], it.a[1], it.a[2], it.a[3]);
        var bb = bezBBox(it.b[0], it.b[1], it.b[2], it.b[3]);
        if (!bboxOverlap(ba, bb, tol)) { continue; }
        var sizeA = Math.max(ba[2] - ba[0], ba[3] - ba[1]);
        var sizeB = Math.max(bb[2] - bb[0], bb[3] - bb[1]);
        if ((sizeA < tol && sizeB < tol) || it.depth > 30) {
            out.push({ t1: (it.t1a + it.t1b) / 2, t2: (it.t2a + it.t2b) / 2 });
            continue;
        }
        var sa = bezSplit(it.a[0], it.a[1], it.a[2], it.a[3], 0.5);
        var sb = bezSplit(it.b[0], it.b[1], it.b[2], it.b[3], 0.5);
        var m1 = (it.t1a + it.t1b) / 2, m2 = (it.t2a + it.t2b) / 2;
        stack.push({ a: sa.left, b: sb.left, t1a: it.t1a, t1b: m1, t2a: it.t2a, t2b: m2, depth: it.depth + 1 });
        stack.push({ a: sa.left, b: sb.right, t1a: it.t1a, t1b: m1, t2a: m2, t2b: it.t2b, depth: it.depth + 1 });
        stack.push({ a: sa.right, b: sb.left, t1a: m1, t1b: it.t1b, t2a: it.t2a, t2b: m2, depth: it.depth + 1 });
        stack.push({ a: sa.right, b: sb.right, t1a: m1, t1b: it.t1b, t2a: m2, t2b: it.t2b, depth: it.depth + 1 });
    }
    // Merge clusters that converged onto the same crossing
    var merged = [], i, j, keep;
    for (i = 0; i < out.length; i++) {
        keep = true;
        for (j = 0; j < merged.length; j++) {
            if (Math.abs(merged[j].t1 - out[i].t1) < 1e-3 && Math.abs(merged[j].t2 - out[i].t2) < 1e-3) {
                keep = false; break;
            }
        }
        if (keep) { merged.push(out[i]); }
    }
    return merged;
}

//= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =
// 2. Path data model
//    A point is {a:[x,y], l:[x,y], r:[x,y], t:"c"|"s", sel:bool}
//    l = leftDirection (the "in" handle), r = rightDirection (the "out" handle)
//= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =

function readPath(path) {
    var pts = [], i, pp;
    for (i = 0; i < path.pathPoints.length; i++) {
        pp = path.pathPoints[i];
        pts.push({
            a: [pp.anchor[0], pp.anchor[1]],
            l: [pp.leftDirection[0], pp.leftDirection[1]],
            r: [pp.rightDirection[0], pp.rightDirection[1]],
            t: (pp.pointType === PointType.SMOOTH) ? "s" : "c",
            sel: (pp.selected === PathPointSelection.ANCHORPOINT ||
                  pp.selected === PathPointSelection.LEFTRIGHTPOINT ||
                  pp.selected === PathPointSelection.LEFTDIRECTION ||
                  pp.selected === PathPointSelection.RIGHTDIRECTION)
        });
    }
    return pts;
}

/*
 * Rewrite a PathItem from a point array.
 * Illustrator cannot insert a pathPoint at an index, so the reliable idiom is
 * to append all new points, then delete the original block from the tail.
 */
function writePath(path, pts, closed) {
    if (pts.length < 2) { return false; }
    var oldCount = path.pathPoints.length;
    var i, np;
    for (i = 0; i < pts.length; i++) {
        np = path.pathPoints.add();
        np.anchor = pts[i].a;
        np.leftDirection = pts[i].l;
        np.rightDirection = pts[i].r;
        np.pointType = (pts[i].t === "s") ? PointType.SMOOTH : PointType.CORNER;
    }
    for (i = oldCount - 1; i >= 0; i--) { path.pathPoints[i].remove(); }
    if (typeof closed === "boolean") { path.closed = closed; }
    return true;
}

function mkPt(a, l, r, type) {
    return { a: [a[0], a[1]], l: [l[0], l[1]], r: [r[0], r[1]], t: type || "c", sel: false };
}

// Segment i of a point array: from pts[i] to pts[i+1] (wrapping when closed)
function segOf(pts, i, closed) {
    var n = pts.length;
    var j = (i + 1) % n;
    if (!closed && i === n - 1) { return null; }
    return [pts[i].a, pts[i].r, pts[j].l, pts[j].a];
}

function segCount(pts, closed) {
    return closed ? pts.length : pts.length - 1;
}

function isStraightSeg(s) {
    return vDist(s[0], s[1]) < 1e-6 && vDist(s[3], s[2]) < 1e-6;
}

//= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =
// 3. Selection collection
//= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =

function collectPaths(item, out) {
    var i;
    if (!item) { return; }
    if (item.typename === "PathItem") {
        if (!item.guides && !item.locked && !item.hidden) { out.push(item); }
    } else if (item.typename === "CompoundPathItem") {
        for (i = 0; i < item.pathItems.length; i++) { collectPaths(item.pathItems[i], out); }
    } else if (item.typename === "GroupItem") {
        for (i = 0; i < item.pageItems.length; i++) { collectPaths(item.pageItems[i], out); }
    }
}

function selectedPaths() {
    var doc = app.activeDocument;
    var sel = doc.selection;
    var out = [], i;
    if (!sel || sel.length === 0) { return out; }
    for (i = 0; i < sel.length; i++) { collectPaths(sel[i], out); }
    return out;
}

function countSelectedPoints(pts) {
    var n = 0, i;
    for (i = 0; i < pts.length; i++) { if (pts[i].sel) { n++; } }
    return n;
}

function anySelectedPoints(paths) {
    var i, pts;
    for (i = 0; i < paths.length; i++) {
        pts = readPath(paths[i]);
        if (countSelectedPoints(pts) > 0) { return true; }
    }
    return false;
}

//= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =
// 4. Handle generation and point-type operations
//= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =

/*
 * Chisel smoothing algorithm, matching the behaviour designers expect:
 *  - if one handle exists, mirror it
 *  - if neither exists, bisect the prev/this/next angle, take the perpendicular,
 *    and set length = min(dPrev, dNext) * ratio
 */
function smoothPoint(pts, i, closed, ratio) {
    var n = pts.length;
    var p = pts[i];
    var hasL = vDist(p.l, p.a) > 1e-6;
    var hasR = vDist(p.r, p.a) > 1e-6;

    if (hasL && hasR) {
        // Align: swing both handles apart equally until 180 degrees opposed
        var aL = vAng(vSub(p.l, p.a));
        var aR = vAng(vSub(p.r, p.a));
        var target = aR + Math.PI;
        var diff = Math.atan2(Math.sin(aL - target), Math.cos(aL - target));
        var half = diff / 2;
        var lenL = vDist(p.l, p.a), lenR = vDist(p.r, p.a);
        var newAL = aL - half;
        var newAR = newAL + Math.PI;
        p.l = vAdd(p.a, [Math.cos(newAL) * lenL, Math.sin(newAL) * lenL]);
        p.r = vAdd(p.a, [Math.cos(newAR) * lenR, Math.sin(newAR) * lenR]);
        p.t = "s";
        return;
    }
    if (hasL || hasR) {
        var src = hasL ? p.l : p.r;
        var v = vSub(src, p.a);
        var mirror = vSub(p.a, v);
        if (hasL) { p.r = mirror; } else { p.l = mirror; }
        p.t = "s";
        return;
    }

    var prev = (i > 0) ? pts[i - 1] : (closed ? pts[n - 1] : null);
    var next = (i < n - 1) ? pts[i + 1] : (closed ? pts[0] : null);
    if (!prev && !next) { return; }
    if (!prev) { prev = next; }
    if (!next) { next = prev; }

    var vp = vSub(prev.a, p.a);
    var vn = vSub(next.a, p.a);
    var dp = vLen(vp), dn = vLen(vn);
    if (dp < CH.EPS || dn < CH.EPS) { return; }

    // Bisector of the corner, then its perpendicular is the smooth direction
    var bis = vNorm(vAdd(vNorm(vp), vNorm(vn)));
    var dir;
    if (vLen(bis) < 1e-6) {
        dir = vNorm(vn); // collinear
    } else {
        dir = [-bis[1], bis[0]];
        // Point the "out" direction toward the next point
        if (vDot(dir, vNorm(vn)) < 0) { dir = vMul(dir, -1); }
    }
    var len = Math.min(dp, dn) * ratio;
    p.r = vAdd(p.a, vMul(dir, len));
    p.l = vSub(p.a, vMul(dir, len));
    p.t = "s";
}

function retractPoint(p) { p.l = [p.a[0], p.a[1]]; p.r = [p.a[0], p.a[1]]; }

function equalizeHandles(p) {
    var hasL = vDist(p.l, p.a) > 1e-6;
    var hasR = vDist(p.r, p.a) > 1e-6;
    if (hasL && hasR) {
        var avg = (vDist(p.l, p.a) + vDist(p.r, p.a)) / 2;
        p.l = vAdd(p.a, vMul(vNorm(vSub(p.l, p.a)), avg));
        p.r = vAdd(p.a, vMul(vNorm(vSub(p.r, p.a)), avg));
    } else if (hasL) {
        p.r = vSub(p.a, vSub(p.l, p.a));
    } else if (hasR) {
        p.l = vSub(p.a, vSub(p.r, p.a));
    }
}

//= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =
// 5. Smart point removal
//    Remove P between A and B, then solve for the two adjacent handle LENGTHS
//    (angles held fixed) that minimise squared deviation from the original
//    two-segment composite curve. This is the least-squares core of the whole
//    plugin, and it is what makes removal "smart" rather than destructive.
//= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =

function fitRemoval(A, P, B, samples) {
    samples = samples || 24;

    var seg1 = [A.a, A.r, P.l, P.a];
    var seg2 = [P.a, P.r, B.l, B.a];

    var l1 = bezLength(seg1[0], seg1[1], seg1[2], seg1[3], 32);
    var l2 = bezLength(seg2[0], seg2[1], seg2[2], seg2[3], 32);
    var total = l1 + l2;
    if (total < CH.EPS) { return null; }

    // Sample the original composite curve, parameterised by arc length
    var Q = [], U = [], i, s, t, pt;
    for (i = 0; i <= samples; i++) {
        s = total * i / samples;
        if (s <= l1) {
            t = (l1 < CH.EPS) ? 0 : s / l1;
            pt = bezAt(seg1[0], seg1[1], seg1[2], seg1[3], t);
        } else {
            t = (l2 < CH.EPS) ? 1 : (s - l1) / l2;
            pt = bezAt(seg2[0], seg2[1], seg2[2], seg2[3], t);
        }
        Q.push(pt);
        U.push(s / total);
    }

    // Fixed tangent directions, taken from the surviving outer handles
    var dA = vSub(A.r, A.a);
    if (vLen(dA) < 1e-6) { dA = vSub(P.a, A.a); }
    dA = vNorm(dA);
    var dB = vSub(B.l, B.a);
    if (vLen(dB) < 1e-6) { dB = vSub(P.a, B.a); }
    dB = vNorm(dB);

    // Normal equations for [La, Lb]
    var c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
    var u, mt, b0, b1, b2, b3, A1, A2, base, R;
    for (i = 0; i <= samples; i++) {
        u = U[i]; mt = 1 - u;
        b0 = mt * mt * mt;
        b1 = 3 * mt * mt * u;
        b2 = 3 * mt * u * u;
        b3 = u * u * u;
        A1 = vMul(dA, b1);
        A2 = vMul(dB, b2);
        base = vAdd(vMul(A.a, b0 + b1), vMul(B.a, b2 + b3));
        R = vSub(Q[i], base);
        c00 += vDot(A1, A1);
        c01 += vDot(A1, A2);
        c11 += vDot(A2, A2);
        x0 += vDot(A1, R);
        x1 += vDot(A2, R);
    }

    var det = c00 * c11 - c01 * c01;
    var La, Lb;
    if (Math.abs(det) < 1e-12) {
        // Degenerate: fall back to the classic one-third chord heuristic
        var chord = vDist(A.a, B.a);
        La = chord / 3; Lb = chord / 3;
    } else {
        La = (x0 * c11 - x1 * c01) / det;
        Lb = (c00 * x1 - c01 * x0) / det;
    }
    if (La < 0) { La = 0; }
    if (Lb < 0) { Lb = 0; }

    var P1 = vAdd(A.a, vMul(dA, La));
    var P2 = vAdd(B.a, vMul(dB, Lb));

    // Maximum deviation of the fitted curve from the sampled original
    var maxErr = 0, fitPt, d;
    for (i = 0; i <= samples; i++) {
        fitPt = bezAt(A.a, P1, P2, B.a, U[i]);
        d = vDist(fitPt, Q[i]);
        if (d > maxErr) { maxErr = d; }
    }

    return { P1: P1, P2: P2, err: maxErr };
}

/*
 * Greedy iterative removal. Each pass finds the candidate whose removal costs
 * the least deviation, removes it if under tolerance, and repeats.
 * onlySelected restricts candidates to selected anchors.
 */
function smartRemove(pts, closed, maxErr, onlySelected, smart) {
    var removed = 0;
    var guard = 0;
    while (guard++ < 5000) {
        var n = pts.length;
        var minPts = closed ? 3 : 3;
        if (n <= minPts) { break; }

        var best = -1, bestFit = null, bestErr = Infinity;
        var i, iPrev, iNext, fit;
        for (i = 0; i < n; i++) {
            if (!closed && (i === 0 || i === n - 1)) { continue; }
            if (onlySelected && !pts[i].sel) { continue; }
            iPrev = (i - 1 + n) % n;
            iNext = (i + 1) % n;
            if (!smart) { best = i; bestFit = null; bestErr = 0; break; }
            fit = fitRemoval(pts[iPrev], pts[i], pts[iNext], 20);
            if (!fit) { continue; }
            if (fit.err < bestErr) { bestErr = fit.err; best = i; bestFit = fit; }
        }

        if (best < 0) { break; }
        if (smart && bestErr > maxErr) { break; }

        var pv = (best - 1 + pts.length) % pts.length;
        var nx = (best + 1) % pts.length;
        if (smart && bestFit) {
            pts[pv].r = bestFit.P1;
            pts[nx].l = bestFit.P2;
            if (vDist(pts[pv].r, pts[pv].a) > 1e-6 && vDist(pts[pv].l, pts[pv].a) > 1e-6) {
                // leave point type as-is; the fit preserved the outgoing angle
            }
        }
        pts.splice(best, 1);
        removed++;
        if (!smart && onlySelected) {
            // dumb mode removes every selected point in one sweep
            continue;
        }
    }
    return removed;
}

//= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =
// 6. Corner construction (three types x three methods)
//= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =

/*
 * Trim distance from the corner along each leg, and the handle scale used to
 * shape the connecting curve, per method.
 *
 *  trueRadius : circular arc, d = r / tan(theta/2), kappa = 4/3 * tan(theta/4)
 *  standard   : mimics Illustrator's native Round Corners, fixed d = r,
 *               circular kappa 0.5523 regardless of angle (non-constant radius)
 *  squircular : longer trim with softer handles, approximating a superellipse
 *               blend, the continuous-curvature look popularised by Apple
 */
function cornerGeometry(theta, r, method) {
    var half = theta / 2;
    var tanHalf = Math.tan(half);
    var d, k;
    if (method === "standard") {
        d = r;
        k = 0.5522847498 * r;
    } else if (method === "squircular") {
        d = (Math.abs(tanHalf) < 1e-6) ? r : (r / tanHalf) * 1.45;
        k = d * 0.76;
    } else { // trueRadius
        d = (Math.abs(tanHalf) < 1e-6) ? r : (r / tanHalf);
        k = (4 / 3) * Math.tan((Math.PI - theta) / 4) * r;
        if (!isFinite(k) || k < 0) { k = 0.5522847498 * r; }
    }
    return { d: d, k: k };
}

/*
 * Apply a corner to point index i.
 * Returns an array of replacement points (1 for chamfer, 2 for curved corners),
 * or null when the corner cannot be built.
 */
function buildCorner(pts, i, closed, radius, type, method) {
    var n = pts.length;
    if (!closed && (i === 0 || i === n - 1)) { return null; }
    var iPrev = (i - 1 + n) % n;
    var iNext = (i + 1) % n;

    var P = pts[i], A = pts[iPrev], B = pts[iNext];

    var segIn = [A.a, A.r, P.l, P.a];
    var segOut = [P.a, P.r, B.l, B.a];

    var lenIn = bezLength(segIn[0], segIn[1], segIn[2], segIn[3], 48);
    var lenOut = bezLength(segOut[0], segOut[1], segOut[2], segOut[3], 48);
    if (lenIn < CH.EPS || lenOut < CH.EPS) { return null; }

    // Tangent directions leaving the corner along each leg
    var dirIn = vMul(bezTangent(segIn[0], segIn[1], segIn[2], segIn[3], 1), -1);
    var dirOut = bezTangent(segOut[0], segOut[1], segOut[2], segOut[3], 0);

    var cosT = vDot(dirIn, dirOut);
    if (cosT > 1) { cosT = 1; }
    if (cosT < -1) { cosT = -1; }
    var theta = Math.acos(cosT); // interior angle at the corner
    if (theta > Math.PI - 1e-4) { return null; } // effectively straight

    var geo = cornerGeometry(theta, radius, method);
    var d = geo.d;

    // Never eat more than half of either leg
    var maxD = Math.min(lenIn * 0.5, lenOut * 0.5);
    if (d > maxD) {
        var scale = maxD / d;
        d = maxD;
        geo.k = geo.k * scale;
    }
    if (d < 1e-6) { return null; }

    // Trim points, found by arc length along each leg
    var tblIn = bezTableForLength(segIn[0], segIn[1], segIn[2], segIn[3], 100);
    var tIn = bezTAtLength(tblIn, lenIn - d);
    var tblOut = bezTableForLength(segOut[0], segOut[1], segOut[2], segOut[3], 100);
    var tOut = bezTAtLength(tblOut, d);

    var subIn = bezSub(segIn[0], segIn[1], segIn[2], segIn[3], 0, tIn);
    var subOut = bezSub(segOut[0], segOut[1], segOut[2], segOut[3], tOut, 1);

    var C1 = subIn[3];   // corner start
    var C2 = subOut[0];  // corner end

    // Rewrite the neighbours' inner handles to match the trimmed legs
    A.r = subIn[1];
    B.l = subOut[2];

    var tanIn = vNorm(vSub(C1, subIn[2]));   // direction continuing into the corner
    var tanOut = vNorm(vSub(subOut[1], C2)); // direction leaving the corner

    if (type === "chamfered") {
        var p1 = mkPt(C1, C1, C1, "c");
        var p2 = mkPt(C2, C2, C2, "c");
        p1.l = subIn[2];
        p2.r = subOut[1];
        return [p1, p2];
    }

    var k = geo.k;
    var h1, h2;
    if (type === "negative") {
        // Curve bows the other way: handles point back toward the original apex
        var apex = P.a;
        h1 = vAdd(C1, vMul(vNorm(vSub(apex, C1)), k));
        h2 = vAdd(C2, vMul(vNorm(vSub(apex, C2)), k));
    } else {
        h1 = vAdd(C1, vMul(tanIn, k));
        h2 = vSub(C2, vMul(tanOut, k));
    }

    var q1 = mkPt(C1, subIn[2], h1, "c");
    var q2 = mkPt(C2, h2, subOut[1], "c");
    return [q1, q2];
}

//= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =
// 7. Command implementations
//= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =

var CMD = {};

// ---- Cleanup -------------------------------------------------------------

CMD.smartRemove = function (o) {
    var tol = chNum(o.tol, 10);
    var maxErr = tol * 0.05; // 1..100 maps to 0.05pt .. 5pt of allowed deviation
    var smart = chBool(o.smart, true);
    var paths = selectedPaths();
    if (!paths.length) { return "No paths selected."; }
    var useSelected = anySelectedPoints(paths);
    var total = 0, i, pts, r;
    for (i = 0; i < paths.length; i++) {
        pts = readPath(paths[i]);
        if (pts.length < 3) { continue; }
        r = smartRemove(pts, paths[i].closed, maxErr, useSelected, smart);
        if (r > 0) { writePath(paths[i], pts, paths[i].closed); total += r; }
    }
    return "Removed " + total + " point" + (total === 1 ? "" : "s") +
           (useSelected ? " (selected only)." : ".");
};

CMD.removeRedundant = function () {
    var paths = selectedPaths();
    if (!paths.length) { return "No paths selected."; }
    var total = 0, i, j, pts, n, next, out, dup;
    for (i = 0; i < paths.length; i++) {
        pts = readPath(paths[i]);
        n = pts.length;
        out = [];
        for (j = 0; j < n; j++) {
            next = pts[(j + 1) % n];
            if (!paths[i].closed && j === n - 1) { out.push(pts[j]); break; }
            dup = vDist(pts[j].a, next.a) < 1e-6 &&
                  vDist(pts[j].r, pts[j].a) < 1e-6 &&
                  vDist(next.l, next.a) < 1e-6;
            if (dup) { total++; continue; }
            out.push(pts[j]);
        }
        if (out.length !== n && out.length >= 2) { writePath(paths[i], out, paths[i].closed); }
    }
    return total ? ("Removed " + total + " redundant point" + (total === 1 ? "" : "s") + ".")
                 : "No redundant points found.";
};

CMD.countRedundant = function () {
    var paths = selectedPaths();
    if (!paths.length) { return "0"; }
    var total = 0, i, j, pts, n, next;
    for (i = 0; i < paths.length; i++) {
        pts = readPath(paths[i]); n = pts.length;
        for (j = 0; j < n; j++) {
            if (!paths[i].closed && j === n - 1) { break; }
            next = pts[(j + 1) % n];
            if (vDist(pts[j].a, next.a) < 1e-6 &&
                vDist(pts[j].r, pts[j].a) < 1e-6 &&
                vDist(next.l, next.a) < 1e-6) { total++; }
        }
    }
    return "" + total;
};

// ---- Point type and handles ---------------------------------------------

CMD.makeSmooth = function (o) {
    var ratio = chNum(o.ratio, 0.4);
    var addHandles = chBool(o.addHandles, true);
    var paths = selectedPaths();
    if (!paths.length) { return "No paths selected."; }
    var i, j, pts, touched, any = 0;
    for (i = 0; i < paths.length; i++) {
        pts = readPath(paths[i]);
        touched = false;
        for (j = 0; j < pts.length; j++) {
            if (!pts[j].sel) { continue; }
            if (addHandles) { smoothPoint(pts, j, paths[i].closed, ratio); }
            else { pts[j].t = "s"; }
            touched = true; any++;
        }
        if (touched) { writePath(paths[i], pts, paths[i].closed); }
    }
    return any ? ("Smoothed " + any + " point" + (any === 1 ? "" : "s") + ".") : "Select some anchor points first.";
};

CMD.makeCorner = function () {
    var paths = selectedPaths();
    if (!paths.length) { return "No paths selected."; }
    var i, j, pts, touched, any = 0;
    for (i = 0; i < paths.length; i++) {
        pts = readPath(paths[i]); touched = false;
        for (j = 0; j < pts.length; j++) {
            if (!pts[j].sel) { continue; }
            pts[j].t = "c"; touched = true; any++;
        }
        if (touched) { writePath(paths[i], pts, paths[i].closed); }
    }
    return any ? ("Converted " + any + " point" + (any === 1 ? "" : "s") + " to corner.") : "Select some anchor points first.";
};

CMD.retract = function (o) {
    var swap = chBool(o.swap, false);
    var paths = selectedPaths();
    if (!paths.length) { return "No paths selected."; }
    var i, j, pts, touched, any = 0, tmp;
    for (i = 0; i < paths.length; i++) {
        pts = readPath(paths[i]); touched = false;
        for (j = 0; j < pts.length; j++) {
            if (!pts[j].sel) { continue; }
            if (swap) { tmp = pts[j].l; pts[j].l = pts[j].r; pts[j].r = tmp; }
            else { retractPoint(pts[j]); }
            touched = true; any++;
        }
        if (touched) { writePath(paths[i], pts, paths[i].closed); }
    }
    return any ? ((swap ? "Swapped handles on " : "Retracted handles on ") + any + " point(s).")
               : "Select some anchor points first.";
};

CMD.retractSegments = function () {
    var paths = selectedPaths();
    if (!paths.length) { return "No paths selected."; }
    var i, j, pts, n, closed, touched, any = 0, nx;
    for (i = 0; i < paths.length; i++) {
        pts = readPath(paths[i]); n = pts.length; closed = paths[i].closed; touched = false;
        for (j = 0; j < segCount(pts, closed); j++) {
            nx = (j + 1) % n;
            if (pts[j].sel && pts[nx].sel) {
                pts[j].r = [pts[j].a[0], pts[j].a[1]];
                pts[nx].l = [pts[nx].a[0], pts[nx].a[1]];
                touched = true; any++;
            }
        }
        if (touched) { writePath(paths[i], pts, closed); }
    }
    return any ? ("Straightened " + any + " segment(s).") : "Select both ends of a segment first.";
};

CMD.equalize = function () {
    var paths = selectedPaths();
    if (!paths.length) { return "No paths selected."; }
    var i, j, pts, touched, any = 0;
    for (i = 0; i < paths.length; i++) {
        pts = readPath(paths[i]); touched = false;
        for (j = 0; j < pts.length; j++) {
            if (!pts[j].sel) { continue; }
            equalizeHandles(pts[j]); touched = true; any++;
        }
        if (touched) { writePath(paths[i], pts, paths[i].closed); }
    }
    return any ? ("Equalised handles on " + any + " point(s).") : "Select some anchor points first.";
};

/*
 * Relative and absolute handle transforms, the numeric half of multi-handle
 * editing. mode: scale | rotate | increment | setLength | setAngle
 */
CMD.handleTransform = function (o) {
    var mode = chStr(o.mode, "scale");
    var val = chNum(o.value, 1);
    var which = chStr(o.which, "both"); // both | in | out
    var paths = selectedPaths();
    if (!paths.length) { return "No paths selected."; }

    function apply(p, key) {
        var h = p[key];
        var v = vSub(h, p.a);
        var len = vLen(v);
        if (len < 1e-6 && mode !== "setLength") { return; }
        var ang = vAng(v);
        if (mode === "scale") { len = len * val; }
        else if (mode === "increment") { len = len + val; }
        else if (mode === "setLength") {
            if (len < 1e-6) {
                // create along the chord direction if no handle exists
                ang = vAng(vSub(h, p.a));
                if (isNaN(ang)) { ang = 0; }
            }
            len = val;
        }
        else if (mode === "rotate") { ang = ang + rad(val); }
        else if (mode === "setAngle") { ang = rad(val); }
        if (len < 0) { len = 0; }
        p[key] = vAdd(p.a, [Math.cos(ang) * len, Math.sin(ang) * len]);
    }

    var i, j, pts, touched, any = 0;
    for (i = 0; i < paths.length; i++) {
        pts = readPath(paths[i]); touched = false;
        for (j = 0; j < pts.length; j++) {
            if (!pts[j].sel) { continue; }
            if (which === "both" || which === "in") { apply(pts[j], "l"); }
            if (which === "both" || which === "out") { apply(pts[j], "r"); }
            touched = true; any++;
        }
        if (touched) { writePath(paths[i], pts, paths[i].closed); }
    }
    return any ? ("Adjusted handles on " + any + " point(s).") : "Select some anchor points first.";
};

CMD.averagePoints = function (o) {
    var axis = chStr(o.axis, "both"); // both | x | y
    var paths = selectedPaths();
    if (!paths.length) { return "No paths selected."; }
    var sx = 0, sy = 0, cnt = 0, i, j, pts, all = [];
    for (i = 0; i < paths.length; i++) {
        pts = readPath(paths[i]);
        all.push(pts);
        for (j = 0; j < pts.length; j++) {
            if (!pts[j].sel) { continue; }
            sx += pts[j].a[0]; sy += pts[j].a[1]; cnt++;
        }
    }
    if (cnt < 2) { return "Select at least two anchor points."; }
    var cx = sx / cnt, cy = sy / cnt;
    for (i = 0; i < paths.length; i++) {
        pts = all[i];
        var touched = false;
        for (j = 0; j < pts.length; j++) {
            if (!pts[j].sel) { continue; }
            var nx = (axis === "y") ? pts[j].a[0] : cx;
            var ny = (axis === "x") ? pts[j].a[1] : cy;
            var d = [nx - pts[j].a[0], ny - pts[j].a[1]];
            pts[j].a = [nx, ny];
            pts[j].l = vAdd(pts[j].l, d);
            pts[j].r = vAdd(pts[j].r, d);
            touched = true;
        }
        if (touched) { writePath(paths[i], pts, paths[i].closed); }
    }
    return "Averaged " + cnt + " points.";
};

// ---- Adding points -------------------------------------------------------

CMD.addPoints = function (o) {
    var mode = chStr(o.mode, "equal");   // equal | bezier | distance
    var count = Math.round(chNum(o.count, 1));
    var dist = chNum(o.dist, 20);
    var centre = chBool(o.centre, true);
    var paths = selectedPaths();
    if (!paths.length) { return "No paths selected."; }

    var total = 0, i;
    for (i = 0; i < paths.length; i++) {
        var closed = paths[i].closed;
        var pts = readPath(paths[i]);
        var useSel = countSelectedPoints(pts) > 0;
        var n = pts.length;
        var out = [];
        var k, nx, s, ts, tbl, len, j, t, nSub, offset;

        for (k = 0; k < n; k++) {
            out.push(pts[k]);
            if (!closed && k === n - 1) { break; }
            nx = (k + 1) % n;
            if (useSel && !(pts[k].sel && pts[nx].sel)) { continue; }
            s = [pts[k].a, pts[k].r, pts[nx].l, pts[nx].a];

            ts = [];
            if (mode === "bezier") {
                for (j = 1; j <= count; j++) { ts.push(j / (count + 1)); }
            } else if (mode === "equal") {
                tbl = bezTableForLength(s[0], s[1], s[2], s[3], 100);
                len = tbl[tbl.length - 1];
                for (j = 1; j <= count; j++) { ts.push(bezTAtLength(tbl, len * j / (count + 1))); }
            } else {
                tbl = bezTableForLength(s[0], s[1], s[2], s[3], 100);
                len = tbl[tbl.length - 1];
                if (dist < 0.01 || len < dist) { continue; }
                nSub = Math.floor(len / dist);
                offset = centre ? (len - nSub * dist) / 2 : 0;
                if (centre && offset < 1e-6) { nSub = nSub - 1; offset = dist / 2; }
                for (j = 0; j <= nSub; j++) {
                    var sd = offset + j * dist;
                    if (sd <= 1e-6 || sd >= len - 1e-6) { continue; }
                    ts.push(bezTAtLength(tbl, sd));
                }
            }
            if (!ts.length) { continue; }

            // Split successively, carrying the remainder forward
            var cur = s, prevT = 0, m;
            for (j = 0; j < ts.length; j++) {
                t = (ts[j] - prevT) / (1 - prevT);
                if (!(t > 1e-6 && t < 1 - 1e-6)) { continue; }
                var sp = bezSplit(cur[0], cur[1], cur[2], cur[3], t);
                // fix the outgoing handle of the previous emitted point
                out[out.length - 1].r = sp.left[1];
                m = mkPt(sp.left[3], sp.left[2], sp.right[1], "s");
                m.sel = true;
                out.push(m);
                cur = sp.right;
                prevT = ts[j];
                total++;
            }
            pts[nx].l = cur[2];
        }
        if (total > 0) { writePath(paths[i], out, closed); }
    }
    return total ? ("Added " + total + " point" + (total === 1 ? "" : "s") + ".")
                 : "Nothing to add. Select a path or a pair of adjacent points.";
};

// ---- Tangencies ----------------------------------------------------------

/*
 * Insert anchor points where the path direction is horizontal or vertical,
 * measured relative to the document constrain angle.
 * axis: "both" | "h" | "v".  remove:true deletes originals that become
 * unnecessary, which is the "move points to tangencies" behaviour.
 */
CMD.tangencies = function (o) {
    var axis = chStr(o.axis, "both");
    var doRemove = chBool(o.remove, false);
    var tolPt = chNum(o.tol, 10) * 0.05;
    var ca = 0;
    try { ca = rad(app.preferences.getRealPreference("constrainAngle") || 0); } catch (e) { ca = 0; }

    var paths = selectedPaths();
    if (!paths.length) { return "No paths selected."; }
    var total = 0, i;

    for (i = 0; i < paths.length; i++) {
        var closed = paths[i].closed;
        var pts = readPath(paths[i]);
        var n = pts.length;
        var out = [];
        var k, nx, s, rot, ts, j;

        for (k = 0; k < n; k++) {
            out.push(pts[k]);
            if (!closed && k === n - 1) { break; }
            nx = (k + 1) % n;
            s = [pts[k].a, pts[k].r, pts[nx].l, pts[nx].a];

            // rotate the control polygon into constrain-angle space
            rot = [vRot(s[0], -ca), vRot(s[1], -ca), vRot(s[2], -ca), vRot(s[3], -ca)];
            ts = [];
            if (axis === "both" || axis === "v") {
                ts = ts.concat(bezDerivRoots(rot[0], rot[1], rot[2], rot[3], 0));
            }
            if (axis === "both" || axis === "h") {
                ts = ts.concat(bezDerivRoots(rot[0], rot[1], rot[2], rot[3], 1));
            }
            ts.sort(function (a, b) { return a - b; });

            // dedupe
            var clean = [];
            for (j = 0; j < ts.length; j++) {
                if (!clean.length || Math.abs(clean[clean.length - 1] - ts[j]) > 1e-4) { clean.push(ts[j]); }
            }
            if (!clean.length) { continue; }

            var cur = s, prevT = 0, t, sp, m;
            for (j = 0; j < clean.length; j++) {
                t = (clean[j] - prevT) / (1 - prevT);
                if (!(t > 1e-5 && t < 1 - 1e-5)) { continue; }
                sp = bezSplit(cur[0], cur[1], cur[2], cur[3], t);
                out[out.length - 1].r = sp.left[1];
                m = mkPt(sp.left[3], sp.left[2], sp.right[1], "s");
                m.sel = true;
                out.push(m);
                cur = sp.right;
                prevT = clean[j];
                total++;
            }
            pts[nx].l = cur[2];
        }

        if (total > 0) {
            if (doRemove) {
                // mark the freshly added tangent points, then smart-remove the rest
                var keep = [], q;
                for (q = 0; q < out.length; q++) { keep.push(!!out[q].sel); }
                var g = 0;
                while (g++ < 2000) {
                    var best = -1, bestFit = null, bestErr = Infinity, m2 = out.length;
                    if (m2 <= 3) { break; }
                    var z, pv, nn, fit;
                    for (z = 0; z < m2; z++) {
                        if (keep[z]) { continue; }
                        if (!closed && (z === 0 || z === m2 - 1)) { continue; }
                        pv = (z - 1 + m2) % m2; nn = (z + 1) % m2;
                        fit = fitRemoval(out[pv], out[z], out[nn], 20);
                        if (fit && fit.err < bestErr) { bestErr = fit.err; best = z; bestFit = fit; }
                    }
                    if (best < 0 || bestErr > tolPt) { break; }
                    var pv2 = (best - 1 + out.length) % out.length;
                    var nn2 = (best + 1) % out.length;
                    out[pv2].r = bestFit.P1;
                    out[nn2].l = bestFit.P2;
                    out.splice(best, 1);
                    keep.splice(best, 1);
                }
            }
            writePath(paths[i], out, closed);
        }
    }
    return total ? ("Added " + total + " tangency point" + (total === 1 ? "" : "s") +
                    (doRemove ? ", pruned the rest." : ".")) : "No tangencies found.";
};

// ---- Corners -------------------------------------------------------------

CMD.applyCorners = function (o) {
    var radius = chNum(o.radius, 12);
    var type = chStr(o.type, "regular");     // regular | negative | chamfered
    var method = chStr(o.method, "trueRadius"); // trueRadius | standard | squircular
    var paths = selectedPaths();
    if (!paths.length) { return "No paths selected."; }
    var total = 0, i;

    for (i = 0; i < paths.length; i++) {
        var closed = paths[i].closed;
        var pts = readPath(paths[i]);
        var useSel = countSelectedPoints(pts) > 0;
        var n = pts.length;
        if (n < 3) { continue; }

        // Work on a copy so neighbour handle edits do not cascade unexpectedly
        var targets = [], k;
        for (k = 0; k < n; k++) {
            if (useSel && !pts[k].sel) { continue; }
            if (!closed && (k === 0 || k === n - 1)) { continue; }
            targets.push(k);
        }
        if (!targets.length) { continue; }

        // Build result by walking the original, substituting corner pairs
        var work = [];
        for (k = 0; k < n; k++) { work.push(pts[k]); }

        var replacements = {};
        for (k = 0; k < targets.length; k++) {
            var res = buildCorner(work, targets[k], closed, radius, type, method);
            if (res) { replacements["i" + targets[k]] = res; total++; }
        }

        var out = [];
        for (k = 0; k < n; k++) {
            var rep = replacements["i" + k];
            if (rep) { out.push(rep[0]); out.push(rep[1]); }
            else { out.push(work[k]); }
        }
        if (out.length >= 2) { writePath(paths[i], out, closed); }
    }
    return total ? ("Applied " + type + " / " + method + " corners to " + total + " point(s).")
                 : "No eligible corner points found.";
};

// ---- Path structure ------------------------------------------------------

CMD.closePath = function (o) {
    var mode = chStr(o.mode, "honour"); // honour | straight | smooth
    var ratio = chNum(o.ratio, 0.4);
    var paths = selectedPaths();
    if (!paths.length) { return "No paths selected."; }
    var i, done = 0;
    for (i = 0; i < paths.length; i++) {
        if (paths[i].closed) { continue; }
        var pts = readPath(paths[i]);
        if (pts.length < 3) { continue; }
        var first = pts[0], last = pts[pts.length - 1];
        if (mode === "straight") {
            last.r = [last.a[0], last.a[1]];
            first.l = [first.a[0], first.a[1]];
        } else if (mode === "smooth") {
            var chord = vDist(last.a, first.a);
            var dLast = vSub(last.a, last.l);
            if (vLen(dLast) < 1e-6) { dLast = vSub(first.a, last.a); }
            var dFirst = vSub(first.a, first.r);
            if (vLen(dFirst) < 1e-6) { dFirst = vSub(last.a, first.a); }
            last.r = vAdd(last.a, vMul(vNorm(dLast), chord * ratio));
            first.l = vAdd(first.a, vMul(vNorm(dFirst), chord * ratio));
            last.t = "s"; first.t = "s";
        }
        writePath(paths[i], pts, true);
        done++;
    }
    return done ? ("Closed " + done + " path(s).") : "No open paths in the selection.";
};

CMD.openPath = function () {
    var paths = selectedPaths();
    if (!paths.length) { return "No paths selected."; }
    var i, done = 0;
    for (i = 0; i < paths.length; i++) {
        if (!paths[i].closed) { continue; }
        paths[i].closed = false;
        done++;
    }
    return done ? ("Opened " + done + " path(s).") : "No closed paths in the selection.";
};

CMD.reverse = function () {
    var paths = selectedPaths();
    if (!paths.length) { return "No paths selected."; }
    var i, j, pts, rev;
    for (i = 0; i < paths.length; i++) {
        pts = readPath(paths[i]);
        rev = [];
        for (j = pts.length - 1; j >= 0; j--) {
            rev.push({ a: pts[j].a, l: pts[j].r, r: pts[j].l, t: pts[j].t, sel: pts[j].sel });
        }
        writePath(paths[i], rev, paths[i].closed);
    }
    return "Reversed " + paths.length + " path(s).";
};

CMD.startAtPoint = function () {
    var paths = selectedPaths();
    if (!paths.length) { return "No paths selected."; }
    var i, j, pts, idx, out, done = 0;
    for (i = 0; i < paths.length; i++) {
        if (!paths[i].closed) { continue; }
        pts = readPath(paths[i]);
        idx = -1;
        for (j = 0; j < pts.length; j++) { if (pts[j].sel) { idx = j; break; } }
        if (idx <= 0) { continue; }
        out = [];
        for (j = 0; j < pts.length; j++) { out.push(pts[(idx + j) % pts.length]); }
        writePath(paths[i], out, true);
        done++;
    }
    return done ? ("Renumbered " + done + " path(s).") : "Select one point on a closed path.";
};

CMD.splitAtPoints = function () {
    var paths = selectedPaths();
    if (!paths.length) { return "No paths selected."; }
    var i, j, pts, made = 0;
    for (i = 0; i < paths.length; i++) {
        pts = readPath(paths[i]);
        var idx = [];
        for (j = 0; j < pts.length; j++) { if (pts[j].sel) { idx.push(j); } }
        if (!idx.length) { continue; }
        var closed = paths[i].closed;
        // Rotate closed paths so the first cut becomes the start
        if (closed) {
            var start = idx[0];
            var rot = [];
            for (j = 0; j < pts.length; j++) { rot.push(pts[(start + j) % pts.length]); }
            rot.push({ a: rot[0].a, l: rot[0].l, r: rot[0].r, t: rot[0].t, sel: true });
            pts = rot;
            idx = [];
            for (j = 0; j < pts.length; j++) { if (pts[j].sel) { idx.push(j); } }
        }
        // Build the sub-path spans
        var cuts = [];
        for (j = 0; j < idx.length; j++) {
            if (idx[j] > 0 && idx[j] < pts.length - 1) { cuts.push(idx[j]); }
        }
        if (!cuts.length) { continue; }
        var bounds = [0].concat(cuts).concat([pts.length - 1]);
        var b;
        for (b = 0; b < bounds.length - 1; b++) {
            var slice = pts.slice(bounds[b], bounds[b + 1] + 1);
            if (slice.length < 2) { continue; }
            var np = paths[i].parent.pathItems.add();
            np.stroked = paths[i].stroked;
            np.filled = false;
            try { np.strokeWidth = paths[i].strokeWidth; np.strokeColor = paths[i].strokeColor; } catch (e) {}
            writePath(np, slice, false);
            np.pathPoints[0].remove(); // remove the placeholder created by add()
            made++;
        }
        paths[i].remove();
    }
    return made ? ("Split into " + made + " path(s).") : "Select interior points to split at.";
};

CMD.connectSmooth = function (o) {
    var ratio = chNum(o.ratio, 0.4);
    var paths = selectedPaths();
    if (paths.length !== 2) { return "Select exactly two open paths."; }
    if (paths[0].closed || paths[1].closed) { return "Both paths must be open."; }

    var A = readPath(paths[0]), B = readPath(paths[1]);
    // Choose the closest pair of endpoints
    var ends = [
        { ai: A.length - 1, bi: 0, revA: false, revB: false },
        { ai: A.length - 1, bi: B.length - 1, revA: false, revB: true },
        { ai: 0, bi: 0, revA: true, revB: false },
        { ai: 0, bi: B.length - 1, revA: true, revB: true }
    ];
    var best = ends[0], bestD = Infinity, i, d;
    for (i = 0; i < ends.length; i++) {
        d = vDist(A[ends[i].ai].a, B[ends[i].bi].a);
        if (d < bestD) { bestD = d; best = ends[i]; }
    }
    function revArr(arr) {
        var out = [], j;
        for (j = arr.length - 1; j >= 0; j--) { out.push({ a: arr[j].a, l: arr[j].r, r: arr[j].l, t: arr[j].t, sel: false }); }
        return out;
    }
    if (best.revA) { A = revArr(A); }
    if (best.revB) { B = revArr(B); }

    var last = A[A.length - 1], first = B[0];
    var chord = vDist(last.a, first.a);
    var dLast = vSub(last.a, last.l);
    if (vLen(dLast) < 1e-6) { dLast = vSub(first.a, last.a); }
    var dFirst = vSub(first.a, first.r);
    if (vLen(dFirst) < 1e-6) { dFirst = vSub(last.a, first.a); }
    last.r = vAdd(last.a, vMul(vNorm(dLast), chord * ratio));
    first.l = vAdd(first.a, vMul(vNorm(dFirst), chord * ratio));
    last.t = "s"; first.t = "s";

    var merged = A.concat(B);
    writePath(paths[0], merged, false);
    paths[1].remove();
    return "Connected with a smooth blend.";
};

// ---- Path intersections --------------------------------------------------

CMD.pathIntersections = function (o) {
    var doCut = chBool(o.cut, false);
    var ignoreSelf = chBool(o.ignoreSelf, false);
    var topOnly = chBool(o.topOnly, false);
    var keepTop = chBool(o.keepTop, false);

    var paths = selectedPaths();
    if (paths.length < 1) { return "No paths selected."; }

    var i, j;
    // Collect: for each path, a list of {seg, t}
    var hits = [];
    for (i = 0; i < paths.length; i++) { hits.push([]); }

    var topIndex = paths.length - 1;

    for (i = 0; i < paths.length; i++) {
        for (j = i; j < paths.length; j++) {
            if (i === j && ignoreSelf) { continue; }
            if (topOnly && i !== topIndex && j !== topIndex) { continue; }
            var pa = readPath(paths[i]), pb = readPath(paths[j]);
            var ca = paths[i].closed, cb = paths[j].closed;
            var na = segCount(pa, ca), nb = segCount(pb, cb);
            var si, sj, A, B, xs, k;
            for (si = 0; si < na; si++) {
                A = segOf(pa, si, ca);
                for (sj = (i === j ? si + 1 : 0); sj < nb; sj++) {
                    if (i === j && (sj === si + 1 || (si === 0 && sj === nb - 1))) { continue; }
                    B = segOf(pb, sj, cb);
                    if (!A || !B) { continue; }
                    if (!bboxOverlap(bezBBox(A[0], A[1], A[2], A[3]), bezBBox(B[0], B[1], B[2], B[3]), 0.05)) { continue; }
                    xs = bezIntersect(A, B, 0.02);
                    for (k = 0; k < xs.length; k++) {
                        if (xs[k].t1 > 1e-4 && xs[k].t1 < 1 - 1e-4) { hits[i].push({ seg: si, t: xs[k].t1 }); }
                        if (xs[k].t2 > 1e-4 && xs[k].t2 < 1 - 1e-4) { hits[j].push({ seg: sj, t: xs[k].t2 }); }
                    }
                }
            }
        }
    }

    var totalAdded = 0;
    for (i = 0; i < paths.length; i++) {
        if (keepTop && i === topIndex) { continue; }
        if (!hits[i].length) { continue; }
        var pts = readPath(paths[i]);
        var closed = paths[i].closed;
        var n = pts.length;

        // group by segment, sorted by t
        var bySeg = {};
        for (j = 0; j < hits[i].length; j++) {
            var key = "s" + hits[i][j].seg;
            if (!bySeg[key]) { bySeg[key] = []; }
            bySeg[key].push(hits[i][j].t);
        }

        var out = [], k2, nx, list, cur, prevT, t, sp, m, q;
        for (k2 = 0; k2 < n; k2++) {
            out.push(pts[k2]);
            if (!closed && k2 === n - 1) { break; }
            nx = (k2 + 1) % n;
            list = bySeg["s" + k2];
            if (!list) { continue; }
            list.sort(function (a, b) { return a - b; });
            var clean = [];
            for (q = 0; q < list.length; q++) {
                if (!clean.length || Math.abs(clean[clean.length - 1] - list[q]) > 1e-3) { clean.push(list[q]); }
            }
            cur = [pts[k2].a, pts[k2].r, pts[nx].l, pts[nx].a];
            prevT = 0;
            for (q = 0; q < clean.length; q++) {
                t = (clean[q] - prevT) / (1 - prevT);
                if (!(t > 1e-5 && t < 1 - 1e-5)) { continue; }
                sp = bezSplit(cur[0], cur[1], cur[2], cur[3], t);
                out[out.length - 1].r = sp.left[1];
                m = mkPt(sp.left[3], sp.left[2], sp.right[1], "c");
                m.sel = true;
                out.push(m);
                cur = sp.right;
                prevT = clean[q];
                totalAdded++;
            }
            pts[nx].l = cur[2];
        }
        writePath(paths[i], out, closed);
    }

    if (doCut && totalAdded > 0) {
        // Reuse the split routine on the freshly inserted, still-selected points
        app.redraw();
        return "Added " + totalAdded + " intersection point(s). Use Split at Points to cut.";
    }
    return totalAdded ? ("Added " + totalAdded + " intersection point(s).") : "No intersections found.";
};

// ---- Selection helpers ---------------------------------------------------

function setSelection(path, flags) {
    var i;
    for (i = 0; i < path.pathPoints.length; i++) {
        path.pathPoints[i].selected = flags[i] ? PathPointSelection.ANCHORPOINT
                                               : PathPointSelection.NOSELECTION;
    }
}

CMD.selectPoints = function (o) {
    var mode = chStr(o.mode, "corner"); // corner | smooth | pattern | grow | shrink | invert | all
    var initSkip = Math.round(chNum(o.initSkip, 0));
    var take = Math.round(chNum(o.take, 1));
    var skip = Math.round(chNum(o.skip, 1));

    var paths = selectedPaths();
    if (!paths.length) { return "No paths selected."; }
    var i, j, pts, n, flags, cnt = 0;

    for (i = 0; i < paths.length; i++) {
        pts = readPath(paths[i]);
        n = pts.length;
        flags = [];
        for (j = 0; j < n; j++) { flags.push(false); }

        if (mode === "corner" || mode === "smooth") {
            for (j = 0; j < n; j++) { flags[j] = (pts[j].t === (mode === "smooth" ? "s" : "c")); }
        } else if (mode === "all") {
            for (j = 0; j < n; j++) { flags[j] = true; }
        } else if (mode === "invert") {
            for (j = 0; j < n; j++) { flags[j] = !pts[j].sel; }
        } else if (mode === "grow") {
            for (j = 0; j < n; j++) {
                if (pts[j].sel) { flags[j] = true; continue; }
                var pv = (j - 1 + n) % n, nx = (j + 1) % n;
                if (!paths[i].closed) {
                    if (j > 0 && pts[j - 1].sel) { flags[j] = true; }
                    if (j < n - 1 && pts[j + 1].sel) { flags[j] = true; }
                } else if (pts[pv].sel || pts[nx].sel) { flags[j] = true; }
            }
        } else if (mode === "shrink") {
            for (j = 0; j < n; j++) {
                if (!pts[j].sel) { continue; }
                var pv2 = (j - 1 + n) % n, nx2 = (j + 1) % n;
                if (!paths[i].closed && (j === 0 || j === n - 1)) { flags[j] = false; continue; }
                flags[j] = (pts[pv2].sel && pts[nx2].sel);
            }
        } else { // pattern
            var idx = initSkip;
            while (idx < n) {
                for (j = 0; j < take && idx < n; j++) { flags[idx] = true; idx++; }
                idx += skip;
            }
        }
        for (j = 0; j < n; j++) { if (flags[j]) { cnt++; } }
        setSelection(paths[i], flags);
    }
    return "Selected " + cnt + " point(s).";
};

// ---- Generators ----------------------------------------------------------

CMD.roulette = function (o) {
    var kind = chStr(o.kind, "hypo");           // epi | hypo
    var p = Math.round(chNum(o.ratioR, 10));
    var q = Math.round(chNum(o.ratioS, 3));
    var R = chNum(o.R, 200);
    var D = chNum(o.D, 100) / 100;
    var count = Math.round(chNum(o.count, 1));
    var rotStep = chNum(o.rotate, 0);
    var R2 = chNum(o.R2, R);
    var D2 = chNum(o.D2, chNum(o.D, 100)) / 100;
    var accuracy = Math.round(chNum(o.accuracy, 3)); // 1..5
    var weight = chNum(o.weight, 0.5);

    if (p < 1) { p = 1; } if (p > 200) { p = 200; }
    if (q < 1) { q = 1; } if (q > 200) { q = 200; }
    var g = gcdInt(p, q);
    p = p / g; q = q / g;

    var doc = app.activeDocument;
    var cx = 0, cy = 0;
    if (chBool(o.centreOnScreen, true)) {
        var vb = doc.activeView.bounds; // [l, t, r, b]
        cx = (vb[0] + vb[2]) / 2;
        cy = (vb[1] + vb[3]) / 2;
    }

    var samplesPerTurn = [24, 48, 96, 192, 384][Math.max(0, Math.min(4, accuracy - 1))];
    var turns = q;
    var totalSteps = samplesPerTurn * turns;
    var thetaMax = 2 * Math.PI * turns;
    var h = thetaMax / totalSteps;

    var grp = null;
    if (count > 1) { grp = doc.groupItems.add(); }

    function curveAt(theta, Rv, Dv) {
        var S = Rv * q / p;
        var x, y, k;
        if (kind === "epi") {
            k = (Rv + S) / S;
            x = (Rv + S) * Math.cos(theta) - Dv * S * Math.cos(k * theta);
            y = (Rv + S) * Math.sin(theta) - Dv * S * Math.sin(k * theta);
        } else {
            k = (Rv - S) / S;
            x = (Rv - S) * Math.cos(theta) + Dv * S * Math.cos(k * theta);
            y = (Rv - S) * Math.sin(theta) - Dv * S * Math.sin(k * theta);
        }
        return [x, y];
    }
    function derivAt(theta, Rv, Dv) {
        var e = 1e-5;
        var a = curveAt(theta - e, Rv, Dv), b = curveAt(theta + e, Rv, Dv);
        return [(b[0] - a[0]) / (2 * e), (b[1] - a[1]) / (2 * e)];
    }

    var made = 0, c;
    for (c = 0; c < count; c++) {
        var f = (count === 1) ? 0 : c / (count - 1);
        var Rv = R + (R2 - R) * f;
        var Dv = D + (D2 - D) * f;
        var ang = rad(rotStep * c);

        var pts = [], i2, th, pos, der, outH, inH;
        for (i2 = 0; i2 < totalSteps; i2++) {
            th = i2 * h;
            pos = curveAt(th, Rv, Dv);
            der = derivAt(th, Rv, Dv);
            pos = vRot(pos, ang);
            der = vRot(der, ang);
            pos = [pos[0] + cx, pos[1] + cy];
            // exact cubic Hermite to bezier conversion
            outH = [pos[0] + der[0] * h / 3, pos[1] + der[1] * h / 3];
            inH = [pos[0] - der[0] * h / 3, pos[1] - der[1] * h / 3];
            pts.push(mkPt(pos, inH, outH, "s"));
        }

        var np = doc.pathItems.add();
        np.closed = true;
        np.filled = false;
        np.stroked = true;
        np.strokeWidth = weight;
        try {
            np.strokeJoin = StrokeJoin.ROUNDENDJOIN;
        } catch (e2) {}
        writePath(np, pts, true);
        np.pathPoints[0].remove();
        np.note = "Chisel Roulette " + kind + " R:S=" + p + ":" + q + " R=" + Rv + " D=" + (Dv * 100) + "%";
        if (grp) { np.move(grp, ElementPlacement.PLACEATEND); }
        made++;
    }
    return "Created " + made + " roulette path(s), " + totalSteps + " points each.";
};

CMD.delaunay = function (o) {
    var source = chStr(o.source, "anchors"); // anchors | centres
    var minAngle = chNum(o.minAngle, 0);
    var keep = chBool(o.keep, true);

    var doc = app.activeDocument;
    var sel = doc.selection;
    if (!sel || !sel.length) { return "Nothing selected."; }

    var P = [], i, j;
    if (source === "centres") {
        for (i = 0; i < sel.length; i++) {
            var b = sel[i].geometricBounds;
            P.push([(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]);
        }
    } else {
        var paths = selectedPaths();
        for (i = 0; i < paths.length; i++) {
            var pts = readPath(paths[i]);
            for (j = 0; j < pts.length; j++) { P.push(pts[j].a); }
        }
    }
    // dedupe
    var pts2 = [];
    for (i = 0; i < P.length; i++) {
        var dup = false;
        for (j = 0; j < pts2.length; j++) { if (vDist(P[i], pts2[j]) < 1e-6) { dup = true; break; } }
        if (!dup) { pts2.push(P[i]); }
    }
    if (pts2.length < 3) { return "Need at least three distinct points."; }

    // Bowyer-Watson
    var minx = pts2[0][0], maxx = minx, miny = pts2[0][1], maxy = miny;
    for (i = 1; i < pts2.length; i++) {
        if (pts2[i][0] < minx) minx = pts2[i][0];
        if (pts2[i][0] > maxx) maxx = pts2[i][0];
        if (pts2[i][1] < miny) miny = pts2[i][1];
        if (pts2[i][1] > maxy) maxy = pts2[i][1];
    }
    var dx = maxx - minx, dy = maxy - miny;
    var dm = Math.max(dx, dy) * 20 + 100;
    var mx = (minx + maxx) / 2, my = (miny + maxy) / 2;
    var work = pts2.slice(0);
    var s0 = work.length, s1 = s0 + 1, s2 = s0 + 2;
    work.push([mx - dm, my - dm]);
    work.push([mx + dm, my - dm]);
    work.push([mx, my + dm]);

    function circum(a, b, c) {
        var ax = a[0], ay = a[1], bx = b[0], by = b[1], cx2 = c[0], cy2 = c[1];
        var d = 2 * (ax * (by - cy2) + bx * (cy2 - ay) + cx2 * (ay - by));
        if (Math.abs(d) < 1e-12) { return null; }
        var ux = ((ax * ax + ay * ay) * (by - cy2) + (bx * bx + by * by) * (cy2 - ay) + (cx2 * cx2 + cy2 * cy2) * (ay - by)) / d;
        var uy = ((ax * ax + ay * ay) * (cx2 - bx) + (bx * bx + by * by) * (ax - cx2) + (cx2 * cx2 + cy2 * cy2) * (bx - ax)) / d;
        return { x: ux, y: uy, r2: (ax - ux) * (ax - ux) + (ay - uy) * (ay - uy) };
    }

    var tris = [{ i: s0, j: s1, k: s2, cc: circum(work[s0], work[s1], work[s2]) }];
    var v, bad, edges, t, e, m;
    for (v = 0; v < pts2.length; v++) {
        bad = []; edges = [];
        for (t = tris.length - 1; t >= 0; t--) {
            var cc = tris[t].cc;
            if (!cc) { tris.splice(t, 1); continue; }
            var ddx = work[v][0] - cc.x, ddy = work[v][1] - cc.y;
            if (ddx * ddx + ddy * ddy < cc.r2) {
                bad.push(tris[t]);
                edges.push([tris[t].i, tris[t].j]);
                edges.push([tris[t].j, tris[t].k]);
                edges.push([tris[t].k, tris[t].i]);
                tris.splice(t, 1);
            }
        }
        // keep only boundary edges
        var bound = [];
        for (e = 0; e < edges.length; e++) {
            var shared = false;
            for (m = 0; m < edges.length; m++) {
                if (m === e) { continue; }
                if ((edges[e][0] === edges[m][0] && edges[e][1] === edges[m][1]) ||
                    (edges[e][0] === edges[m][1] && edges[e][1] === edges[m][0])) { shared = true; break; }
            }
            if (!shared) { bound.push(edges[e]); }
        }
        for (e = 0; e < bound.length; e++) {
            tris.push({ i: bound[e][0], j: bound[e][1], k: v, cc: circum(work[bound[e][0]], work[bound[e][1]], work[v]) });
        }
    }

    function triMinAngle(a, b, c) {
        function ang(p1, p2, p3) {
            var u = vNorm(vSub(p2, p1)), w = vNorm(vSub(p3, p1));
            var d = vDot(u, w);
            if (d > 1) d = 1; if (d < -1) d = -1;
            return deg(Math.acos(d));
        }
        return Math.min(ang(a, b, c), Math.min(ang(b, a, c), ang(c, a, b)));
    }

    var grp = doc.groupItems.add();
    var made = 0;
    for (t = 0; t < tris.length; t++) {
        var T = tris[t];
        if (T.i >= s0 || T.j >= s0 || T.k >= s0) { continue; }
        var a2 = work[T.i], b2 = work[T.j], c2 = work[T.k];
        if (minAngle > 0 && triMinAngle(a2, b2, c2) < minAngle) { continue; }
        var np2 = grp.pathItems.add();
        np2.setEntirePath([a2, b2, c2]);
        np2.closed = true;
        np2.filled = false;
        np2.stroked = true;
        np2.strokeWidth = 0.25;
        made++;
    }
    if (!keep) {
        for (i = sel.length - 1; i >= 0; i--) { try { sel[i].remove(); } catch (e3) {} }
    }
    return "Created " + made + " triangle(s).";
};

// ---- Info ----------------------------------------------------------------

CMD.info = function () {
    var paths = selectedPaths();
    if (!paths.length) { return "0|0|0|0|0"; }
    var i, j, pts, nPts = 0, nSel = 0, nClosed = 0, nOpen = 0, len = 0, closed, s;
    for (i = 0; i < paths.length; i++) {
        pts = readPath(paths[i]);
        closed = paths[i].closed;
        nPts += pts.length;
        for (j = 0; j < pts.length; j++) { if (pts[j].sel) { nSel++; } }
        if (closed) { nClosed++; } else { nOpen++; }
        for (j = 0; j < segCount(pts, closed); j++) {
            s = segOf(pts, j, closed);
            if (s) { len += bezLength(s[0], s[1], s[2], s[3], 24); }
        }
    }
    return paths.length + "|" + nPts + "|" + nSel + "|" + nClosed + "|" + nOpen + "|" + (Math.round(len * 100) / 100);
};

//= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =
// 8. Dispatcher
//= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =

function chiselRun(cmd, argLiteral) {
    if (!app.documents.length) { return "Open a document first."; }
    var o = {};
    try {
        if (argLiteral && argLiteral.length) { o = eval("(" + argLiteral + ")"); }
    } catch (e) { o = {}; }

    if (!CMD[cmd]) { return "Unknown command: " + cmd; }

    try {
        var res = CMD[cmd](o);
        try { app.redraw(); } catch (e2) {}
        return res;
    } catch (err) {
        return "Error: " + err.message + " (line " + (err.line || "?") + ")";
    }
}

function chiselVersion() { return CH.VERSION; }
