# Chisel build checkpoint

Running log so work can resume after an interruption. **Update this file in the
same commit as the code it describes.** Newest phase at the bottom.

## Goal

Turn Chisel from a button panel into something that behaves like a VectorScribe
class path tool: a live point/segment editor, and a tangency constraint system
where shapes stay locked to each other's tangents when they move.

## Ground truth about what is and is not possible

| Capability | CEP (this repo, ships today) | Needs C++ SDK |
|---|---|---|
| Read/write every anchor, handle, path | yes | - |
| Live numeric point + handle + segment editor | yes | - |
| Tangent solving, tangent locking, re-solve on move | yes (poll driven) | - |
| Parametric objects stored in the document | yes (art tags) | - |
| A cursor in Illustrator's toolbar | no | yes |
| Red rubber band preview during a drag | no | yes |
| Modifier keys sampled mid-gesture | no | yes |

So "path tool" is delivered in two layers. The CEP layer is the real, installable
one. `native/` holds the C++ source for the toolbar cursor that only the SDK can
provide.

## Phase log

### P0 - baseline (done)
Chisel 1.0.1 vendored unchanged. `test-geometry.js` had an absolute path baked
in; now resolves relative to `__dirname`. 29 assertions pass.

Files: as shipped.

### P1 - module loader + metadata store (done)
`chisel.jsx` grew a `chiselBoot(folder)` that `$.evalFile`s sibling modules and
reports per-module failure. This matters more than tidiness: ExtendScript
refuses to define *anything* in a file with a syntax error, so without the
split, one typo in the tangency solver killed the whole panel.

`jsx/chisel-meta.jsx`: flat `key=value;key=value` codec (no JSON in ES3), stored
in each page item's Tags collection so records survive save/reopen and stay out
of the user-visible note field. Stable IDs, document-wide registry scan.

Version bumped to 2.0.0.

### P2 - tangency solvers (done)
`jsx/chisel-tangency.jsx`, pure geometry, no document state:
Kasa circle fit + recognition (rejects ellipses), external and internal common
tangents between two circles, tangents from a point, circle tangent to two
circles in all four inside/outside modes, exact bezier arcs, and the belt
outline - the closed "two circles joined at their tangents" shape.

`test-tangency.js`: 59 assertions, all passing. Run with `node test-tangency.js`.
Caught one real bug: the half angle for a tangent from an external point is
asin(r/d), not acos.

### P3 - constraint graph and solver (done)
`jsx/chisel-constraints.jsx`. This is the layer that makes tangency *stick*.

Records can carry several roles at once (a path can be a tangent link, hold
tangent locks on its own anchors, and be welded to a neighbour), so the solve
runs in three waves: generated geometry, then welds, then tangent locks.

Constraint kinds: `tanlink` (belt or single tangent between two circles),
`tancircle` (circle of given radius tangent to two others), `tanline` (tangent
from a live anchor to a circle), plus `locks` (G1 continuity) and `weld` fields
on any record.

Auto-sync: `CMD.syncProbe` digests driver bounds, re-solves only on change, and
returns the *post-solve* digest so an idle document costs one cheap call.

`test-stub.js` is a working Illustrator DOM stand-in - it is what makes any of
this testable. `test-constraints.js`: 73 assertions.

Four real bugs caught here:
- the sync reply was `status|ok|broken|hash` while the hash itself contained
  `|`, so the panel never recovered the digest and re-solved forever. Hash is
  now a short FNV digest.
- `circleOfPath` fitted sampled curve points, but Illustrator's circles bulge
  0.027% between anchors, so every radius came out slightly large. Now fits
  anchors and uses samples only to verify.
- registering an already-parametric circle as a driver stamped `kind=circle`
  over its own record, destroying the constraint that generated it.
- a satisfied lock still rewrote its path, which moved the change digest and
  made auto-sync solve on every tick. Locks and welds are now true no-ops when
  already satisfied, and there is a test that fails if that regresses.

`npm test` runs all three suites. 161 assertions, all passing.
