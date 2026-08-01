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

### P4 - live point inspector (done)
`jsx/chisel-inspector.jsx`. The numeric half of a path tool: anchor X/Y, both
handle lengths and angles, adjoining segment lengths, curvature radius either
side of the anchor, path length and enclosed area - all readable, all typable.

Two conventions, both matching what the user sees rather than what the DOM
stores: coordinates are artboard-relative with Y increasing downward, and
angles are measured in that same flipped space. Everything crossing that
boundary is converted in one place.

Typed values apply to the whole anchor selection, which is what makes typing
one X into six anchors the fastest alignment tool in the program. Values that
differ across the selection come back flagged as mixed rather than showing the
first one.

Also: nudge (anchor, or one handle alone), step through anchors, insert on a
segment by arc length or by bezier t, match handle lengths/angles.

Area uses Green's theorem with 3-point Gauss-Legendre, which is *exact* for
cubics - shoelace over a sampled polygon under-reports a circle by 0.6%.

`test-inspector.js`: 62 assertions. 223 total across four suites.

### P5 - panel rebuilt around the path tool (done)
Four tabs (Path, Tangency, Shape, Make) replacing the single accordion, which
had outgrown itself. Path opens on the inspector; Tangency holds connect,
tangent circle, tangent from point, locks, welds and sync.

`CMD.tick` does the whole live refresh in one bridge call - reading the anchor
and re-solving constraints - because CEP's bridge is the slow part of a panel,
not the geometry. Read-only commands no longer trigger `app.redraw`, which was
costing frames on every poll.

The poll guards against overlap (`LIVE.busy`), never overwrites a field the
user is typing into, and refreshes the stored fingerprint after every command
so the next tick cannot fire a spurious solve and undo step.

`test-panel.js`: 23 static wiring assertions. A CEP panel fails *silently* -
a button pointing at a missing command does nothing, and a renamed field id
kills the controller mid-refresh with no error anywhere the user will look. It
checks markup against controller against engine, and that the jsx stays inside
the ES3 dialect ExtendScript accepts.

246 assertions across five suites.

### P6 - native plugin (done, with an honest split)
`native/` replaces the old aspirational ROADMAP with actual source.

**`native/core/` is verified.** No Illustrator types, builds with any C++17
compiler, 88 assertions passing, zero warnings under `-Wall -Wextra -Wpedantic`:

```bash
cmake -S native/core -B native/core/build && cmake --build native/core/build
./native/core/build/chisel_core_tests
```

It holds the geometry plus the things that only matter once there is a cursor
and so have no equivalent in the panel: closest point on a curve (coarse sweep
then Newton - Newton alone settles on the wrong lobe of an S-curve), hit testing
with anchors outranking segments, snap resolution ordered by *kind* before
distance so the snap does not flicker between two near-equal targets, and a
spatial hash for coincident anchors so welding is not O(n*m) on mouse-up.

**`native/src/` is not verified** and says so in `native/README.md`. It is the
SDK bridge and has never been compiled, because that needs Adobe's SDK, which
cannot be redistributed. Real suite names and signatures, but treat it as a
worked specification. Letter-key modifiers during a drag are deliberately *not*
implemented rather than guessed at - Shift/Option/Command are read from
`message->event->modifiers` every tick, which is solid.

The dictionary metadata encoding matches `jsx/chisel-meta.jsx` exactly, so
constraints survive moving between the panel and the plugin.

334 assertions across six suites.
