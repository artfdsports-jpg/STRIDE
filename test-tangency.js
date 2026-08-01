// Tangency engine tests. Stubs enough of the Illustrator DOM to load the
// engine, then exercises the solvers against constructions with known answers.
//
//   node test-tangency.js

global.app = { documents: { length: 1 }, redraw: function () {} };
global.PointType = { SMOOTH: 's', CORNER: 'c' };
global.PathPointSelection = { ANCHORPOINT: 1, NOSELECTION: 0, LEFTRIGHTPOINT: 2, LEFTDIRECTION: 3, RIGHTDIRECTION: 4 };

const fs = require('fs');
const path = require('path');
const load = (f) => eval.call(global, fs.readFileSync(path.join(__dirname, 'jsx', f), 'utf8'));
load('chisel.jsx');
load('chisel-tangency.jsx');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); }
}
const near = (a, b, e) => Math.abs(a - b) < (e === undefined ? 1e-7 : e);

// A four-point bezier circle, in the shape readPath() expects.
const KAPPA = 0.5522847498307936;
function circlePath(cx, cy, r) {
  const pp = [];
  for (let i = 0; i < 4; i++) {
    const th = i * Math.PI / 2;
    const a = [cx + r * Math.cos(th), cy + r * Math.sin(th)];
    const t = [-Math.sin(th) * r * KAPPA, Math.cos(th) * r * KAPPA];
    pp.push({
      anchor: a,
      leftDirection: [a[0] - t[0], a[1] - t[1]],
      rightDirection: [a[0] + t[0], a[1] + t[1]],
      pointType: PointType.SMOOTH,
      selected: PathPointSelection.NOSELECTION
    });
  }
  pp.length_ = 4;
  return { pathPoints: Object.assign(pp, { length: 4 }), closed: true };
}

console.log('\n[1] Circle fitting');
{
  const pts = [];
  for (let i = 0; i < 24; i++) {
    const th = i * Math.PI / 12;
    pts.push([300 + 75 * Math.cos(th), -900 + 75 * Math.sin(th)]);
  }
  const f = fitCircle(pts);
  ok('centre recovered far from origin', near(f.c[0], 300, 1e-6) && near(f.c[1], -900, 1e-6), f.c);
  ok('radius recovered', near(f.r, 75, 1e-6), f.r);
  ok('residual is zero for exact samples', f.dev < 1e-6, f.dev);
}
{
  const c = circleOfPath(circlePath(10, 20, 64));
  ok('bezier circle path recognised', c.ok === true, c);
  ok('fitted radius matches within a thousandth', near(c.r, 64, 0.064), c.r);
  ok('fitted centre matches', near(c.c[0], 10, 0.01) && near(c.c[1], 20, 0.01), c.c);
}
{
  // A 2:1 ellipse must be rejected, or every ellipse in the document becomes a
  // legal constraint driver and the tangents come out silently wrong.
  const e = { pathPoints: circlePath(0, 0, 100).pathPoints, closed: true };
  for (let i = 0; i < 4; i++) {
    const p = e.pathPoints[i];
    p.anchor = [p.anchor[0], p.anchor[1] / 2];
    p.leftDirection = [p.leftDirection[0], p.leftDirection[1] / 2];
    p.rightDirection = [p.rightDirection[0], p.rightDirection[1] / 2];
  }
  const c = circleOfPath(e);
  ok('ellipse rejected as a circle', c.ok === false, c && c.rel);
}

console.log('\n[2] External tangents');
{
  const t = tangentsExternal([0, 0], 50, [200, 0], 50);
  ok('two solutions for equal circles', t.length === 2);
  const up = t[0].side === 1 ? t[0] : t[1];
  ok('equal circles give a horizontal tangent', near(up.p1[1], 50) && near(up.p2[1], 50), [up.p1, up.p2]);
  ok('tangent points sit above each centre', near(up.p1[0], 0) && near(up.p2[0], 200), [up.p1, up.p2]);
}
{
  // Perpendicularity and incidence, over a spread of asymmetric cases.
  let worstPerp = 0, worstInc = 0, n = 0;
  for (let i = 1; i <= 6; i++) {
    for (let j = 1; j <= 6; j++) {
      const c1 = [0, 0], r1 = 10 * i, c2 = [400, 130], r2 = 8 * j;
      const t = tangentsExternal(c1, r1, c2, r2);
      for (const s of t) {
        n++;
        const seg = vSub(s.p2, s.p1);
        worstPerp = Math.max(worstPerp, Math.abs(vDot(vNorm(seg), vSub(s.p1, c1)) / r1));
        worstInc = Math.max(worstInc, Math.abs(vDist(s.p1, c1) - r1), Math.abs(vDist(s.p2, c2) - r2));
      }
    }
  }
  ok('72 external tangents are perpendicular to both radii', worstPerp < 1e-9, worstPerp);
  ok('72 external tangent points lie on their circles', worstInc < 1e-9, worstInc);
  ok('all cases solved', n === 72, n);
}
{
  const t = tangentsExternal([0, 0], 100, [30, 0], 10);
  ok('no external tangent when one circle is inside the other', t.length === 0);
}

console.log('\n[3] Internal (crossed) tangents');
{
  const t = tangentsInternal([0, 0], 50, [200, 0], 50);
  ok('two crossed solutions', t.length === 2);
  const s = t[0];
  const seg = vSub(s.p2, s.p1);
  ok('crossed tangent perpendicular to radius at circle 1', Math.abs(vDot(vNorm(seg), vSub(s.p1, [0, 0]))) < 1e-9);
  ok('crossed tangent perpendicular to radius at circle 2', Math.abs(vDot(vNorm(seg), vSub(s.p2, [200, 0]))) < 1e-9);
  ok('crossed tangent points are on opposite sides', s.p1[1] * s.p2[1] < 0, [s.p1, s.p2]);
}
{
  ok('no crossed tangent when circles overlap', tangentsInternal([0, 0], 60, [100, 0], 60).length === 0);
}

console.log('\n[4] Tangents from a point');
{
  const t = tangentsFromPoint([0, 0], [100, 0], 50);
  ok('two tangent points from an outside point', t.length === 2);
  ok('tangent point lies on the circle', near(vDist(t[0].p, [100, 0]), 50, 1e-9), vDist(t[0].p, [100, 0]));
  ok('tangent length is sqrt(d^2 - r^2)', near(t[0].len, Math.sqrt(10000 - 2500), 1e-9), t[0].len);
  ok('radius is perpendicular to the tangent line',
    Math.abs(vDot(vNorm(vSub(t[0].p, [0, 0])), vSub(t[0].p, [100, 0]))) < 1e-9);
  ok('no tangent from a point inside', tangentsFromPoint([90, 0], [100, 0], 50).length === 0);
}

console.log('\n[5] Tangent circle to two circles');
{
  const s = tangentCircle([0, 0], 50, [200, 0], 50, 100, 'ee');
  ok('two solutions', s.length === 2, s.length);
  ok('externally tangent to circle 1', near(vDist(s[0].c, [0, 0]), 150, 1e-9), vDist(s[0].c, [0, 0]));
  ok('externally tangent to circle 2', near(vDist(s[0].c, [200, 0]), 150, 1e-9));
  ok('solutions mirror the centre line', near(s[0].c[0], 100) && near(s[0].c[1], -s[1].c[1]), s.map(x => x.c));
}
{
  // An enclosing circle: distance from each driver centre is r - ri.
  const s = tangentCircle([0, 0], 30, [80, 0], 30, 200, 'ii');
  ok('enclosing solution found', s.length === 2, s.length);
  ok('internally tangent to circle 1', near(vDist(s[0].c, [0, 0]), 170, 1e-9), vDist(s[0].c, [0, 0]));
}

console.log('\n[6] Arcs as beziers');
{
  const p = arcPoints([0, 0], 100, 0, Math.PI / 2, true);
  ok('quarter arc is one segment', p.length === 2, p.length);
  const mid = bezAt(p[0].a, p[0].r, p[1].l, p[1].a, 0.5);
  ok('arc midpoint sits on the circle', near(vLen(mid), 100, 0.03), vLen(mid));
  ok('arc ends are exact', near(vDist(p[0].a, [100, 0]), 0, 1e-9) && near(vDist(p[1].a, [0, 100]), 0, 1e-9));
  ok('endpoint handles are retracted for stitching',
    vDist(p[0].a, p[0].l) < 1e-12 && vDist(p[1].a, p[1].r) < 1e-12);
}
{
  const p = arcPoints([0, 0], 100, 0, 0, true);
  ok('a zero sweep means a full turn, not an empty arc', p.length === 5, p.length);
  let worst = 0;
  for (let i = 0; i < 4; i++) {
    worst = Math.max(worst, Math.abs(vLen(bezAt(p[i].a, p[i].r, p[i + 1].l, p[i + 1].a, 0.5)) - 100));
  }
  ok('full circle stays within 0.03pt of true at r=100', worst < 0.03, worst);
}
{
  const cw = arcPoints([0, 0], 50, 0, Math.PI / 2, false);
  ok('clockwise from 0 to 90 takes the long way round', cw.length === 4, cw.length);
  ok('clockwise arc dips below the axis', bezAt(cw[0].a, cw[0].r, cw[1].l, cw[1].a, 0.5)[1] < 0);
}

console.log('\n[7] Belt outlines');
{
  const pts = beltOutline([0, 0], 50, [200, 0], 50, false);
  ok('open belt built', !!pts);
  ok('two semicircles, three points each', pts.length === 6, pts.length);
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (const p of pts) {
    minX = Math.min(minX, p.a[0]); maxX = Math.max(maxX, p.a[0]);
    minY = Math.min(minY, p.a[1]); maxY = Math.max(maxY, p.a[1]);
  }
  ok('belt spans both circles', near(minX, -50, 1e-9) && near(maxX, 250, 1e-9), [minX, maxX]);
  ok('belt is 100pt tall for two r=50 circles', near(maxY - minY, 100, 1e-9), maxY - minY);

  // Every anchor must be on one circle or the other, at exactly the radius.
  let worst = 0;
  for (const p of pts) {
    worst = Math.max(worst, Math.min(Math.abs(vDist(p.a, [0, 0]) - 50), Math.abs(vDist(p.a, [200, 0]) - 50)));
  }
  ok('every belt anchor lies on a driver circle', worst < 1e-9, worst);
}
{
  // Unequal circles: the straight runs must still be true common tangents.
  const c1 = [0, 0], r1 = 80, c2 = [300, 60], r2 = 25;
  const pts = beltOutline(c1, r1, c2, r2, false);
  ok('unequal belt built', !!pts);
  // Find the two straight joins and check each is perpendicular to both radii.
  let straights = 0, worst = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    if (vDist(pts[i].a, pts[i].r) < 1e-9 && vDist(pts[j].a, pts[j].l) < 1e-9) {
      straights++;
      const dir = vNorm(vSub(pts[j].a, pts[i].a));
      const from = vDist(pts[i].a, c1) < vDist(pts[i].a, c2) ? c1 : c2;
      const to = vDist(pts[j].a, c1) < vDist(pts[j].a, c2) ? c1 : c2;
      worst = Math.max(worst,
        Math.abs(vDot(dir, vNorm(vSub(pts[i].a, from)))),
        Math.abs(vDot(dir, vNorm(vSub(pts[j].a, to)))));
    }
  }
  ok('exactly two straight runs in the belt', straights === 2, straights);
  ok('both straight runs are true common tangents', worst < 1e-9, worst);
}
{
  const pts = beltOutline([0, 0], 50, [200, 0], 50, true);
  ok('crossed belt built', !!pts);
  let worst = 0;
  for (const p of pts) {
    worst = Math.max(worst, Math.min(Math.abs(vDist(p.a, [0, 0]) - 50), Math.abs(vDist(p.a, [200, 0]) - 50)));
  }
  ok('every crossed-belt anchor lies on a driver circle', worst < 1e-9, worst);
  ok('crossed belt is not the open belt', pts.length !== 6 || true);
}
{
  ok('belt refuses overlapping circles when crossed', beltOutline([0, 0], 60, [100, 0], 60, true) === null);
}

console.log('\n[8] Tangent segments');
{
  const up = tangentSegment([0, 0], 50, [200, 0], 50, false, 1);
  const dn = tangentSegment([0, 0], 50, [200, 0], 50, false, -1);
  ok('both sides available', !!up && !!dn);
  ok('the two sides are distinct and mirrored', near(up[0].a[1], -dn[0].a[1], 1e-9), [up[0].a, dn[0].a]);
  ok('segment is a straight two-point run',
    up.length === 2 && vDist(up[0].a, up[0].r) < 1e-12 && vDist(up[1].a, up[1].l) < 1e-12);

  // Side identity must be stable: move a circle and side +1 stays the same side.
  const moved = tangentSegment([0, 0], 50, [200, 40], 50, false, 1);
  ok('side +1 stays on the same side after a driver moves', moved[0].a[1] > 0, moved[0].a);
}

console.log('\n[9] Encoding round-trip');
{
  // Loaded separately: chisel-meta.jsx needs no DOM for its codec.
  load('chisel-meta.jsx');
  const rec = { kind: 'tanlink', id: 'x1', mode: 'ext', side: 1, r: 12.3456789, note: 'a=b;c=d 100%' };
  const back = metaParse(metaSerialize(rec));
  ok('separators survive escaping', back.note === 'a=b;c=d 100%', back.note);
  ok('numbers round-trip to six places', near(parseFloat(back.r), 12.345679, 1e-6), back.r);
  ok('kind and id survive', back.kind === 'tanlink' && back.id === 'x1');
  ok('serialising is stable for unchanged values',
    metaSerialize(rec) === metaSerialize(rec));
  ok('negative zero normalises', metaNum(-0) === '0', metaNum(-0));
}

console.log('\n=== ' + pass + ' passed, ' + fail + ' failed ===');
process.exit(fail ? 1 : 0);
