// Load the engine with a minimal Illustrator stub so the pure math is testable.
global.app = { documents: {length:1}, redraw: function(){} };
global.PointType = { SMOOTH:'s', CORNER:'c' };
global.PathPointSelection = { ANCHORPOINT:1, NOSELECTION:0, LEFTRIGHTPOINT:2, LEFTDIRECTION:3, RIGHTDIRECTION:4 };
const path = require('path');
const src = require('fs').readFileSync(path.join(__dirname, 'jsx', 'chisel.jsx'), 'utf8');
eval(src);

let pass=0, fail=0;
function ok(name, cond, extra){ if(cond){pass++;console.log('  PASS',name);} else {fail++;console.log('  FAIL',name, extra||'');} }

console.log('\n[1] Bezier evaluation + split');
const p0=[0,0],p1=[0,50],p2=[100,50],p3=[100,0];
const mid = bezAt(p0,p1,p2,p3,0.5);
ok('midpoint of symmetric curve is centred', Math.abs(mid[0]-50)<1e-9, mid);
const sp = bezSplit(p0,p1,p2,p3,0.5);
ok('split halves rejoin at the same point', vDist(sp.left[3], sp.right[0])<1e-12);
const a=bezAt(p0,p1,p2,p3,0.25), b=bezAt(sp.left[0],sp.left[1],sp.left[2],sp.left[3],0.5);
ok('split left half reparameterises correctly', vDist(a,b)<1e-9, [a,b]);

console.log('\n[2] Arc length vs known circle approximation');
// quarter circle r=100 approximated by bezier, true length = pi*100/2 = 157.0796
const k=0.5522847498*100;
const L=bezLength([100,0],[100,k],[k,100],[0,100],2000);
ok('quarter circle length within 0.05%', Math.abs(L-Math.PI*50)<0.08, L+' vs '+(Math.PI*50));

console.log('\n[3] Tangency roots');
// symmetric arch: top tangency should be exactly t=0.5
const roots = bezDerivRoots(p0,p1,p2,p3,1);
ok('one horizontal tangency found', roots.length===1, roots);
ok('tangency at t=0.5', Math.abs(roots[0]-0.5)<1e-9, roots[0]);
const vroots = bezDerivRoots([0,0],[50,0],[50,100],[0,100],0);
ok('vertical tangency found on S-curve', vroots.length===1, vroots);

console.log('\n[4] Smart removal least-squares fit');
// Build a circle from 8 points, drop one, check deviation is tiny
function circlePts(n,r){
  const pts=[], step=2*Math.PI/n, kk=(4/3)*Math.tan(step/4)*r;
  for(let i=0;i<n;i++){
    const t=i*step, a=[Math.cos(t)*r, Math.sin(t)*r];
    const tang=[-Math.sin(t),Math.cos(t)];
    pts.push(mkPt(a,[a[0]-tang[0]*kk,a[1]-tang[1]*kk],[a[0]+tang[0]*kk,a[1]+tang[1]*kk],'s'));
  }
  return pts;
}
const c8 = circlePts(8,100);
const fit = fitRemoval(c8[0], c8[1], c8[2], 32);
ok('removing 1 of 8 circle points fits within 0.6pt', fit.err < 0.6, 'err='+fit.err.toFixed(4));
const c16 = circlePts(16,100);
const fit16 = fitRemoval(c16[0], c16[1], c16[2], 32);
ok('removing 1 of 16 is much tighter', fit16.err < fit.err/5, 'err='+fit16.err.toFixed(5));

console.log('\n[5] Greedy smartRemove respects tolerance');
let c32 = circlePts(32,100);
const removed = smartRemove(c32, true, 0.05, false, true);
ok('reduced 32-point circle', removed>0, 'removed '+removed+', left '+c32.length);
ok('did not over-reduce below 4 points', c32.length>=4, c32.length);
let c32b = circlePts(32,100);
const removed2 = smartRemove(c32b, true, 5.0, false, true);
ok('looser tolerance removes more', removed2 > removed, removed2+' vs '+removed);

console.log('\n[6] Bezier intersection');
const A=[[0,0],[33,100],[66,100],[100,0]];
const B=[[0,80],[33,-20],[66,-20],[100,80]];
const xs = bezIntersect(A,B,0.01);
ok('found 2 crossings', xs.length===2, JSON.stringify(xs));
if(xs.length===2){
  const pA=bezAt(A[0],A[1],A[2],A[3],xs[0].t1), pB=bezAt(B[0],B[1],B[2],B[3],xs[0].t2);
  ok('crossing points coincide', vDist(pA,pB)<0.05, vDist(pA,pB));
}

console.log('\n[7] Corner geometry');
const g90 = cornerGeometry(Math.PI/2, 20, 'trueRadius');
ok('90deg true-radius trim distance equals radius', Math.abs(g90.d-20)<1e-9, g90.d);
ok('90deg kappa is the circle constant', Math.abs(g90.k-0.5522847498*20)<0.02, g90.k);
const g60 = cornerGeometry(Math.PI/3, 20, 'trueRadius');
ok('sharper angle needs a longer trim', g60.d > g90.d, g60.d);
const gs = cornerGeometry(Math.PI/2, 20, 'squircular');
ok('squircular trims further than true radius', gs.d > g90.d, gs.d);

console.log('\n[8] buildCorner on a square');
const sq = [mkPt([0,0],[0,0],[0,0]), mkPt([100,0],[100,0],[100,0]),
            mkPt([100,100],[100,100],[100,100]), mkPt([0,100],[0,100],[0,100])];
const res = buildCorner(sq, 1, true, 20, 'regular','trueRadius');
ok('corner returns two replacement points', res && res.length===2);
if(res){
  ok('trim lands 20pt back along the leg', Math.abs(vDist(res[0].a,[100,0])-20)<0.2, vDist(res[0].a,[100,0]));
  ok('corner start sits on the bottom edge', Math.abs(res[0].a[1])<0.01, res[0].a);
  ok('corner end sits on the right edge', Math.abs(res[1].a[0]-100)<0.01, res[1].a);
}
const ch = buildCorner([mkPt([0,0],[0,0],[0,0]), mkPt([100,0],[100,0],[100,0]),
            mkPt([100,100],[100,100],[100,100]), mkPt([0,100],[0,100],[0,100])],
            1, true, 20, 'chamfered','trueRadius');
ok('chamfer has no handles', ch && vDist(ch[0].a,ch[0].r)<1e-9);

console.log('\n[9] Roulette maths');
function curveAt(theta,R,D,p,q,kind){
  const S=R*q/p; let x,y,k2;
  if(kind==='epi'){k2=(R+S)/S; x=(R+S)*Math.cos(theta)-D*S*Math.cos(k2*theta); y=(R+S)*Math.sin(theta)-D*S*Math.sin(k2*theta);}
  else {k2=(R-S)/S; x=(R-S)*Math.cos(theta)+D*S*Math.cos(k2*theta); y=(R-S)*Math.sin(theta)-D*S*Math.sin(k2*theta);}
  return [x,y];
}
const start=curveAt(0,200,1,10,3,'hypo'), end=curveAt(2*Math.PI*3,200,1,10,3,'hypo');
ok('hypotrochoid 10:3 closes after 3 turns', vDist(start,end)<1e-6, vDist(start,end));
ok('gcd reduction 16:4 -> 4:1', gcdInt(16,4)===4);

console.log('\n[10] Smoothing algorithm');
const three=[mkPt([0,0],[0,0],[0,0]), mkPt([50,50],[50,50],[50,50]), mkPt([100,0],[100,0],[100,0])];
smoothPoint(three,1,false,0.4);
const inV=vSub(three[1].l,three[1].a), outV=vSub(three[1].r,three[1].a);
ok('generated handles are 180deg opposed', Math.abs(vCross(inV,outV))<1e-9 && vDot(inV,outV)<0, [inV,outV]);
ok('handle direction is horizontal on a symmetric peak', Math.abs(outV[1])<1e-9, outV);
ok('handle length = min(dPrev,dNext)*ratio', Math.abs(vLen(outV)-Math.sqrt(50*50+50*50)*0.4)<1e-9, vLen(outV));

console.log('\n[11] Curvature radius');
const kc=0.5522847498*100;
const rc=bezCurvatureRadius([100,0],[100,kc],[kc,100],[0,100],0.5);
ok('circle bezier curvature radius near 100', Math.abs(rc-100)<1.5, rc);

console.log('\n=== '+pass+' passed, '+fail+' failed ===');
process.exit(fail?1:0);
