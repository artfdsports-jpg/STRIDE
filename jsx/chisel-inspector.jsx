/*
 * Chisel: live point inspector
 *
 * The numeric half of a path tool. Illustrator will show you an anchor's X and
 * Y and nothing else - not the length of its handles, not their angles, not the
 * length of the segment you are looking at, and it will not let you type any of
 * those. This module reports all of it and takes it back as input.
 *
 * Two conventions, both chosen to match what the user sees rather than what the
 * DOM stores:
 *
 *   Coordinates are artboard-relative with Y increasing downward, which is what
 *   Illustrator's own transform panel shows. The scripting DOM is Y-up from the
 *   ruler origin. Every value crossing this boundary is converted.
 *
 *   Angles are measured in that same display space, so an angle of 30 degrees
 *   points up and to the right on screen. Computing them in DOM space would
 *   mirror every angle vertically and look like a bug.
 *
 * Depends on: chisel.jsx, chisel-meta.jsx
 */

var INS = {};

/* Points per unit. Illustrator's internal unit is always the point. */
function insUnitFactor(name) {
    if (name === "mm") { return 2.834645669291339; }
    if (name === "cm") { return 28.34645669291339; }
    if (name === "in") { return 72; }
    return 1;   // pt and px are the same size at Illustrator's 72 ppi
}

/*
 * The artboard the user is working on. Falls back to the first one, and to the
 * ruler origin if artboards are unavailable, so the inspector degrades to
 * document coordinates rather than failing.
 */
function insArtboardRect() {
    var doc = app.activeDocument, i;
    try {
        i = doc.artboards.getActiveArtboardIndex();
    } catch (e) { i = 0; }
    try {
        return doc.artboards[i].artboardRect;   // [left, top, right, bottom]
    } catch (e2) {
        return [0, 0, 0, 0];
    }
}

function insSpace(o) {
    return {
        artboard: chStr(o.space, "artboard") === "artboard",
        rect: insArtboardRect(),
        f: insUnitFactor(chStr(o.units, "pt"))
    };
}

/* DOM point -> display coordinates. */
function insToDisp(p, sp) {
    if (!sp.artboard) { return [p[0] / sp.f, p[1] / sp.f]; }
    return [(p[0] - sp.rect[0]) / sp.f, (sp.rect[1] - p[1]) / sp.f];
}

/* Display coordinates -> DOM point. */
function insFromDisp(p, sp) {
    if (!sp.artboard) { return [p[0] * sp.f, p[1] * sp.f]; }
    return [p[0] * sp.f + sp.rect[0], sp.rect[1] - p[1] * sp.f];
}

/*
 * A vector's angle as the user sees it. In artboard space the screen Y axis
 * runs the other way, so the sign flips; lengths are unaffected.
 */
function insVecAngle(v, sp) {
    var y = sp.artboard ? -v[1] : v[1];
    return deg(Math.atan2(y, v[0]));
}

/* An angle the user typed, back to a DOM direction vector. */
function insAngleVec(a, sp) {
    var r = rad(a);
    return [Math.cos(r), sp.artboard ? -Math.sin(r) : Math.sin(r)];
}

//= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =
// 1. Focus
//= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =

/*
 * What the inspector is currently talking about: the first selected path that
 * has a selected anchor, or failing that the first selected path. Matching the
 * "anchors if you have them, otherwise the whole object" rule the rest of
 * Chisel already follows.
 */
function insFocus() {
    var paths = selectedPaths(), i, pts, j, sel;
    if (!paths.length) { return null; }
    for (i = 0; i < paths.length; i++) {
        pts = readPath(paths[i]);
        sel = [];
        for (j = 0; j < pts.length; j++) { if (pts[j].sel) { sel.push(j); } }
        if (sel.length) { return { path: paths[i], pts: pts, sel: sel, paths: paths }; }
    }
    return { path: paths[0], pts: readPath(paths[0]), sel: [], paths: paths };
}

function insPathLength(pts, closed) {
    var i, s, len = 0;
    for (i = 0; i < segCount(pts, closed); i++) {
        s = segOf(pts, i, closed);
        if (s) { len += bezLength(s[0], s[1], s[2], s[3], 32); }
    }
    return len;
}

/*
 * Enclosed area, exactly, by Green's theorem:  A = 1/2 * integral(x y' - y x').
 *
 * For a cubic the integrand is degree five, and three-point Gauss-Legendre is
 * exact to degree five, so three samples per segment is not an approximation -
 * it is the answer. The obvious alternative, shoelace over a sampled polygon,
 * always reads low on a curve: a 32-gon under-reports a circle by 0.6%, which
 * is enough to be wrong in a readout people trust.
 */
var INS_GAUSS_T = [0.5 - 0.5 * Math.sqrt(0.6), 0.5, 0.5 + 0.5 * Math.sqrt(0.6)];
var INS_GAUSS_W = [5 / 18, 8 / 18, 5 / 18];

function insArea(pts, closed) {
    if (!closed) { return 0; }
    var total = 0, i, j, s, p, d;
    for (i = 0; i < segCount(pts, closed); i++) {
        s = segOf(pts, i, closed);
        if (!s) { continue; }
        for (j = 0; j < 3; j++) {
            p = bezAt(s[0], s[1], s[2], s[3], INS_GAUSS_T[j]);
            d = bezD1(s[0], s[1], s[2], s[3], INS_GAUSS_T[j]);
            total += INS_GAUSS_W[j] * (p[0] * d[1] - p[1] * d[0]);
        }
    }
    return Math.abs(total) / 2;
}

/* Which anchors on this path carry a tangent lock. */
function insLockSet(path) {
    var rec = metaRead(path), out = {}, idx, i;
    if (!rec || !rec.locks) { return out; }
    idx = metaSplitNums(rec.locks);
    for (i = 0; i < idx.length; i++) { out[idx[i]] = true; }
    return out;
}

//= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =
// 2. Readout
//= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =

/*
 * Everything the panel needs for one refresh, as one record. Values that differ
 * across a multiple selection come back with a mixed flag rather than a
 * misleading first value, so the panel can show a dash instead of a number the
 * user might then commit to all of them by accident.
 */
CMD.inspect = function (o) {
    var f = insFocus();
    if (!f) { return metaSerialize({ state: "none" }); }

    var sp = insSpace(o);
    var pts = f.pts, closed = f.path.closed;
    var locks = insLockSet(f.path);
    var out = {
        state: "ok",
        paths: f.paths.length,
        pts: pts.length,
        sel: f.sel.length,
        closed: closed ? 1 : 0,
        len: insPathLength(pts, closed) / sp.f,
        area: insArea(pts, closed) / (sp.f * sp.f),
        locks: 0
    };
    var i;
    for (i = 0; i < pts.length; i++) { if (locks[i]) { out.locks++; } }

    if (!f.sel.length) {
        out.idx = -1;
        return metaSerialize(out);
    }

    var k = f.sel[0], p = pts[k];
    var xy = insToDisp(p.a, sp);
    var inV = vSub(p.l, p.a), outV = vSub(p.r, p.a);

    out.idx = k;
    out.x = xy[0];
    out.y = xy[1];
    out.inLen = vLen(inV) / sp.f;
    out.outLen = vLen(outV) / sp.f;
    out.inAng = (vLen(inV) > 1e-9) ? insVecAngle(inV, sp) : 0;
    out.outAng = (vLen(outV) > 1e-9) ? insVecAngle(outV, sp) : 0;
    out.hasIn = vLen(inV) > 1e-9;
    out.hasOut = vLen(outV) > 1e-9;
    out.type = p.t;
    out.locked = locks[k] ? 1 : 0;

    // The segments either side of this anchor, in path order.
    var prevSeg = closed ? segOf(pts, (k - 1 + pts.length) % pts.length, closed)
                         : (k > 0 ? segOf(pts, k - 1, closed) : null);
    var nextSeg = segOf(pts, k, closed);
    out.segPrev = prevSeg ? bezLength(prevSeg[0], prevSeg[1], prevSeg[2], prevSeg[3], 32) / sp.f : -1;
    out.segNext = nextSeg ? bezLength(nextSeg[0], nextSeg[1], nextSeg[2], nextSeg[3], 32) / sp.f : -1;

    /*
     * Radius of curvature as the curve arrives at and leaves this anchor. Where
     * they differ the point is a curvature break, which is the thing that shows
     * up as a highlight seam on a rendered surface and is otherwise very hard
     * to see on screen.
     */
    if (prevSeg) {
        out.curvIn = bezCurvatureRadius(prevSeg[0], prevSeg[1], prevSeg[2], prevSeg[3], 1) / sp.f;
    }
    if (nextSeg) {
        out.curvOut = bezCurvatureRadius(nextSeg[0], nextSeg[1], nextSeg[2], nextSeg[3], 0) / sp.f;
    }

    // Mixed flags across a multiple selection.
    if (f.sel.length > 1) {
        var mx = 0, my = 0, mIn = 0, mOut = 0, q, qxy;
        for (i = 1; i < f.sel.length; i++) {
            q = pts[f.sel[i]];
            qxy = insToDisp(q.a, sp);
            if (Math.abs(qxy[0] - xy[0]) > 1e-6) { mx = 1; }
            if (Math.abs(qxy[1] - xy[1]) > 1e-6) { my = 1; }
            if (Math.abs(vDist(q.a, q.l) / sp.f - out.inLen) > 1e-6) { mIn = 1; }
            if (Math.abs(vDist(q.a, q.r) / sp.f - out.outLen) > 1e-6) { mOut = 1; }
        }
        out.mixX = mx; out.mixY = my; out.mixIn = mIn; out.mixOut = mOut;
    }

    return metaSerialize(out);
};

/*
 * One call per panel refresh, doing both jobs: read the focused anchor, and if
 * auto-sync is on, re-solve when a driver has moved.
 *
 * Splitting these into two evalScripts would double the bridge traffic on a
 * loop that runs several times a second, and CEP's bridge is the slow part of
 * any panel - not the geometry.
 *
 * Passing no previous hash records the current one without solving, so opening
 * the panel never fires a solve the user did not ask for.
 */
CMD.tick = function (o) {
    var out = "";
    if (chBool(o.sync, false)) {
        var reg = conRegistry(false);
        var h = conStateHash(reg);
        var prev = chStr(o.hash, "");
        if (prev.length && h !== prev) {
            var r = conSolveAll(false);
            h = conStateHash(conRegistry(false));
            out += "solved=" + r.ok + ";sbroken=" + (r.broken + r.impossible) + ";";
            // Only this branch touched the document, so only this branch pays
            // for a redraw.
            try { app.redraw(); } catch (e) {}
        }
        out += "shash=" + h + ";";
    }
    return out + CMD.inspect(o);
};

//= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =
// 3. Writeback
//= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =

/*
 * Apply typed values to every selected anchor. Only the fields actually present
 * are applied, so committing the X field cannot silently reassert a stale Y.
 *
 * Applying to the whole selection rather than just the focused point is
 * deliberate: typing one X into six selected anchors is how you align them, and
 * it is the fastest alignment tool in the program once you know it is there.
 */
CMD.applyPoint = function (o) {
    var f = insFocus();
    if (!f || !f.sel.length) { return "Select at least one anchor first."; }

    var sp = insSpace(o);
    var pts = f.pts, i, k, p, xy, inV, outV, dir, n = 0;

    var hasX = typeof o.x === "number";
    var hasY = typeof o.y === "number";
    var hasIL = typeof o.inLen === "number";
    var hasOL = typeof o.outLen === "number";
    var hasIA = typeof o.inAng === "number";
    var hasOA = typeof o.outAng === "number";
    if (!hasX && !hasY && !hasIL && !hasOL && !hasIA && !hasOA) { return "Nothing to apply."; }

    for (i = 0; i < f.sel.length; i++) {
        k = f.sel[i];
        p = pts[k];

        if (hasX || hasY) {
            xy = insToDisp(p.a, sp);
            if (hasX) { xy[0] = o.x; }
            if (hasY) { xy[1] = o.y; }
            var na = insFromDisp(xy, sp);
            var d = vSub(na, p.a);
            // Handles are stored as absolute points, so they must ride along or
            // moving an anchor silently reshapes both adjoining segments.
            p.a = na;
            p.l = vAdd(p.l, d);
            p.r = vAdd(p.r, d);
        }

        if (hasIL || hasIA) {
            inV = vSub(p.l, p.a);
            dir = hasIA ? insAngleVec(o.inAng, sp)
                        : (vLen(inV) > 1e-9 ? vNorm(inV) : insAngleVec(180, sp));
            p.l = vAdd(p.a, vMul(dir, hasIL ? o.inLen * sp.f : vLen(inV)));
        }
        if (hasOL || hasOA) {
            outV = vSub(p.r, p.a);
            dir = hasOA ? insAngleVec(o.outAng, sp)
                        : (vLen(outV) > 1e-9 ? vNorm(outV) : insAngleVec(0, sp));
            p.r = vAdd(p.a, vMul(dir, hasOL ? o.outLen * sp.f : vLen(outV)));
        }
        n++;
    }

    writePath(f.path, pts, f.path.closed);
    insReselect(f.path, f.sel);
    return "Updated " + n + " anchor" + (n === 1 ? "" : "s") + ".";
};

/*
 * Nudge by a delta. target picks what moves: the anchor and its handles, or one
 * handle on its own. Handle-only nudging is the thing that is genuinely
 * impossible to do accurately by dragging.
 */
CMD.nudgePoint = function (o) {
    var f = insFocus();
    if (!f || !f.sel.length) { return "Select at least one anchor first."; }

    var sp = insSpace(o);
    var dx = chNum(o.dx, 0) * sp.f;
    var dy = chNum(o.dy, 0) * sp.f;
    if (sp.artboard) { dy = -dy; }          // screen down is DOM down-negative
    if (!dx && !dy) { return "Nothing to nudge."; }

    var target = chStr(o.target, "anchor");
    var pts = f.pts, i, k, p, d = [dx, dy];
    for (i = 0; i < f.sel.length; i++) {
        k = f.sel[i];
        p = pts[k];
        if (target === "in") { p.l = vAdd(p.l, d); }
        else if (target === "out") { p.r = vAdd(p.r, d); }
        else if (target === "handles") { p.l = vAdd(p.l, d); p.r = vAdd(p.r, d); }
        else {
            p.a = vAdd(p.a, d);
            p.l = vAdd(p.l, d);
            p.r = vAdd(p.r, d);
        }
    }
    writePath(f.path, pts, f.path.closed);
    insReselect(f.path, f.sel);
    return "Nudged " + f.sel.length + " anchor" + (f.sel.length === 1 ? "" : "s") + ".";
};

/*
 * writePath rebuilds the point list from scratch, which drops the selection.
 * Without restoring it the inspector loses its focus after every single edit
 * and the panel becomes unusable for iterative work.
 */
function insReselect(path, idx) {
    var i, k;
    try {
        for (i = 0; i < path.pathPoints.length; i++) {
            path.pathPoints[i].selected = PathPointSelection.NOSELECTION;
        }
        for (i = 0; i < idx.length; i++) {
            k = idx[i];
            if (k >= 0 && k < path.pathPoints.length) {
                path.pathPoints[k].selected = PathPointSelection.ANCHORPOINT;
            }
        }
    } catch (e) {}
}

//= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =
// 4. Navigation
//= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =

/*
 * Walk the anchors in path order. Stepping beats clicking when you are
 * inspecting a path point by point, and it is the only way to reach an anchor
 * that sits exactly underneath another one.
 */
CMD.stepPoint = function (o) {
    var f = insFocus();
    if (!f) { return "Select a path first."; }

    var n = f.pts.length;
    if (!n) { return "That path has no points."; }

    var how = chStr(o.to, "next");
    var cur = f.sel.length ? f.sel[0] : -1;
    var k;

    if (how === "first") { k = 0; }
    else if (how === "last") { k = n - 1; }
    else if (how === "prev") { k = (cur <= 0) ? n - 1 : cur - 1; }
    else { k = (cur < 0 || cur >= n - 1) ? 0 : cur + 1; }

    // An open path has no wraparound to offer; clamp instead of jumping ends.
    if (!f.path.closed && (how === "next" || how === "prev")) {
        if (cur >= 0) {
            k = (how === "next") ? cur + 1 : cur - 1;
            if (k < 0) { k = 0; }
            if (k > n - 1) { k = n - 1; }
        }
    }

    insReselect(f.path, [k]);
    try { app.activeDocument.selection = [f.path]; } catch (e) {}
    return "Anchor " + (k + 1) + " of " + n + ".";
};

/*
 * Insert an anchor part way along the segment that follows the focused point.
 * "t" is the bezier parameter, "len" is a fraction of the segment's arc length -
 * they are not the same thing, and on a curve with unevenly weighted handles
 * they are not close. Arc length is what people mean by halfway.
 */
CMD.insertOnSegment = function (o) {
    var f = insFocus();
    if (!f || !f.sel.length) { return "Select the anchor at the start of the segment."; }

    var pts = f.pts, closed = f.path.closed, k = f.sel[0];
    var s = segOf(pts, k, closed);
    if (!s) { return "That anchor is the end of an open path; there is no segment after it."; }

    var mode = chStr(o.mode, "length");
    var frac = chNum(o.at, 0.5);
    if (frac <= 0 || frac >= 1) { return "Position must be between 0 and 1."; }

    var t = frac;
    if (mode === "length") {
        var tbl = bezTableForLength(s[0], s[1], s[2], s[3], 96);
        t = bezTAtLength(tbl, tbl[tbl.length - 1] * frac);
    }

    var sp = bezSplit(s[0], s[1], s[2], s[3], t);
    var j = (k + 1) % pts.length;
    pts[k].r = sp.left[1];
    pts[j].l = sp.right[2];
    var mid = mkPt(sp.left[3], sp.left[2], sp.right[1], "s");

    // Inserting after k also covers the closed-path wrap case, where the new
    // point follows the last anchor and lands at the end of the list.
    var out = [], i;
    for (i = 0; i < pts.length; i++) {
        out.push(pts[i]);
        if (i === k) { out.push(mid); }
    }

    writePath(f.path, out, closed);
    insReselect(f.path, [k + 1]);
    return "Anchor inserted at " + Math.round(frac * 100) + "% of the segment" +
           (mode === "length" ? " by arc length." : " by bezier t.");
};

/*
 * Match handle lengths or angles across the selection, taking the focused
 * anchor as the reference. The panel's alternative is typing the same number
 * six times.
 */
CMD.matchHandles = function (o) {
    var f = insFocus();
    if (!f || f.sel.length < 2) { return "Select two or more anchors."; }

    var what = chStr(o.what, "length");
    var pts = f.pts, ref = pts[f.sel[0]], i, p;
    var refIn = vSub(ref.l, ref.a), refOut = vSub(ref.r, ref.a);

    for (i = 1; i < f.sel.length; i++) {
        p = pts[f.sel[i]];
        var vin = vSub(p.l, p.a), vout = vSub(p.r, p.a);
        if (what === "length") {
            if (vLen(vin) > 1e-9) { p.l = vAdd(p.a, vMul(vNorm(vin), vLen(refIn))); }
            if (vLen(vout) > 1e-9) { p.r = vAdd(p.a, vMul(vNorm(vout), vLen(refOut))); }
        } else {
            if (vLen(refIn) > 1e-9 && vLen(vin) > 1e-9) { p.l = vAdd(p.a, vMul(vNorm(refIn), vLen(vin))); }
            if (vLen(refOut) > 1e-9 && vLen(vout) > 1e-9) { p.r = vAdd(p.a, vMul(vNorm(refOut), vLen(vout))); }
        }
    }
    writePath(f.path, pts, f.path.closed);
    insReselect(f.path, f.sel);
    return "Matched handle " + what + " across " + f.sel.length + " anchors.";
};
