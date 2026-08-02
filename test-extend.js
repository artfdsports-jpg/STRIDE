// Path extension and struck-tangent tests.
//
//   node test-extend.js

const fs = require('fs');
const path = require('path');
const stub = require('./test-stub.js');

stub.install(global);
const load = (f) => eval.call(global, fs.readFileSync(path.join(__dirname, 'jsx', f), 'utf8'));
load('chisel.jsx');
load('chisel-meta.jsx');
load('chisel-tangency.jsx');
load('chisel-constraints.jsx');
load('chisel-inspector.jsx');
load('chisel-extend.jsx');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); }
}
const near = (a, b, e) => Math.abs(a - b) < (e === undefined ? 1e-6 : e);
const reset = () => app._reset();

// Total arc length of a path, measured independently of the engine's own
// bookkeeping so a length assertion is not just checking its own arithmetic.
function measure(p) {
  const pts = readPath(p);
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const s = segOf(pts, i, false);
    total += bezLength(s[0], s[1], s[2], s[3], 400);
  }
  return total;
}
function ends(p) {
  const pts = readPath(p);
  return [pts[0].a, pts[pts.length - 1].a];
}
// Unit tangent arriving at the far end, and leaving the near end.
function endTangent(p, atStart) {
  const pts = readPath(p);
  const i = atStart ? 0 : pts.length - 2;
  const s = segOf(pts, i, false);
  return vNorm(bezD1(s[0], s[1], s[2], s[3], atStart ? 0 : 1));
}

// A quarter circle of radius 100, centred at the origin, from (100,0) to (0,100).
const KAPPA = 0.5522847498307936;
function quarterArc(doc, r) {
  const p = doc.pathItems.add();
  const k = KAPPA * r;
  const a = p.pathPoints.add();
  a.anchor = [r, 0]; a.leftDirection = [r, 0]; a.rightDirection = [r, k]; a.pointType = 's';
  const b = p.pathPoints.add();
  b.anchor = [0, r]; b.leftDirection = [k, r]; b.rightDirection = [0, r]; b.pointType = 's';
  p.closed = false;
  return p;
}

console.log('\n[1] Straight extension');
{
  const doc = reset();
  const p = stub.addPolyline(doc, [[0, 0], [100, 0]]);
  doc.selection = [p];

  const msg = CMD.extendPath({ mode: 'straight', length: 50, which: 'end' });
  ok('reports what it did', /Extended 1 path by 50/.test(msg), msg);
  ok('the line is 150 long', near(measure(p), 150, 1e-4), measure(p));
  ok('it grew from the correct end', near(ends(p)[1][0], 150, 1e-9), ends(p)[1]);
  ok('the other end did not move', near(ends(p)[0][0], 0, 1e-9));
}
{
  const doc = reset();
  const p = stub.addPolyline(doc, [[0, 0], [100, 0]]);
  doc.selection = [p];
  CMD.extendPath({ mode: 'straight', length: 50, which: 'start' });
  ok('extending the start grows backwards', near(ends(p)[0][0], -50, 1e-9), ends(p)[0]);
  ok('and leaves the end alone', near(ends(p)[1][0], 100, 1e-9));
}
{
  const doc = reset();
  const p = stub.addPolyline(doc, [[0, 0], [100, 0]]);
  doc.selection = [p];
  CMD.extendPath({ mode: 'straight', length: 25, which: 'both' });
  ok('both ends grow', near(ends(p)[0][0], -25, 1e-9) && near(ends(p)[1][0], 125, 1e-9), ends(p));
  ok('total length is right', near(measure(p), 150, 1e-4), measure(p));
}
{
  // A straight extension off a curve must leave along the tangent, or the join
  // is a visible kink.
  const doc = reset();
  const p = quarterArc(doc, 100);
  doc.selection = [p];
  const before = endTangent(p, false);
  CMD.extendPath({ mode: 'straight', length: 40, which: 'end' });
  const pts = readPath(p);
  const dir = vNorm(vSub(pts[pts.length - 1].a, pts[pts.length - 2].a));
  ok('the straight run leaves along the end tangent',
    near(vCross(before, dir), 0, 1e-6) && vDot(before, dir) > 0, [before, dir]);
  ok('and it is the right length', near(measure(p), Math.PI * 50 + 40, 0.05), measure(p));
}

console.log('\n[2] Constant radius extension');
{
  const doc = reset();
  const p = quarterArc(doc, 100);
  doc.selection = [p];

  const msg = CMD.extendPath({ mode: 'radius', length: 100, which: 'end' });
  ok('reports the mode', /constant radius arc/.test(msg), msg);

  // Every point of the extension must still be 100 from the origin: that is
  // what "constant radius" means, and it is the whole assertion.
  const pts = readPath(p);
  let worst = 0;
  for (let i = 1; i < pts.length; i++) {
    for (let t = 0; t <= 1.0001; t += 0.1) {
      const s = segOf(pts, i - 1, false);
      worst = Math.max(worst, Math.abs(vLen(bezAt(s[0], s[1], s[2], s[3], t)) - 100));
    }
  }
  ok('the extension stays on the same circle', worst < 0.05, worst);
  ok('length grew by exactly the amount asked',
    near(measure(p), Math.PI * 50 + 100, 0.1), measure(p));

  // 100pt of a radius-100 arc is one radian past the quarter turn.
  const endPt = ends(p)[1];
  const expected = [100 * Math.cos(Math.PI / 2 + 1), 100 * Math.sin(Math.PI / 2 + 1)];
  ok('and it ended in the right place', vDist(endPt, expected) < 0.1, [endPt, expected]);
}
{
  // Both ends of the same arc must curl the same way round. Deriving the turn
  // direction from the outward tangent rather than the geometry mirrors one of
  // them, which is the bug this catches.
  const doc = reset();
  const p = quarterArc(doc, 100);
  doc.selection = [p];
  CMD.extendPath({ mode: 'radius', length: 60, which: 'both' });
  const pts = readPath(p);
  let worst = 0;
  for (const q of pts) { worst = Math.max(worst, Math.abs(vLen(q.a) - 100)); }
  ok('extending both ends keeps every anchor on the circle', worst < 0.05, worst);
  ok('the path is longer at both ends', near(measure(p), Math.PI * 50 + 120, 0.1), measure(p));
}
{
  // A straight path has no curvature to continue, so radius mode has to fall
  // back to straight rather than dividing by a radius of infinity.
  const doc = reset();
  const p = stub.addPolyline(doc, [[0, 0], [100, 0]]);
  doc.selection = [p];
  CMD.extendPath({ mode: 'radius', length: 50, which: 'end' });
  ok('a straight path extends straight in radius mode',
    near(ends(p)[1][0], 150, 1e-6) && near(ends(p)[1][1], 0, 1e-6), ends(p)[1]);
}

console.log('\n[3] Single bezier extension');
{
  const doc = reset();
  const p = quarterArc(doc, 100);
  doc.selection = [p];
  const before = readPath(p).length;

  CMD.extendPath({ mode: 'bezier', length: 40, which: 'end' });
  ok('no anchor was added', readPath(p).length === before, readPath(p).length);
  ok('the path is 40 longer', near(measure(p), Math.PI * 50 + 40, 0.05), measure(p));
  ok('the fixed end did not move', near(vDist(ends(p)[0], [100, 0]), 0, 1e-9), ends(p)[0]);
}
{
  const doc = reset();
  const p = quarterArc(doc, 100);
  doc.selection = [p];
  CMD.extendPath({ mode: 'bezier', length: 40, which: 'start' });
  ok('extending the start moves the start anchor',
    vDist(ends(p)[0], [100, 0]) > 30, ends(p)[0]);
  ok('and leaves the end anchor alone', near(vDist(ends(p)[1], [0, 100]), 0, 1e-9), ends(p)[1]);
  ok('length is right', near(measure(p), Math.PI * 50 + 40, 0.05), measure(p));
}
{
  // Extrapolating a cubic follows the shape its own control points imply, so a
  // straight segment must stay exactly straight however far it is pushed.
  const doc = reset();
  const p = stub.addPolyline(doc, [[0, 0], [100, 0]]);
  doc.selection = [p];
  CMD.extendPath({ mode: 'bezier', length: 400, which: 'end' });
  ok('a straight segment extrapolates straight',
    near(ends(p)[1][0], 500, 1e-3) && near(ends(p)[1][1], 0, 1e-9), ends(p)[1]);
}
{
  const doc = reset();
  const p = quarterArc(doc, 100);
  doc.selection = [p];
  CMD.extendPath({ mode: 'bezier', length: -40, which: 'end' });
  ok('a negative length in bezier mode shortens',
    near(measure(p), Math.PI * 50 - 40, 0.05), measure(p));
}

console.log('\n[4] Spiral extension');
{
  const doc = reset();
  const p = quarterArc(doc, 100);
  doc.selection = [p];

  const msg = CMD.extendPath({ mode: 'spiral', length: 200, winding: 0.3, which: 'end' });
  ok('spiral built', /Extended 1 path/.test(msg), msg);
  ok('length is close to what was asked', near(measure(p), Math.PI * 50 + 200, 3), measure(p));

  // A spiral opens out: distance from the original centre must grow, and the
  // curvature at the join must start matched at 100.
  const pts = readPath(p);
  const first = segOf(pts, 1, false);
  const rStart = bezCurvatureRadius(first[0], first[1], first[2], first[3], 0);
  ok('curvature is continuous at the join', near(rStart, 100, 6), rStart);

  const last = segOf(pts, pts.length - 2, false);
  const rEnd = bezCurvatureRadius(last[0], last[1], last[2], last[3], 1);
  ok('and opens out along the spiral', rEnd > rStart * 1.5, [rStart, rEnd]);
}
{
  // Winding zero is a circle. Rather than dividing by it, the spiral falls back
  // to the constant radius arc, which is the same shape.
  const doc = reset();
  const p = quarterArc(doc, 100);
  doc.selection = [p];
  CMD.extendPath({ mode: 'spiral', length: 100, winding: 0, which: 'end' });
  const pts = readPath(p);
  let worst = 0;
  for (const q of pts) { worst = Math.max(worst, Math.abs(vLen(q.a) - 100)); }
  ok('zero winding degrades to a circular arc', worst < 0.05, worst);
}
{
  const doc = reset();
  const p = stub.addPolyline(doc, [[0, 0], [100, 0]]);
  doc.selection = [p];
  CMD.extendPath({ mode: 'spiral', length: 50, winding: 0.3, which: 'end' });
  ok('a straight path spirals into a straight run, not a crash',
    near(ends(p)[1][0], 150, 1e-6), ends(p)[1]);
}

console.log('\n[5] Trimming');
{
  const doc = reset();
  const p = stub.addPolyline(doc, [[0, 0], [100, 0], [200, 0], [300, 0]]);
  doc.selection = [p];

  const msg = CMD.extendPath({ mode: 'straight', length: -50, which: 'end' });
  ok('reports a trim, not an extension', /Trimmed 1 path by 50/.test(msg), msg);
  ok('the path is 250 long', near(measure(p), 250, 1e-4), measure(p));
  ok('the far end moved in', near(ends(p)[1][0], 250, 1e-4), ends(p)[1]);
}
{
  const doc = reset();
  const p = stub.addPolyline(doc, [[0, 0], [100, 0], [200, 0], [300, 0]]);
  doc.selection = [p];
  CMD.extendPath({ mode: 'straight', length: -150, which: 'end' });
  ok('a trim spanning a whole segment drops its anchor',
    readPath(p).length === 3, readPath(p).length);
  ok('and lands at the right place', near(ends(p)[1][0], 150, 1e-4), ends(p)[1]);
}
{
  const doc = reset();
  const p = stub.addPolyline(doc, [[0, 0], [100, 0], [200, 0]]);
  doc.selection = [p];
  CMD.extendPath({ mode: 'straight', length: -60, which: 'start' });
  // The arc-length table is inverted by linear interpolation between samples,
  // so a trim lands within a thousandth of a point rather than exactly. That is
  // three orders of magnitude below anything visible at any zoom.
  ok('trimming from the start moves the start',
    near(ends(p)[0][0], 60, 1e-2), ends(p)[0]);
  ok('and leaves the end', near(ends(p)[1][0], 200, 1e-9));
}
{
  const doc = reset();
  const p = quarterArc(doc, 100);
  doc.selection = [p];
  CMD.extendPath({ mode: 'radius', length: -50, which: 'end' });
  ok('a curve trims by arc length', near(measure(p), Math.PI * 50 - 50, 0.05), measure(p));
  ok('and what remains is still on the circle',
    Math.abs(vLen(ends(p)[1]) - 100) < 0.05, vLen(ends(p)[1]));
}

console.log('\n[6] Several paths at once');
{
  const doc = reset();
  const a = stub.addPolyline(doc, [[0, 0], [100, 0]]);
  const b = stub.addPolyline(doc, [[0, 50], [80, 50]]);
  const c = stub.addPolyline(doc, [[0, 90], [60, 90]]);
  doc.selection = [a, b, c];

  const msg = CMD.extendPath({ mode: 'straight', length: 30, which: 'end' });
  ok('all three extended', /Extended 3 paths/.test(msg), msg);
  ok('each grew by the same amount',
    near(measure(a), 130, 1e-4) && near(measure(b), 110, 1e-4) && near(measure(c), 90, 1e-4),
    [measure(a), measure(b), measure(c)]);
}
{
  const doc = reset();
  const open = stub.addPolyline(doc, [[0, 0], [100, 0]]);
  const shut = stub.addCircle(doc, 300, 0, 40);
  doc.selection = [open, shut];
  const msg = CMD.extendPath({ mode: 'straight', length: 20, which: 'end' });
  ok('closed paths are skipped and counted', /1 closed path was skipped/.test(msg), msg);
  ok('the open one still extended', near(measure(open), 120, 1e-4), measure(open));
}
{
  const doc = reset();
  const shut = stub.addCircle(doc, 0, 0, 40);
  doc.selection = [shut];
  ok('a selection of only closed paths explains itself',
    /Only open paths can be extended/.test(CMD.extendPath({ length: 20 })));
  doc.selection = [];
  ok('an empty selection explains itself',
    /Select one or more open paths/.test(CMD.extendPath({ length: 20 })));
  const p = stub.addPolyline(doc, [[0, 0], [10, 0]]);
  doc.selection = [p];
  ok('a zero length is refused', /Length is zero/.test(CMD.extendPath({ length: 0 })));
}

console.log('\n[7] Tangent and normal lines struck from a path');
{
  const doc = reset();
  const p = quarterArc(doc, 100);
  stub.selectAnchor(p, 0);
  doc.selection = [p];

  const msg = CMD.tangentLine({ length: 50, side: 'both', mode: 'tangent', lock: true });
  ok('reports what it struck', /Tangent struck at anchor 1 and locked/.test(msg), msg);

  const line = doc.selection[0];
  const a = readPath(line);
  ok('it is a two point run', a.length === 2);
  ok('it is centred on the anchor',
    near(vDist([(a[0].a[0] + a[1].a[0]) / 2, (a[0].a[1] + a[1].a[1]) / 2], [100, 0]), 0, 1e-6));
  ok('it is 100 long for a length of 50 each way', near(vDist(a[0].a, a[1].a), 100, 1e-6));

  // At (100,0) on a circle centred at the origin, the tangent is vertical.
  const dir = vNorm(vSub(a[1].a, a[0].a));
  ok('and it really is tangent there', Math.abs(dir[0]) < 1e-6, dir);
}
{
  const doc = reset();
  const p = quarterArc(doc, 100);
  stub.selectAnchor(p, 0);
  doc.selection = [p];
  CMD.tangentLine({ length: 50, mode: 'normal', lock: false });
  const a = readPath(doc.selection[0]);
  const dir = vNorm(vSub(a[1].a, a[0].a));
  ok('a normal is perpendicular to the tangent', Math.abs(dir[1]) < 1e-6, dir);
  ok('unlocked when asked', metaRead(doc.selection[0]) === null);
}
{
  const doc = reset();
  const p = quarterArc(doc, 100);
  stub.selectAnchor(p, 0);
  doc.selection = [p];
  CMD.tangentLine({ length: 50, side: 'forward' });
  const a = readPath(doc.selection[0]);
  ok('one-sided starts at the anchor', near(vDist(a[0].a, [100, 0]), 0, 1e-9), a[0].a);
  ok('and runs one length', near(vDist(a[0].a, a[1].a), 50, 1e-6));
}
{
  // The lock is the point: edit the reference and the struck line follows.
  const doc = reset();
  const p = quarterArc(doc, 100);
  stub.selectAnchor(p, 0);
  doc.selection = [p];
  CMD.tangentLine({ length: 50, lock: true });
  const line = doc.selection[0];

  stub.movePath(p, 0, 300);
  CMD.solveAll();
  const a = readPath(line);
  ok('the struck line followed its reference',
    near(vDist([(a[0].a[0] + a[1].a[0]) / 2, (a[0].a[1] + a[1].a[1]) / 2], [100, 300]), 0, 1e-6),
    a.map(q => q.a));

  const h = CMD.syncHash();
  CMD.solveAll();
  ok('and a satisfied strike is a no-op', CMD.syncHash() === h);

  p.remove();
  ok('losing the reference is reported, not thrown', /lost a driver/.test(CMD.solveAll()));
}
{
  // Struck part way along a segment rather than at the anchor.
  const doc = reset();
  const p = quarterArc(doc, 100);
  stub.selectAnchor(p, 0);
  doc.selection = [p];
  CMD.tangentLine({ length: 40, at: 0.5, lock: false });
  const a = readPath(doc.selection[0]);
  const mid = [(a[0].a[0] + a[1].a[0]) / 2, (a[0].a[1] + a[1].a[1]) / 2];
  ok('it sits halfway round the arc', near(vLen(mid), 100, 0.1), vLen(mid));
  ok('at 45 degrees', near(Math.atan2(mid[1], mid[0]), Math.PI / 4, 0.02),
    Math.atan2(mid[1], mid[0]));
  const dir = vNorm(vSub(a[1].a, a[0].a));
  ok('and is tangent to the circle there', Math.abs(vDot(dir, vNorm(mid))) < 1e-3, vDot(dir, vNorm(mid)));
}
{
  const doc = reset();
  const p = stub.addPolyline(doc, [[0, 0], [100, 0]]);
  doc.selection = [p];
  ok('an anchor is required', /Select the anchor/.test(CMD.tangentLine({ length: 10 })));
  stub.selectAnchor(p, 0);
  ok('a zero length is refused', /Length must be greater/.test(CMD.tangentLine({ length: 0 })));
}

console.log('\n[8] Extensions leave the path usable');
{
  // Whatever mode was used, the join must be smooth and the result must still
  // read back as a well-formed open path.
  const doc = reset();
  for (const mode of ['straight', 'radius', 'bezier', 'spiral']) {
    const d = reset();
    const p = quarterArc(d, 100);
    d.selection = [p];
    CMD.extendPath({ mode: mode, length: 60, winding: 0.25, which: 'end' });
    const pts = readPath(p);
    ok(`${mode}: still open`, p.closed === false);
    ok(`${mode}: at least two points`, pts.length >= 2, pts.length);
    ok(`${mode}: no anchor sits on top of its neighbour`,
      pts.every((q, i) => i === 0 || vDist(q.a, pts[i - 1].a) > 1e-6));

    // Tangent continuity across the original endpoint.
    const j = pts.length;
    if (mode !== 'bezier' && j >= 3) {
      const inSeg = segOf(pts, 0, false);
      const outSeg = segOf(pts, 1, false);
      // bezTangent, not the raw first derivative: a straight run is stored with
      // retracted handles, which makes d1 exactly zero at its start even though
      // the segment has a perfectly good direction.
      const t1 = bezTangent(inSeg[0], inSeg[1], inSeg[2], inSeg[3], 1);
      const t2 = bezTangent(outSeg[0], outSeg[1], outSeg[2], outSeg[3], 0);
      ok(`${mode}: the join is tangent continuous`,
        near(vCross(t1, t2), 0, 1e-5) && vDot(t1, t2) > 0, [t1, t2]);
    }
  }
}

console.log('\n=== ' + pass + ' passed, ' + fail + ' failed ===');
process.exit(fail ? 1 : 0);
