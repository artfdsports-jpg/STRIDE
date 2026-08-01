// Constraint solver tests, run against the stub document in test-stub.js.
//
//   node test-constraints.js

const fs = require('fs');
const path = require('path');
const stub = require('./test-stub.js');

stub.install(global);
const load = (f) => eval.call(global, fs.readFileSync(path.join(__dirname, 'jsx', f), 'utf8'));
load('chisel.jsx');
load('chisel-meta.jsx');
load('chisel-tangency.jsx');
load('chisel-constraints.jsx');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); }
}
const near = (a, b, e) => Math.abs(a - b) < (e === undefined ? 1e-6 : e);

function reset() { return app._reset(); }
function anchors(p) {
  const out = [];
  for (const pt of p.pathPoints) { out.push([pt.anchor[0], pt.anchor[1]]); }
  return out;
}
// Worst distance from any anchor to the nearer of two circles.
function offCircles(p, c1, r1, c2, r2) {
  let worst = 0;
  for (const a of anchors(p)) {
    worst = Math.max(worst, Math.min(
      Math.abs(vDist(a, c1) - r1), Math.abs(vDist(a, c2) - r2)));
  }
  return worst;
}

console.log('\n[1] Connecting two circles at their tangents');
{
  const doc = reset();
  const A = stub.addCircle(doc, 0, 0, 50);
  const B = stub.addCircle(doc, 300, 0, 50);
  doc.selection = [A, B];

  const msg = CMD.tanConnect({ style: 'belt' });
  ok('command reports success', /Locked 1 belt/.test(msg), msg);
  ok('a third path now exists', doc.pageItems.length === 3, doc.pageItems.length);

  const belt = doc.selection[0];
  ok('the belt is closed', belt.closed === true);
  ok('the belt is tagged as a link', metaRead(belt).kind === 'tanlink');
  ok('the belt names both drivers',
    metaRead(belt).a === metaRead(A).id && metaRead(belt).b === metaRead(B).id);
  ok('both circles were registered as drivers',
    metaRead(A).kind === 'circle' && metaRead(B).kind === 'circle');
  ok('every belt anchor sits on a driver circle',
    offCircles(belt, [0, 0], 50, [300, 0], 50) < 0.05,
    offCircles(belt, [0, 0], 50, [300, 0], 50));
}

console.log('\n[2] The lock holds when a driver moves');
{
  const doc = reset();
  const A = stub.addCircle(doc, 0, 0, 50);
  const B = stub.addCircle(doc, 300, 0, 50);
  doc.selection = [A, B];
  CMD.tanConnect({ style: 'belt' });
  const belt = doc.selection[0];
  const before = JSON.stringify(anchors(belt));

  stub.movePath(B, -40, 220);           // drag the second circle
  const r = CMD.solveAll();
  ok('solve reports one constraint handled', /Solved 1 of 1/.test(r), r);
  ok('the belt geometry changed', JSON.stringify(anchors(belt)) !== before);
  ok('the belt re-attached to the moved circle',
    offCircles(belt, [0, 0], 50, [260, 220], 50) < 0.05,
    offCircles(belt, [0, 0], 50, [260, 220], 50));
}

console.log('\n[3] The lock holds when a driver is scaled');
{
  const doc = reset();
  const A = stub.addCircle(doc, 0, 0, 50);
  const B = stub.addCircle(doc, 300, 0, 50);
  doc.selection = [A, B];
  CMD.tanConnect({ style: 'belt' });
  const belt = doc.selection[0];

  stub.scalePath(A, 0, 0, 2.4);          // r 50 -> 120, as the scale tool would
  CMD.solveAll();
  ok('the belt followed the new radius',
    offCircles(belt, [0, 0], 120, [300, 0], 50) < 0.12,
    offCircles(belt, [0, 0], 120, [300, 0], 50));

  // The straight runs must still be true common tangents after the rescale.
  const pts = readPath(belt);
  let straights = 0, worst = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    if (vDist(pts[i].a, pts[i].r) < 1e-9 && vDist(pts[j].a, pts[j].l) < 1e-9) {
      straights++;
      const dir = vNorm(vSub(pts[j].a, pts[i].a));
      const from = vDist(pts[i].a, [0, 0]) < vDist(pts[i].a, [300, 0]) ? [0, 0] : [300, 0];
      worst = Math.max(worst, Math.abs(vDot(dir, vNorm(vSub(pts[i].a, from)))));
    }
  }
  ok('two straight runs survive the rescale', straights === 2, straights);
  ok('they are still perpendicular to the radii', worst < 1e-6, worst);
}

console.log('\n[4] Auto-sync settles instead of looping');
{
  const doc = reset();
  const A = stub.addCircle(doc, 0, 0, 50);
  const B = stub.addCircle(doc, 300, 0, 50);
  doc.selection = [A, B];
  CMD.tanConnect({ style: 'belt' });

  let h = CMD.syncHash();
  let r = CMD.syncProbe({ hash: h });
  ok('an untouched document reports no change', /^same/.test(r), r);

  stub.movePath(B, 60, 10);
  r = CMD.syncProbe({ hash: h });
  ok('a moved driver triggers a solve', /^solved\|1\|0/.test(r), r);
  h = r.split('|')[3];
  ok('the probe returns the post-solve hash', !!h && h.length > 0, r);

  // This is the loop that would otherwise burn CPU and flood the undo stack.
  let repeats = 0;
  for (let i = 0; i < 5; i++) {
    const p = CMD.syncProbe({ hash: h });
    if (/^solved/.test(p)) { repeats++; h = p.split('|')[3]; }
  }
  ok('five idle ticks trigger zero further solves', repeats === 0, repeats);
}

console.log('\n[5] Tangent lines rather than a belt');
{
  const doc = reset();
  const A = stub.addCircle(doc, 0, 0, 40);
  const B = stub.addCircle(doc, 250, 90, 70);
  doc.selection = [A, B];
  const msg = CMD.tanConnect({ style: 'lines' });
  ok('two tangents created', /Locked 2 tangents/.test(msg), msg);

  const made = doc.selection;
  ok('each is an open two-point path',
    made.length === 2 && made[0].pathPoints.length === 2 && made[0].closed === false);
  ok('the two sides are distinct',
    JSON.stringify(anchors(made[0])) !== JSON.stringify(anchors(made[1])));

  // Both must be genuine tangents: perpendicular to both radii.
  let worst = 0;
  for (const m of made) {
    const a = anchors(m);
    const dir = vNorm(vSub(a[1], a[0]));
    worst = Math.max(worst,
      Math.abs(vDot(dir, vNorm(vSub(a[0], [0, 0])))),
      Math.abs(vDot(dir, vNorm(vSub(a[1], [250, 90])))));
  }
  ok('both are true common tangents', worst < 1e-9, worst);

  stub.movePath(A, 0, -300);
  CMD.solveAll();
  worst = 0;
  for (const m of made) {
    const a = anchors(m);
    const dir = vNorm(vSub(a[1], a[0]));
    worst = Math.max(worst,
      Math.abs(vDot(dir, vNorm(vSub(a[0], [0, -300])))),
      Math.abs(vDot(dir, vNorm(vSub(a[1], [250, 90])))));
  }
  ok('still true tangents after a driver moves', worst < 1e-9, worst);
}

console.log('\n[6] Crossed belt, and refusing the impossible');
{
  const doc = reset();
  const A = stub.addCircle(doc, 0, 0, 50);
  const B = stub.addCircle(doc, 300, 0, 50);
  doc.selection = [A, B];
  const msg = CMD.tanConnect({ style: 'belt', crossed: true });
  ok('crossed belt built', /Locked 1 belt/.test(msg), msg);
  const belt = doc.selection[0];

  // Push the circles into each other: the crossed tangent stops existing.
  stub.movePath(B, -230, 0);
  const before = JSON.stringify(anchors(belt));
  const r = CMD.solveAll();
  ok('an unsatisfiable constraint is reported, not thrown',
    /cannot be built/.test(r), r);
  ok('unsatisfiable geometry is left alone rather than mangled',
    JSON.stringify(anchors(belt)) === before);

  stub.movePath(B, 230, 0);
  CMD.solveAll();
  ok('it recovers when the circles separate again',
    offCircles(belt, [0, 0], 50, [300, 0], 50) < 0.05);
}

console.log('\n[7] Losing a driver');
{
  const doc = reset();
  const A = stub.addCircle(doc, 0, 0, 50);
  const B = stub.addCircle(doc, 300, 0, 50);
  doc.selection = [A, B];
  CMD.tanConnect({ style: 'belt' });
  const belt = doc.selection[0];
  const before = JSON.stringify(anchors(belt));

  B.remove();
  const r = CMD.solveAll();
  ok('a deleted driver is reported as lost', /lost a driver/.test(r), r);
  ok('the orphaned belt keeps its last good shape',
    JSON.stringify(anchors(belt)) === before);

  doc.selection = [belt];
  ok('it can be released to plain artwork', /Released 1 object/.test(CMD.releaseSelection()));
  ok('the record is gone', metaRead(belt) === null);
}

console.log('\n[8] Tangent circle to two circles');
{
  const doc = reset();
  const A = stub.addCircle(doc, 0, 0, 50);
  const B = stub.addCircle(doc, 300, 0, 50);
  doc.selection = [A, B];
  const msg = CMD.tanCircleAdd({ radius: 120, mode: 'ee' });
  ok('tangent circle placed', /placed and locked/.test(msg), msg);

  const k = doc.selection[0];
  const fit = circleOfPath(k);
  ok('the result is a circle', fit.ok === true);
  ok('radius as asked', near(fit.r, 120, 0.15), fit.r);
  ok('externally tangent to both',
    near(vDist(fit.c, [0, 0]), 170, 0.2) && near(vDist(fit.c, [300, 0]), 170, 0.2),
    [vDist(fit.c, [0, 0]), vDist(fit.c, [300, 0])]);

  stub.movePath(B, 0, 120);
  CMD.solveAll();
  const fit2 = circleOfPath(k);
  ok('it stays tangent after a driver moves',
    near(vDist(fit2.c, [0, 0]), 170, 0.2) && near(vDist(fit2.c, [300, 120]), 170, 0.2),
    [vDist(fit2.c, [0, 0]), vDist(fit2.c, [300, 120])]);

  doc.selection = [A, B];
  ok('an impossible radius is refused with an explanation',
    /No circle of radius/.test(CMD.tanCircleAdd({ radius: 1, mode: 'ee' })));
}

console.log('\n[9] Tangent from a selected anchor');
{
  const doc = reset();
  const C = stub.addCircle(doc, 300, 0, 80);
  const L = stub.addPolyline(doc, [[0, 0], [50, 400]]);
  stub.selectAnchor(L, 0);
  doc.selection = [C, L];

  const msg = CMD.tanFromPoint({ side: 1 });
  ok('tangent from the anchor created', /Tangent locked/.test(msg), msg);
  const line = doc.selection[0];
  const a = anchors(line);
  ok('it starts at the chosen anchor', near(vDist(a[0], [0, 0]), 0, 1e-9), a[0]);
  ok('it ends on the circle', near(vDist(a[1], [300, 0]), 80, 1e-9), vDist(a[1], [300, 0]));
  ok('the radius is perpendicular to it',
    Math.abs(vDot(vNorm(vSub(a[1], a[0])), vNorm(vSub(a[1], [300, 0])))) < 1e-9);

  stub.movePath(L, -100, -60);           // drag the source path
  CMD.solveAll();
  const b = anchors(line);
  ok('the tangent follows the anchor it was attached to',
    near(vDist(b[0], [-100, -60]), 0, 1e-9), b[0]);
  ok('and stays tangent to the circle', near(vDist(b[1], [300, 0]), 80, 1e-9), vDist(b[1], [300, 0]));
}

console.log('\n[10] Tangent continuity locks');
{
  const doc = reset();
  const p = stub.addPolyline(doc, [[0, 0], [100, 100], [200, 0]]);
  // Give the middle point two handles that disagree by 40 degrees.
  p.pathPoints[1].leftDirection = [60, 100];
  p.pathPoints[1].rightDirection = [160, 60];
  stub.selectAnchor(p, 1);
  doc.selection = [p];

  const msg = CMD.lockTangent();
  ok('lock applied to one anchor', /Locked 1 anchor/.test(msg), msg);

  const pts = readPath(p);
  const inDir = vNorm(vSub(pts[1].a, pts[1].l));
  const outDir = vNorm(vSub(pts[1].r, pts[1].a));
  ok('the handles are now collinear', near(vCross(inDir, outDir), 0, 1e-9), vCross(inDir, outDir));
  ok('the point became a smooth point', pts[1].t === 's');
  ok('handle lengths were preserved',
    near(vDist(pts[1].a, pts[1].l), vLen(vSub([60, 100], [100, 100])), 1e-9));

  // A satisfied lock must not rewrite anything, or auto-sync never settles.
  const h1 = CMD.syncHash();
  CMD.solveAll();
  ok('re-solving a satisfied lock is a no-op', CMD.syncHash() === h1);

  // Break it again the way dragging a handle would, and confirm it re-asserts.
  p.pathPoints[1].rightDirection = [180, 20];
  CMD.solveAll();
  const pts2 = readPath(p);
  ok('the lock re-asserts after a handle is dragged',
    near(vCross(vNorm(vSub(pts2[1].a, pts2[1].l)), vNorm(vSub(pts2[1].r, pts2[1].a))), 0, 1e-9));

  doc.selection = [p];
  stub.selectAnchor(p, 1);
  ok('it can be released', /Released 1 tangent lock/.test(CMD.unlockTangent()));
}

console.log('\n[11] Welding two paths together');
{
  const doc = reset();
  const lead = stub.addPolyline(doc, [[0, 0], [100, 0]]);
  const foll = stub.addPolyline(doc, [[105, 5], [200, 60]]);
  stub.selectAnchor(lead, 1);
  stub.selectAnchor(foll, 0);
  doc.selection = [lead, foll];

  const msg = CMD.weldPoints({ g1: false });
  ok('weld created', /Welded anchor/.test(msg), msg);
  ok('the follower snapped to the leader',
    near(vDist(readPath(foll)[0].a, [100, 0]), 0, 1e-9), readPath(foll)[0].a);
  ok('in shape mode the whole follower translates',
    near(vDist(readPath(foll)[1].a, [195, 55]), 0, 1e-9), readPath(foll)[1].a);

  stub.movePath(lead, 30, -70);
  CMD.solveAll();
  ok('the follower tracks the leader',
    near(vDist(readPath(foll)[0].a, [130, -70]), 0, 1e-9), readPath(foll)[0].a);

  const h = CMD.syncHash();
  CMD.solveAll();
  ok('a satisfied weld is a no-op', CMD.syncHash() === h);

  doc.selection = [foll];
  ok('it can be broken', /Broke 1 weld/.test(CMD.unweld()));
  stub.movePath(lead, 500, 0);
  CMD.solveAll();
  ok('after breaking, the follower stays put',
    near(vDist(readPath(foll)[0].a, [130, -70]), 0, 1e-9));
}
{
  // Point mode: only the welded anchor follows, so the follower stretches.
  const doc = reset();
  const lead = stub.addPolyline(doc, [[0, 0], [100, 0]]);
  const foll = stub.addPolyline(doc, [[105, 5], [200, 60]]);
  stub.selectAnchor(lead, 1);
  stub.selectAnchor(foll, 0);
  doc.selection = [lead, foll];
  CMD.weldPoints({ g1: false, mode: 'point' });

  ok('point mode still joins the anchors',
    near(vDist(readPath(foll)[0].a, [100, 0]), 0, 1e-9), readPath(foll)[0].a);
  ok('point mode leaves the far end where it was',
    near(vDist(readPath(foll)[1].a, [200, 60]), 0, 1e-9), readPath(foll)[1].a);

  stub.movePath(lead, 0, -50);
  CMD.solveAll();
  ok('point mode stretches to follow',
    near(vDist(readPath(foll)[0].a, [100, -50]), 0, 1e-9) &&
    near(vDist(readPath(foll)[1].a, [200, 60]), 0, 1e-9), readPath(foll).map(p => p.a));
}
{
  // Tangent matching across a weld: the follower's handle must oppose the
  // leader's, which is what makes two joined paths read as one curve.
  const doc = reset();
  const lead = stub.addPolyline(doc, [[0, 0], [100, 0]]);
  lead.pathPoints[1].leftDirection = [60, -30];      // arriving at 30 deg
  const foll = stub.addPolyline(doc, [[100, 0], [200, 60]]);
  foll.pathPoints[0].rightDirection = [140, 40];     // leaving at some other angle
  stub.selectAnchor(lead, 1);
  stub.selectAnchor(foll, 0);
  doc.selection = [lead, foll];
  CMD.weldPoints({ g1: true, mode: 'point' });

  const L = readPath(lead), F = readPath(foll);
  const inDir = vNorm(vSub(L[1].a, L[1].l));
  const outDir = vNorm(vSub(F[0].r, F[0].a));
  ok('the join is tangent continuous', near(vCross(inDir, outDir), 0, 1e-9), vCross(inDir, outDir));
  ok('and points the same way, not back on itself', vDot(inDir, outDir) > 0, vDot(inDir, outDir));
}

console.log('\n[12] Chained constraints solve in dependency order');
{
  const doc = reset();
  const A = stub.addCircle(doc, 0, 0, 60);
  const B = stub.addCircle(doc, 400, 0, 60);
  doc.selection = [A, B];
  // r must be big enough to reach across: (r1+r) + (r2+r) >= 400 means r >= 140.
  ok('the chained driver was created', /placed and locked/.test(CMD.tanCircleAdd({ radius: 200, mode: 'ee' })));
  const K = doc.selection[0];

  // Now belt the generated circle to circle A. Its driver is itself derived.
  doc.selection = [A, K];
  const msg = CMD.tanConnect({ style: 'belt' });
  ok('a constraint can be built on a generated circle', /Locked 1 belt/.test(msg), msg);
  const belt = doc.selection[0];

  stub.movePath(B, 0, 200);
  CMD.solveAll();

  const kFit = circleOfPath(K);
  ok('the derived circle updated', near(vDist(kFit.c, [400, 200]), 260, 0.3), vDist(kFit.c, [400, 200]));
  ok('the belt on it updated in the same pass',
    offCircles(belt, [0, 0], 60, kFit.c, kFit.r) < 0.2,
    offCircles(belt, [0, 0], 60, kFit.c, kFit.r));
}

console.log('\n[13] Guard rails');
{
  const doc = reset();
  const A = stub.addCircle(doc, 0, 0, 50);
  doc.selection = [A];
  ok('one circle is not enough', /Select exactly two circles/.test(CMD.tanConnect({})));

  const sq = stub.addPolyline(doc, [[0, 0], [100, 0], [100, 100], [0, 100]]);
  sq.closed = true;
  doc.selection = [A, sq];
  ok('a square is rejected with a reason', /is not a circle/.test(CMD.tanConnect({})), CMD.tanConnect({}));

  doc.selection = [];
  ok('constraintsInfo survives an empty selection', /^\d+\|\d+\|\d+\|\d+\|\d+$/.test(CMD.constraintsInfo()));
  ok('solveAll on a clean document says so', /Nothing is locked/.test(CMD.solveAll()));

  ok('dispatcher routes new commands', typeof chiselRun('constraintsInfo', '') === 'string');
  ok('dispatcher still rejects unknown ones', /Unknown command/.test(chiselRun('nope', '')));
}

console.log('\n[14] Constraints inside a group');
{
  const doc = reset();
  const g = doc._group();
  const A = stub.addCircle(doc, 0, 0, 50);
  const B = stub.addCircle(doc, 300, 0, 50);
  for (const c of [A, B]) { c.parent = g; g.pageItems.push(c); }
  doc.selection = [g];
  const msg = CMD.tanConnect({ style: 'belt' });
  ok('drivers are found through the group', /Locked 1 belt/.test(msg), msg);
  ok('the generated path joins the group', doc.selection[0].parent === g);
}

console.log('\n=== ' + pass + ' passed, ' + fail + ' failed ===');
process.exit(fail ? 1 : 0);
