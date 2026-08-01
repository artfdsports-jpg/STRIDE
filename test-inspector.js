// Live point inspector tests.
//
//   node test-inspector.js

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

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); }
}
const near = (a, b, e) => Math.abs(a - b) < (e === undefined ? 1e-6 : e);
const reset = () => app._reset();
const read = (o) => metaParse(CMD.inspect(o || {}));
const N = (rec, k) => parseFloat(rec[k]);

// The stub artboard is [left 0, top 800, right 600, bottom 0].

console.log('\n[1] Coordinates as the user sees them');
{
  const doc = reset();
  const p = stub.addPolyline(doc, [[100, 700], [300, 500]]);
  stub.selectAnchor(p, 0);
  doc.selection = [p];

  const r = read({ space: 'artboard', units: 'pt' });
  ok('state reported', r.state === 'ok', r);
  ok('focused anchor is the selected one', N(r, 'idx') === 0, r.idx);
  ok('X is measured from the artboard left', near(N(r, 'x'), 100), r.x);
  ok('Y counts downward from the artboard top', near(N(r, 'y'), 100), r.y);

  const d = read({ space: 'doc', units: 'pt' });
  ok('document space reports the raw DOM Y', near(N(d, 'y'), 700), d.y);

  const mm = read({ space: 'artboard', units: 'mm' });
  ok('millimetres convert', near(N(mm, 'x'), 100 / 2.834645669, 1e-6), mm.x);
}

console.log('\n[2] Handle length and angle readout');
{
  const doc = reset();
  const p = stub.addPolyline(doc, [[0, 400], [200, 400], [400, 400]]);
  // Out handle 50pt along +X; in handle 30pt straight up the screen (DOM +Y).
  p.pathPoints[1].rightDirection = [250, 400];
  p.pathPoints[1].leftDirection = [200, 430];
  stub.selectAnchor(p, 1);
  doc.selection = [p];

  const r = read({ space: 'artboard' });
  ok('out handle length', near(N(r, 'outLen'), 50), r.outLen);
  ok('in handle length', near(N(r, 'inLen'), 30), r.inLen);
  ok('out handle angle is zero along +X', near(N(r, 'outAng'), 0), r.outAng);
  ok('a handle pointing up the screen reads as -90 in artboard space',
    near(N(r, 'inAng'), -90), r.inAng);

  const d = read({ space: 'doc' });
  ok('the same handle reads +90 in document space', near(N(d, 'inAng'), 90), d.inAng);
}

console.log('\n[3] Segment lengths and path totals');
{
  const doc = reset();
  const p = stub.addPolyline(doc, [[0, 0], [100, 0], [100, 200]]);
  stub.selectAnchor(p, 1);
  doc.selection = [p];

  const r = read({});
  ok('previous segment length', near(N(r, 'segPrev'), 100, 1e-4), r.segPrev);
  ok('next segment length', near(N(r, 'segNext'), 200, 1e-4), r.segNext);
  ok('total path length', near(N(r, 'len'), 300, 1e-4), r.len);
  ok('an open path reports no area', near(N(r, 'area'), 0), r.area);
  ok('point count', N(r, 'pts') === 3);
  ok('open path flagged', N(r, 'closed') === 0);
}
{
  const doc = reset();
  const c = stub.addCircle(doc, 0, 0, 100);
  doc.selection = [c];
  const r = read({});
  ok('a circle reports its circumference', near(N(r, 'len'), 2 * Math.PI * 100, 0.5), r.len);
  // The residual 0.028% is the bezier circle's own outward bulge, not
  // integration error: the area of the drawn shape really is that much larger
  // than the ideal circle it approximates.
  ok('and its area', near(N(r, 'area'), Math.PI * 10000, 12), r.area);
  ok('closed path flagged', N(r, 'closed') === 1);
  ok('no anchor selected reports idx -1', N(r, 'idx') === -1);
}
{
  // A polygon has an exactly known area, so this is the control that proves the
  // integration is exact rather than merely close.
  const doc = reset();
  const sq = stub.addPolyline(doc, [[0, 0], [100, 0], [100, 100], [0, 100]]);
  sq.closed = true;
  doc.selection = [sq];
  ok('a square reports its area exactly', N(read({}), 'area') === 10000, read({}).area);
}

console.log('\n[4] Typing values back');
{
  const doc = reset();
  const p = stub.addPolyline(doc, [[0, 400], [200, 400]]);
  p.pathPoints[0].rightDirection = [50, 400];
  stub.selectAnchor(p, 0);
  doc.selection = [p];

  CMD.applyPoint({ space: 'artboard', units: 'pt', x: 20, y: 50 });
  const pts = readPath(p);
  ok('X applied through artboard space', near(pts[0].a[0], 20), pts[0].a);
  ok('Y applied through artboard space', near(pts[0].a[1], 750), pts[0].a);
  ok('the handle rode along with the anchor',
    near(vDist(pts[0].a, pts[0].r), 50), vDist(pts[0].a, pts[0].r));

  ok('the selection survives the rewrite', readPath(p)[0].sel === true);
}
{
  const doc = reset();
  const p = stub.addPolyline(doc, [[0, 0], [200, 0]]);
  p.pathPoints[0].rightDirection = [50, 0];
  stub.selectAnchor(p, 0);
  doc.selection = [p];

  CMD.applyPoint({ space: 'artboard', outLen: 80 });
  ok('handle length applied, direction kept',
    near(vDist(readPath(p)[0].a, readPath(p)[0].r), 80) && near(readPath(p)[0].r[1], 0),
    readPath(p)[0].r);

  CMD.applyPoint({ space: 'artboard', outAng: -90 });
  const q = readPath(p)[0];
  ok('handle angle applied in screen terms', near(q.r[0], 0) && near(q.r[1], 80), q.r);
  ok('and the length was preserved', near(vDist(q.a, q.r), 80));
}
{
  // One X into several anchors is how you align them.
  const doc = reset();
  const p = stub.addPolyline(doc, [[10, 0], [40, 100], [70, 200]]);
  for (let i = 0; i < 3; i++) { p.pathPoints[i].selected = 1; }
  doc.selection = [p];

  const r = read({ space: 'artboard' });
  ok('a mixed X is flagged rather than shown as one value', N(r, 'mixX') === 1, r.mixX);

  CMD.applyPoint({ space: 'artboard', x: 500 });
  const pts = readPath(p);
  ok('X applied to every selected anchor',
    pts.every(q => near(q.a[0], 500)), pts.map(q => q.a));
  ok('Y left alone because it was not sent',
    near(pts[0].a[1], 0) && near(pts[2].a[1], 200), pts.map(q => q.a));
  ok('all three stay selected', pts.every(q => q.sel === true));
}

console.log('\n[5] Nudging');
{
  const doc = reset();
  const p = stub.addPolyline(doc, [[0, 400], [200, 400]]);
  p.pathPoints[0].rightDirection = [50, 400];
  stub.selectAnchor(p, 0);
  doc.selection = [p];

  CMD.nudgePoint({ space: 'artboard', dx: 0, dy: 10 });
  ok('nudging down on screen decreases the DOM Y',
    near(readPath(p)[0].a[1], 390), readPath(p)[0].a);

  CMD.nudgePoint({ space: 'artboard', dx: 5, dy: 0, target: 'out' });
  const q = readPath(p)[0];
  ok('the out handle moved on its own', near(q.r[0], 55) && near(q.a[0], 0), [q.a, q.r]);

  ok('a zero nudge is refused rather than logging a no-op undo step',
    /Nothing to nudge/.test(CMD.nudgePoint({ dx: 0, dy: 0 })));
}

console.log('\n[6] Stepping through anchors');
{
  const doc = reset();
  const p = stub.addPolyline(doc, [[0, 0], [100, 0], [200, 0], [300, 0]]);
  doc.selection = [p];
  stub.selectAnchor(p, 0);

  ok('next moves forward', /Anchor 2 of 4/.test(CMD.stepPoint({ to: 'next' })));
  ok('and again', /Anchor 3 of 4/.test(CMD.stepPoint({ to: 'next' })));
  ok('prev moves back', /Anchor 2 of 4/.test(CMD.stepPoint({ to: 'prev' })));
  ok('last jumps to the end', /Anchor 4 of 4/.test(CMD.stepPoint({ to: 'last' })));
  ok('an open path clamps at the end instead of wrapping',
    /Anchor 4 of 4/.test(CMD.stepPoint({ to: 'next' })));
  ok('first jumps home', /Anchor 1 of 4/.test(CMD.stepPoint({ to: 'first' })));
  ok('and clamps at the start', /Anchor 1 of 4/.test(CMD.stepPoint({ to: 'prev' })));
}
{
  const doc = reset();
  const c = stub.addCircle(doc, 0, 0, 50);
  doc.selection = [c];
  stub.selectAnchor(c, 3);
  ok('a closed path wraps round', /Anchor 1 of 4/.test(CMD.stepPoint({ to: 'next' })));
}

console.log('\n[7] Inserting on a segment');
{
  const doc = reset();
  const p = stub.addPolyline(doc, [[0, 0], [300, 0]]);
  stub.selectAnchor(p, 0);
  doc.selection = [p];

  CMD.insertOnSegment({ at: 0.5, mode: 'length' });
  const pts = readPath(p);
  ok('a point was added', pts.length === 3, pts.length);
  ok('at the midpoint', near(pts[1].a[0], 150, 1e-4), pts[1].a);
  ok('the new point is selected', pts[1].sel === true);
  ok('the shape is unchanged: ends still where they were',
    near(pts[0].a[0], 0) && near(pts[2].a[0], 300));
}
{
  // Arc length and bezier t genuinely differ on a lopsided curve.
  const doc = reset();
  const p = stub.addPolyline(doc, [[0, 0], [300, 0]]);
  p.pathPoints[0].rightDirection = [290, 0];
  p.pathPoints[1].leftDirection = [295, 0];
  stub.selectAnchor(p, 0);
  doc.selection = [p];

  CMD.insertOnSegment({ at: 0.5, mode: 't' });
  const byT = readPath(p)[1].a[0];

  const doc2 = reset();
  const q = stub.addPolyline(doc2, [[0, 0], [300, 0]]);
  q.pathPoints[0].rightDirection = [290, 0];
  q.pathPoints[1].leftDirection = [295, 0];
  stub.selectAnchor(q, 0);
  doc2.selection = [q];
  CMD.insertOnSegment({ at: 0.5, mode: 'length' });
  const byLen = readPath(q)[1].a[0];

  ok('arc length and bezier t land in different places', Math.abs(byT - byLen) > 5, [byT, byLen]);
  ok('arc length halfway is actually halfway', near(byLen, 150, 2), byLen);
}
{
  const doc = reset();
  const c = stub.addCircle(doc, 0, 0, 100);
  doc.selection = [c];
  stub.selectAnchor(c, 3);
  CMD.insertOnSegment({ at: 0.5 });
  const pts = readPath(c);
  ok('inserting on the wrapping segment of a closed path appends at the end',
    pts.length === 5 && near(vDist(pts[4].a, [0, 0]), 100, 0.1), pts[4] && pts[4].a);
}
{
  const doc = reset();
  const p = stub.addPolyline(doc, [[0, 0], [100, 0]]);
  stub.selectAnchor(p, 1);
  doc.selection = [p];
  ok('inserting past the end of an open path is refused',
    /no segment after it/.test(CMD.insertOnSegment({ at: 0.5 })));
}

console.log('\n[8] Matching handles across a selection');
{
  const doc = reset();
  const p = stub.addPolyline(doc, [[0, 0], [100, 0], [200, 0]]);
  p.pathPoints[0].rightDirection = [40, 0];
  p.pathPoints[1].rightDirection = [110, 0];
  p.pathPoints[2].rightDirection = [205, 0];
  for (let i = 0; i < 3; i++) { p.pathPoints[i].selected = 1; }
  doc.selection = [p];

  CMD.matchHandles({ what: 'length' });
  const pts = readPath(p);
  ok('all out handles now match the reference length',
    near(vDist(pts[1].a, pts[1].r), 40) && near(vDist(pts[2].a, pts[2].r), 40),
    pts.map(q => vDist(q.a, q.r)));

  ok('two anchors are needed', /two or more/.test(CMD.matchHandles({ what: 'length' })) === false);
}

console.log('\n[9] Locks show up in the readout');
{
  const doc = reset();
  const p = stub.addPolyline(doc, [[0, 0], [100, 100], [200, 0]]);
  p.pathPoints[1].leftDirection = [60, 100];
  p.pathPoints[1].rightDirection = [160, 60];
  stub.selectAnchor(p, 1);
  doc.selection = [p];

  ok('unlocked to begin with', N(read({}), 'locked') === 0);
  CMD.lockTangent();
  stub.selectAnchor(p, 1);
  const r = read({});
  ok('the focused anchor reports its lock', N(r, 'locked') === 1, r.locked);
  ok('the path reports how many it has', N(r, 'locks') === 1, r.locks);
}

console.log('\n[10] Empty and degenerate cases');
{
  const doc = reset();
  doc.selection = [];
  ok('nothing selected reports state none', read({}).state === 'none');
  ok('applyPoint says what to do', /Select at least one anchor/.test(CMD.applyPoint({ x: 1 })));
  ok('stepPoint says what to do', /Select a path first/.test(CMD.stepPoint({})));

  const p = stub.addPolyline(doc, [[0, 0], [10, 0]]);
  stub.selectAnchor(p, 0);
  doc.selection = [p];
  ok('applying nothing is refused', /Nothing to apply/.test(CMD.applyPoint({ space: 'artboard' })));
  ok('a retracted handle reports zero length rather than a stray angle',
    N(read({}), 'inLen') === 0 && read({}).hasIn === '0');
}

console.log('\n=== ' + pass + ' passed, ' + fail + ' failed ===');
process.exit(fail ? 1 : 0);
