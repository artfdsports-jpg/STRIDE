/*
 * A working stand-in for the slice of the Illustrator DOM that Chisel touches.
 *
 * The constraint solver is the part most likely to break in ways the pure
 * geometry tests cannot see: stale registry caches, a solve that rewrites
 * geometry it did not need to and so re-triggers itself forever, a deleted
 * driver taking down the whole pass. None of that is reachable without a
 * document, and none of it should need Illustrator open to catch.
 *
 * Faithful where it matters:
 *   - pathPoints cannot be inserted at an index, only appended and removed,
 *     which is the constraint writePath is built around
 *   - document.pageItems is flat across groups
 *   - a removed item throws when touched, rather than returning undefined
 */

function install(global) {
  global.PointType = { SMOOTH: 's', CORNER: 'c' };
  global.PathPointSelection = {
    NOSELECTION: 0, ANCHORPOINT: 1, LEFTRIGHTPOINT: 2,
    LEFTDIRECTION: 3, RIGHTDIRECTION: 4
  };

  function mkPathPoints() {
    const arr = [];
    arr.add = function () {
      const p = {
        anchor: [0, 0], leftDirection: [0, 0], rightDirection: [0, 0],
        pointType: global.PointType.CORNER,
        selected: global.PathPointSelection.NOSELECTION
      };
      p.remove = function () {
        const i = arr.indexOf(p);
        if (i >= 0) { arr.splice(i, 1); }
      };
      arr.push(p);
      return p;
    };
    return arr;
  }

  function mkTags() {
    const arr = [];
    arr.add = function () {
      const t = { name: '', value: '' };
      t.remove = function () {
        const i = arr.indexOf(t);
        if (i >= 0) { arr.splice(i, 1); }
      };
      arr.push(t);
      return t;
    };
    return arr;
  }

  function mkPath(doc, parent) {
    const path = {
      typename: 'PathItem',
      closed: false,
      guides: false,
      locked: false,
      hidden: false,
      name: '',
      stroked: true,
      filled: false,
      strokeWidth: 1,
      strokeColor: { red: 0, green: 0, blue: 0 },
      fillColor: { red: 0, green: 0, blue: 0 },
      parent: parent,
      pathPoints: mkPathPoints(),
      tags: mkTags(),
      _dead: false
    };
    Object.defineProperty(path, 'geometricBounds', {
      get: function () {
        if (path._dead) { throw new Error('item has been removed'); }
        let l = 1e12, t = -1e12, r = -1e12, b = 1e12;
        for (const p of path.pathPoints) {
          for (const v of [p.anchor, p.leftDirection, p.rightDirection]) {
            l = Math.min(l, v[0]); r = Math.max(r, v[0]);
            b = Math.min(b, v[1]); t = Math.max(t, v[1]);
          }
        }
        return [l, t, r, b];
      }
    });
    path.remove = function () {
      path._dead = true;
      const i = doc._items.indexOf(path);
      if (i >= 0) { doc._items.splice(i, 1); }
    };
    doc._items.push(path);
    return path;
  }

  function mkGroup(doc, parent) {
    const g = { typename: 'GroupItem', parent: parent, pageItems: [] };
    g.pathItems = { add: () => { const p = mkPath(doc, g); g.pageItems.push(p); return p; } };
    doc._items.push(g);
    return g;
  }

  function newDocument() {
    const doc = { typename: 'Document', name: 'stub.ai', selection: [], _items: [] };
    Object.defineProperty(doc, 'pageItems', { get: () => doc._items });
    doc.pathItems = { add: () => mkPath(doc, doc) };
    doc.artboards = [{ artboardRect: [0, 800, 600, 0] }];
    Object.defineProperty(doc.artboards, 'length', { value: 1 });
    doc._group = () => mkGroup(doc, doc);
    return doc;
  }

  const doc = newDocument();
  global.app = {
    documents: { length: 1 },
    activeDocument: doc,
    redraw: function () {},
    _reset: function () {
      const d = newDocument();
      global.app.activeDocument = d;
      return d;
    }
  };
  return global.app;
}

// Write a four-point bezier circle into a fresh path on the active document.
const KAPPA = 0.5522847498307936;
function addCircle(doc, cx, cy, r) {
  const p = doc.pathItems.add();
  for (let i = 0; i < 4; i++) {
    const th = i * Math.PI / 2;
    const a = [cx + r * Math.cos(th), cy + r * Math.sin(th)];
    const t = [-Math.sin(th) * r * KAPPA, Math.cos(th) * r * KAPPA];
    const pt = p.pathPoints.add();
    pt.anchor = a;
    pt.leftDirection = [a[0] - t[0], a[1] - t[1]];
    pt.rightDirection = [a[0] + t[0], a[1] + t[1]];
    pt.pointType = 's';
  }
  p.closed = true;
  return p;
}

// Open polyline with corner points, for lock and weld tests.
function addPolyline(doc, coords) {
  const p = doc.pathItems.add();
  for (const c of coords) {
    const pt = p.pathPoints.add();
    pt.anchor = [c[0], c[1]];
    pt.leftDirection = [c[0], c[1]];
    pt.rightDirection = [c[0], c[1]];
    pt.pointType = 'c';
  }
  p.closed = false;
  return p;
}

// Translate every coordinate on a path, the way dragging it would.
function movePath(p, dx, dy) {
  for (const pt of p.pathPoints) {
    pt.anchor = [pt.anchor[0] + dx, pt.anchor[1] + dy];
    pt.leftDirection = [pt.leftDirection[0] + dx, pt.leftDirection[1] + dy];
    pt.rightDirection = [pt.rightDirection[0] + dx, pt.rightDirection[1] + dy];
  }
}

// Scale about a centre, the way the scale tool would.
function scalePath(p, cx, cy, f) {
  const s = (v) => [cx + (v[0] - cx) * f, cy + (v[1] - cy) * f];
  for (const pt of p.pathPoints) {
    pt.anchor = s(pt.anchor);
    pt.leftDirection = s(pt.leftDirection);
    pt.rightDirection = s(pt.rightDirection);
  }
}

function selectAnchor(p, i) {
  for (let k = 0; k < p.pathPoints.length; k++) {
    p.pathPoints[k].selected = (k === i) ? 1 : 0;
  }
}

module.exports = { install, addCircle, addPolyline, movePath, scalePath, selectAnchor };
