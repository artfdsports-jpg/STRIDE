/*
 * Chisel: path extension and tangent lines
 *
 * Continue a path along its own natural direction, in the four modes that make
 * sense geometrically:
 *
 *   Single bezier    the terminal cubic's parameter range is pushed past t=1.
 *                    No anchor is added; the existing curve simply gets longer,
 *                    following exactly the shape its own control points imply.
 *   Constant radius  a circular arc continuing the curvature the path already
 *                    has at that end. Curvature continuous, not merely smooth.
 *   Straight         a straight run along the end tangent.
 *   Spiral           a logarithmic spiral whose curvature starts matched and
 *                    then opens out at the chosen winding rate.
 *
 * A negative length trims instead, in every mode, because "extend by -20" is
 * how you shorten something to a measured length and the alternative is
 * guessing with the direct selection tool.
 *
 * The second half of the file strikes tangent and normal lines from a point on
 * a path. Those can be locked to their reference, so the tangent follows when
 * the path it was struck from is edited.
 *
 * Depends on: chisel.jsx, chisel-meta.jsx, chisel-tangency.jsx,
 *             chisel-constraints.jsx, chisel-inspector.jsx (insFocus)
 */

var EXT = {};

EXT.FLAT = 1e6;        // curvature radius past which a curve is treated as straight
EXT.EPS = 1e-9;

//= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =
// 1. The frame at an end of a path
//= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =

/*
 * Everything needed to continue a path from one of its ends:
 *
 *   p      the endpoint
 *   t      unit tangent pointing outward, away from the path
 *   r      radius of curvature there
 *   c      centre of curvature, or null where the end is straight
 *
 * The curvature centre is computed from the segment's own parameterisation and
 * is therefore the same point whichever end is being extended. Deriving a turn
 * direction from the outward tangent instead would need the sign flipping at
 * the start end, which is exactly the kind of thing that works in testing and
 * then mirrors a spiral the wrong way on real artwork.
 */
function extEndFrame(pts, closed, atStart) {
    var n = pts.length, seg, tParam, d1, d2, p, tan, kappaR, cross, nrm, c;
    if (n < 2 || closed) { return null; }

    if (atStart) {
        seg = segOf(pts, 0, false);
        tParam = 0;
    } else {
        seg = segOf(pts, n - 2, false);
        tParam = 1;
    }
    if (!seg) { return null; }

    d1 = bezD1(seg[0], seg[1], seg[2], seg[3], tParam);
    d2 = bezD2(seg[0], seg[1], seg[2], seg[3], tParam);
    p = atStart ? [seg[0][0], seg[0][1]] : [seg[3][0], seg[3][1]];

    if (vLen(d1) < EXT.EPS) {
        // A retracted handle collapses the first derivative at the endpoint;
        // the chord still says which way the segment runs.
        d1 = atStart ? vSub(seg[0], seg[3]) : vSub(seg[3], seg[0]);
        if (vLen(d1) < EXT.EPS) { return null; }
        tan = vNorm(d1);
        return { p: p, t: atStart ? tan : tan, r: Infinity, c: null };
    }

    tan = vNorm(d1);
    if (atStart) { tan = vMul(tan, -1); }     // outward means backwards here

    kappaR = bezCurvatureRadius(seg[0], seg[1], seg[2], seg[3], tParam);
    cross = vCross(d1, d2);

    if (!isFinite(kappaR) || kappaR > EXT.FLAT || Math.abs(cross) < EXT.EPS) {
        return { p: p, t: tan, r: Infinity, c: null };
    }

    /*
     * Prefer a circle fitted to the whole terminal segment over the pointwise
     * curvature there.
     *
     * This matters more than it sounds. A bezier quarter circle has a curvature
     * radius at its endpoints 2.2% larger than the circle it draws - that is
     * inherent to the four-cubic approximation, not a defect in the artwork. An
     * arc extension built on the pointwise value therefore drifts visibly off
     * the circle the user can see, by a whole point over a radian on a 100pt
     * radius. Fitting the segment recovers the radius they actually drew.
     *
     * Only the magnitude is taken from the fit. The centre is placed on the
     * exact normal at the endpoint, so the join stays perfectly tangent even
     * where the fit is imperfect.
     */
    var samples = [], si, fit;
    for (si = 0; si <= 12; si++) {
        samples.push(bezAt(seg[0], seg[1], seg[2], seg[3], si / 12));
    }
    fit = fitCircle(samples);
    if (fit && fit.rel <= 0.01 && fit.r < EXT.FLAT &&
        fit.r > kappaR * 0.5 && fit.r < kappaR * 2) {
        kappaR = fit.r;
    }

    // Centre lies on the left of travel when the curve turns left.
    nrm = vNorm([-d1[1], d1[0]]);
    if (cross < 0) { nrm = vMul(nrm, -1); }
    c = vAdd(p, vMul(nrm, kappaR));

    return { p: p, t: tan, r: kappaR, c: c };
}

//= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =
// 2. Arc and spiral construction
//= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =

/*
 * An arc given a signed sweep rather than an end angle. arcPoints in the
 * tangency module takes two angles and works out the direction, which cannot
 * express a sweep beyond a full turn - and a tight extension arc easily wraps
 * more than once.
 */
function extArc(c, r, a0, sweep) {
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
    pts[n].r = [pts[n].a[0], pts[n].a[1]];
    pts[n].t = "c";
    return pts;
}

/*
 * A logarithmic spiral continuing from a point with a known tangent and
 * curvature radius.
 *
 * In its own polar frame the spiral is r(th) = r0 e^(b th), whose curvature
 * radius at angle th is r sqrt(1+b^2) and whose arc length from the start is
 * (sqrt(1+b^2)/b) (r - r0). Substituting rho0 = r0 sqrt(1+b^2) collapses the
 * arc-length inversion to
 *
 *     th(s) = ln(1 + s b / rho0) / b
 *
 * which is why the construction below never has to integrate anything.
 *
 * The canonical spiral turns counter-clockwise with the curvature centre on the
 * left of travel; a right-turning end is handled by mirroring in y before the
 * frame is rotated into place.
 *
 * b is the winding constant. As b tends to zero the spiral tends to a circle,
 * and the formulae above divide by it, so small b falls back to the arc.
 */
function extSpiral(p, tan, rho0, turn, b, len) {
    if (!isFinite(rho0) || rho0 > EXT.FLAT) { return null; }
    if (Math.abs(b) < 1e-4 || len <= 0) { return null; }

    var root = Math.sqrt(1 + b * b);
    var r0 = rho0 / root;
    var sigma = (turn >= 0) ? 1 : -1;

    // Total polar sweep needed for the requested arc length.
    var inner = 1 + len * b / rho0;
    if (inner <= EXT.EPS) { return null; }     // spiral winds into its pole first
    var thEnd = Math.log(inner) / b;

    // Rotation carrying the canonical start tangent onto the real one.
    var phi = vAng(tan) - Math.atan2(sigma, b);
    var cosPhi = Math.cos(phi), sinPhi = Math.sin(phi);

    function place(th) {
        var r = r0 * Math.exp(b * th);
        var x = r * Math.cos(th);
        var y = sigma * r * Math.sin(th);
        // Relative to the canonical start (r0, 0), then rotated and translated.
        var dx = x - r0, dy = y;
        return [p[0] + dx * cosPhi - dy * sinPhi, p[1] + dx * sinPhi + dy * cosPhi];
    }

    function unitTangent(th) {
        // d/dth of (r cos th, sigma r sin th) with r = r0 e^(b th).
        var ct = Math.cos(th), st = Math.sin(th);
        var vx = b * ct - st;
        var vy = sigma * (b * st + ct);
        var m = Math.sqrt(vx * vx + vy * vy);
        if (m < EXT.EPS) { return [tan[0], tan[1]]; }
        vx /= m; vy /= m;
        return [vx * cosPhi - vy * sinPhi, vx * sinPhi + vy * cosPhi];
    }

    // One control point per 45 degrees of turn. Hermite handles are exact in
    // direction and near-exact in length at that spacing; coarser than this and
    // the visible curve starts to cut corners on a tight winding.
    var n = Math.ceil(Math.abs(thEnd) / (Math.PI / 4));
    if (n < 2) { n = 2; }
    if (n > 400) { n = 400; }

    var pts = [], i, th, sPrev = 0, sHere, ptHere, tanHere, dsIn, dsOut;
    var samples = [];
    for (i = 0; i <= n; i++) {
        th = thEnd * i / n;
        sHere = rho0 * (Math.exp(b * th) - 1) / b;
        samples.push({ p: place(th), t: unitTangent(th), s: sHere });
    }

    for (i = 0; i <= n; i++) {
        ptHere = samples[i].p;
        tanHere = samples[i].t;
        dsIn = (i > 0) ? (samples[i].s - samples[i - 1].s) : 0;
        dsOut = (i < n) ? (samples[i + 1].s - samples[i].s) : 0;
        pts.push({
            a: [ptHere[0], ptHere[1]],
            l: [ptHere[0] - tanHere[0] * dsIn / 3, ptHere[1] - tanHere[1] * dsIn / 3],
            r: [ptHere[0] + tanHere[0] * dsOut / 3, ptHere[1] + tanHere[1] * dsOut / 3],
            t: "s",
            sel: false
        });
        sPrev = samples[i].s;
    }
    if (sPrev < 0) { return null; }

    pts[0].l = [pts[0].a[0], pts[0].a[1]];
    pts[n].r = [pts[n].a[0], pts[n].a[1]];
    pts[n].t = "c";
    return pts;
}

//= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =
// 3. Stitching an extension onto a path
//= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =

/* Reverse a point run, swapping each point's in and out handles with it. */
function extReverse(list) {
    var out = [], i, p;
    for (i = list.length - 1; i >= 0; i--) {
        p = list[i];
        out.push({ a: [p.a[0], p.a[1]], l: [p.r[0], p.r[1]], r: [p.l[0], p.l[1]], t: p.t, sel: false });
    }
    return out;
}

/*
 * Join a run built outward from an end back onto the path. The run's first
 * point sits exactly on the existing endpoint, so it is merged into it rather
 * than duplicated - two anchors at the same coordinates is a defect that
 * survives right up until someone tries to select one of them.
 */
function extAttach(pts, run, atStart) {
    var out = [], i, rev;
    if (!run || run.length < 2) { return null; }

    if (atStart) {
        rev = extReverse(run);
        for (i = 0; i < rev.length - 1; i++) { out.push(rev[i]); }
        pts[0].l = [run[0].r[0], run[0].r[1]];
        pts[0].t = "s";
        for (i = 0; i < pts.length; i++) { out.push(pts[i]); }
    } else {
        for (i = 0; i < pts.length; i++) { out.push(pts[i]); }
        pts[pts.length - 1].r = [run[0].r[0], run[0].r[1]];
        pts[pts.length - 1].t = "s";
        for (i = 1; i < run.length; i++) { out.push(run[i]); }
    }
    return out;
}

//= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =
// 4. Single bezier extension
//= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =

/*
 * Length of the piece of a cubic between two parameters. bezSub is happy with
 * parameters outside [0,1] - de Casteljau's linear interpolation extrapolates
 * perfectly well - which is the whole trick behind this mode.
 */
function extLenBetween(seg, t0, t1) {
    var s = bezSub(seg[0], seg[1], seg[2], seg[3], t0, t1);
    return bezLength(s[0], s[1], s[2], s[3], 64);
}

/*
 * Find the parameter at which the terminal cubic reaches the wanted length.
 * Bisection with an expanding bracket rather than Newton: arc length as a
 * function of an extrapolated parameter grows fast and unevenly, and a Newton
 * step off the end of a sharply curling extrapolation lands nowhere useful.
 */
function extSolveParam(seg, wantLen, atStart) {
    var lo, hi, mid, len, i;

    if (atStart) {
        lo = 0; hi = -0.05;
        for (i = 0; i < 60 && extLenBetween(seg, hi, 1) < wantLen; i++) {
            lo = hi;
            hi *= 2;
            if (hi < -1e4) { return null; }
        }
        for (i = 0; i < 80; i++) {
            mid = (lo + hi) / 2;
            len = extLenBetween(seg, mid, 1);
            if (len < wantLen) { lo = mid; } else { hi = mid; }
        }
        return (lo + hi) / 2;
    }

    lo = 1; hi = 1.05;
    for (i = 0; i < 60 && extLenBetween(seg, 0, hi) < wantLen; i++) {
        lo = hi;
        hi *= 2;
        if (hi > 1e4) { return null; }
    }
    for (i = 0; i < 80; i++) {
        mid = (lo + hi) / 2;
        len = extLenBetween(seg, 0, mid);
        if (len < wantLen) { lo = mid; } else { hi = mid; }
    }
    return (lo + hi) / 2;
}

/*
 * Rewrite the terminal segment in place. No anchor is added.
 *
 * Returns null when the segment cannot meaningfully be extrapolated, and the
 * caller then falls back to a straight run. That is not a rare edge case: a
 * plain two-point line has both handles retracted, which makes its cubic
 * x(t) = 300t^2 - 200t^3, whose derivative is *zero* at t=1. Pushed past there
 * it turns round and comes back, so a 400pt extension of a line running right
 * would arrive 300pt to the left. The curve is straight over [0,1] and the
 * parameterisation is a lie outside it.
 */
function extBezier(pts, atStart, delta) {
    var n = pts.length, i, j, seg, base, want, t, curve, d1;
    if (n < 2) { return null; }

    i = atStart ? 0 : n - 2;
    j = i + 1;
    seg = segOf(pts, i, false);
    if (!seg) { return null; }

    if (delta > 0) {
        if (isStraightSeg(seg)) { return null; }
        d1 = bezD1(seg[0], seg[1], seg[2], seg[3], atStart ? 0 : 1);
        if (vLen(d1) < 1e-6) { return null; }
    }

    base = bezLength(seg[0], seg[1], seg[2], seg[3], 64);
    want = base + delta;
    if (want <= EXT.EPS) { return null; }      // the whole segment would vanish

    t = extSolveParam(seg, want, atStart);
    if (t === null) { return null; }

    curve = atStart ? bezSub(seg[0], seg[1], seg[2], seg[3], t, 1)
                    : bezSub(seg[0], seg[1], seg[2], seg[3], 0, t);

    pts[i].a = [curve[0][0], curve[0][1]];
    pts[i].r = [curve[1][0], curve[1][1]];
    pts[j].l = [curve[2][0], curve[2][1]];
    pts[j].a = [curve[3][0], curve[3][1]];

    // The moved endpoint's unused outward handle has to travel with it, or the
    // anchor and its handle end up in different places.
    if (atStart) { pts[i].l = [curve[0][0], curve[0][1]]; }
    else { pts[j].r = [curve[3][0], curve[3][1]]; }
    return pts;
}

//= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =
// 5. Trimming
//= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =

/*
 * Shorten from one end by an arc length, dropping whole segments and splitting
 * the one the cut lands in. Every mode trims the same way: there is no such
 * thing as a spiral-shaped removal.
 */
function extTrim(pts, atStart, amount) {
    var work = atStart ? extReverse(pts) : pts.slice(0);
    var remaining = amount, i, seg, segLen, tbl, cut, t, curve, out;

    while (work.length >= 2 && remaining > EXT.EPS) {
        i = work.length - 2;
        seg = segOf(work, i, false);
        if (!seg) { break; }
        segLen = bezLength(seg[0], seg[1], seg[2], seg[3], 64);

        if (segLen <= remaining + EXT.EPS) {
            // The cut is past this segment entirely: drop its far anchor.
            work.pop();
            remaining -= segLen;
            continue;
        }

        tbl = bezTableForLength(seg[0], seg[1], seg[2], seg[3], 128);
        cut = tbl[tbl.length - 1] - remaining;
        t = bezTAtLength(tbl, cut);
        curve = bezSub(seg[0], seg[1], seg[2], seg[3], 0, t);

        work[i].r = [curve[1][0], curve[1][1]];
        work[i + 1].l = [curve[2][0], curve[2][1]];
        work[i + 1].a = [curve[3][0], curve[3][1]];
        work[i + 1].r = [curve[3][0], curve[3][1]];
        remaining = 0;
    }

    if (work.length < 2) { return null; }
    out = atStart ? extReverse(work) : work;
    return out;
}

//= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =
// 6. The extend command
//= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =

function extBuildRun(frame, mode, len, winding) {
    var sweep, a0, turn, run;

    if (mode === "straight" || !frame.c) {
        return [
            { a: [frame.p[0], frame.p[1]], l: [frame.p[0], frame.p[1]], r: [frame.p[0], frame.p[1]], t: "c", sel: false },
            {
                a: [frame.p[0] + frame.t[0] * len, frame.p[1] + frame.t[1] * len],
                l: [frame.p[0] + frame.t[0] * len, frame.p[1] + frame.t[1] * len],
                r: [frame.p[0] + frame.t[0] * len, frame.p[1] + frame.t[1] * len],
                t: "c",
                sel: false
            }
        ];
    }

    // Which way round the centre the outward tangent points decides the sweep
    // sign, and it is read from the geometry rather than assumed, so both ends
    // of the path behave the same.
    turn = vCross(vSub(frame.p, frame.c), frame.t) > 0 ? 1 : -1;

    if (mode === "spiral") {
        run = extSpiral(frame.p, frame.t, frame.r, turn, winding, len);
        if (run) { return run; }
        // Fall through to the arc when the spiral is degenerate, rather than
        // failing: a winding of zero is a circle, which is a legitimate answer.
    }

    a0 = vAng(vSub(frame.p, frame.c));
    sweep = (len / frame.r) * turn;
    return extArc(frame.c, frame.r, a0, sweep);
}

/*
 * Extend, or with a negative length trim, every selected open path.
 *
 * Extending the whole selection at once is the point: a technical drawing has a
 * dozen leader lines that all want to reach the same margin, and doing them one
 * at a time is how the feature stops being used.
 */
CMD.extendPath = function (o) {
    var paths = selectedPaths();
    if (!paths.length) { return "Select one or more open paths."; }

    var mode = chStr(o.mode, "bezier");
    var len = chNum(o.length, 20);
    var winding = chNum(o.winding, 0.2);
    var which = chStr(o.which, "end");

    if (Math.abs(len) < EXT.EPS) { return "Length is zero; nothing to do."; }

    var done = 0, skippedClosed = 0, failed = 0;
    var i, k, path, pts, ends, atStart, frame, run, next;

    for (i = 0; i < paths.length; i++) {
        path = paths[i];
        if (path.closed) { skippedClosed++; continue; }

        pts = readPath(path);
        if (pts.length < 2) { failed++; continue; }

        ends = (which === "both") ? [false, true] : [which === "start"];

        for (k = 0; k < ends.length; k++) {
            atStart = ends[k];

            if (len < 0) {
                next = extTrim(pts, atStart, -len);
                if (!next) { failed++; continue; }
                pts = next;
                continue;
            }

            if (mode === "bezier") {
                next = extBezier(pts, atStart, len);
                if (next) { pts = next; continue; }
                // Not extrapolatable - a straight terminal segment, or one with
                // a retracted end handle. Continue it as a straight run, which
                // is the same shape the cubic was drawing anyway.
                frame = extEndFrame(pts, false, atStart);
                if (!frame) { failed++; continue; }
                next = extAttach(pts, extBuildRun(frame, "straight", len, winding), atStart);
                if (!next) { failed++; continue; }
                pts = next;
                continue;
            }

            frame = extEndFrame(pts, false, atStart);
            if (!frame) { failed++; continue; }

            run = extBuildRun(frame, mode, len, winding);
            next = extAttach(pts, run, atStart);
            if (!next) { failed++; continue; }
            pts = next;
        }

        writePath(path, pts, false);
        done++;
    }

    if (!done) {
        if (skippedClosed && !failed) { return "Only open paths can be extended. Use Open path first."; }
        return "Could not extend the selection.";
    }

    var msg = (len < 0 ? "Trimmed " : "Extended ") + done + " path" + (done === 1 ? "" : "s") +
              " by " + Math.abs(Math.round(len * 100) / 100) + " pt";
    if (len > 0 && mode !== "bezier") { msg += " as a " + (mode === "radius" ? "constant radius arc" : mode); }
    msg += ".";
    if (skippedClosed) { msg += " " + skippedClosed + " closed path" + (skippedClosed === 1 ? " was" : "s were") + " skipped."; }
    if (failed) { msg += " " + failed + " end could not be built."; }
    return msg;
};

//= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =
// 7. Tangent and normal lines struck from a path
//= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =

/*
 * The point and direction at a place on a path, given an anchor index and an
 * optional position along the segment that follows it. at = 0 means the anchor
 * itself, which is the common case; anything else walks into the segment by
 * that fraction of its arc length.
 */
function extPointOnPath(pts, closed, index, at) {
    var n = pts.length, seg, tbl, t, p, d;
    if (index < 0 || index >= n) { return null; }

    if (at <= EXT.EPS) {
        seg = segOf(pts, index, closed);
        if (seg) {
            d = bezTangent(seg[0], seg[1], seg[2], seg[3], 0);
            return { p: [pts[index].a[0], pts[index].a[1]], t: d };
        }
        // The last anchor of an open path has no segment after it, so the
        // direction comes from the one arriving.
        seg = segOf(pts, index - 1, closed);
        if (!seg) { return null; }
        d = bezTangent(seg[0], seg[1], seg[2], seg[3], 1);
        return { p: [pts[index].a[0], pts[index].a[1]], t: d };
    }

    seg = segOf(pts, index, closed);
    if (!seg) { return null; }
    tbl = bezTableForLength(seg[0], seg[1], seg[2], seg[3], 128);
    t = bezTAtLength(tbl, tbl[tbl.length - 1] * at);
    p = bezAt(seg[0], seg[1], seg[2], seg[3], t);
    d = bezTangent(seg[0], seg[1], seg[2], seg[3], t);
    return { p: p, t: d };
}

function extLineFrom(p, dir, len, side) {
    var back = (side === "forward") ? 0 : len;
    var fwd = (side === "back") ? 0 : len;
    return linePoints(vSub(p, vMul(dir, back)), vAdd(p, vMul(dir, fwd)));
}

/*
 * Strike a line tangent to a path at a chosen point, optionally locked so it
 * follows when the path is edited. Normal mode gives the perpendicular, which
 * is the same construction rotated and is what you want for a leader line or a
 * mitre.
 */
CMD.tangentLine = function (o) {
    var f = insFocus();
    if (!f) { return "Select a path, and an anchor on it."; }
    if (!f.sel.length) { return "Select the anchor to strike the line from."; }

    var len = chNum(o.length, 60);
    if (len <= 0) { return "Length must be greater than zero."; }
    var side = chStr(o.side, "both");
    var normal = chStr(o.mode, "tangent") === "normal";
    var at = chNum(o.at, 0);
    if (at < 0) { at = 0; }
    if (at > 1) { at = 1; }

    var idx = f.sel[0];
    var hit = extPointOnPath(f.pts, f.path.closed, idx, at);
    if (!hit) { return "Cannot read a direction at that anchor."; }

    var dir = normal ? [-hit.t[1], hit.t[0]] : hit.t;
    var np = conNewPath(f.path, extLineFrom(hit.p, dir, len, side), false);
    styleFrom(np, f.path, false);

    if (chBool(o.lock, true)) {
        var refId = conRegisterRef(f.path);
        metaWrite(np, {
            kind: "tanpath", id: metaNewId("s"),
            a: refId, ai: idx, at: at, len: len,
            side: side, dir: normal ? "normal" : "tangent"
        });
        conInvalidate();
    }

    app.activeDocument.selection = [np];
    return (normal ? "Normal" : "Tangent") + " struck at anchor " + (idx + 1) +
           (chBool(o.lock, true) ? " and locked to the path." : ".");
};

/*
 * Rebuild a struck line from its reference. Registered with the solver by name,
 * so the constraint module does not have to know this file exists.
 */
function conSolveTanPath(reg, entry) {
    var rec = entry.rec;
    var src = metaGet(reg, metaS(rec, "a", ""));
    if (!src || !metaAlive(src)) { return "broken"; }

    var pts;
    try { pts = readPath(src.item); } catch (e) { return "broken"; }

    var idx = metaN(rec, "ai", 0);
    var at = metaN(rec, "at", 0);
    var hit = extPointOnPath(pts, src.item.closed, idx, at);
    if (!hit) { return "impossible"; }

    var dir = (metaS(rec, "dir", "tangent") === "normal") ? [-hit.t[1], hit.t[0]] : hit.t;
    var run = extLineFrom(hit.p, dir, metaN(rec, "len", 60), metaS(rec, "side", "both"));
    writePath(entry.item, run, false);
    return "ok";
}
