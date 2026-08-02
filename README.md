# Chisel

Precision path tools and tangency constraints for Adobe Illustrator 2025 and
later (ILST 29.0+, including 2026).

Chisel 1.0 was a panel of operations. 2.0 adds the two things that make it feel
like a tool rather than a button board: a **live point inspector** you can type
into, and **tangency constraints that stay locked** when the shapes they were
built from move.

---

## The headline: two circles, joined at their tangents, locked

Draw two circles. Select both. Tangency tab, **Connect at tangents**.

You get one closed outline wrapping both circles and joined along their common
tangents — a pulley, a capsule, a chain link. Then move either circle, or scale
it, or drag it with the plain selection tool, and the outline rebuilds itself.
Scale one circle to twice the size and the tangent lines re-solve to touch it
correctly.

The circles are recognised by fitting, not by a flag Chisel had to put there
first, so an ellipse you drew three years ago is a valid driver. And the drivers
are re-measured from their actual paths on every solve rather than read back
from stored numbers, which is why resizing with Illustrator's own tools works —
none of them had to know Chisel exists.

The same section also gives you:

| | |
|---|---|
| **Two tangents** / **One tangent** | the straight common tangents on their own, as open paths, still locked |
| **Crossed** | the tangents that pass *between* the circles, giving a crossed belt |
| **Tangent circle** | a new circle of a chosen radius touching both selected circles, in all four inside/outside combinations |
| **Tangent from a point** | select a circle plus one anchor on another path; the tangent stays attached to that anchor as it moves |

When a constraint stops being satisfiable — you push two circles into each other
so their crossed tangent no longer exists — Chisel says so and leaves the
geometry alone. Separate them again and it recovers.

---

## Extending a path

Path tab, **Extend path**. Select any open paths and continue them along their
own direction. Four modes, because those are the four things "continue this
path" can sensibly mean:

- **Bezier** — the terminal cubic's parameter range is pushed past its end. No
  anchor is added; the curve you already drew simply gets longer, following
  exactly the shape its own control points imply.
- **Arc** — a circular arc continuing the curvature the path already has there.
  Curvature continuous, not merely smooth, so there is no visible flat spot at
  the join.
- **Straight** — a straight run along the end tangent.
- **Spiral** — a logarithmic spiral that starts at the path's own curvature and
  opens out at the winding rate you set.

**Trim** takes the same length off the same end, in any mode, splitting a
segment or dropping whole ones as needed. That is how you cut something back to
a measured length instead of guessing with the direct selection tool.

Every selected open path is extended at once, by the same amount — a technical
drawing has a dozen leader lines that all want to reach the same margin, and
doing them one at a time is how a feature stops getting used. Closed paths in
the selection are skipped and counted rather than silently ignored.

## Striking a tangent off a path

Path tab, **Tangent from a path**. Select an anchor and strike a tangent — or a
normal — from it, in either direction or both. Set *along next segment* above
zero to strike from a point part way along the curve instead of at the anchor,
positioned by arc length.

Locked, the line follows when the path it was struck from is edited: move the
path, reshape it, drag the anchor, and the tangent stays tangent.

For tangents *between two circles* rather than off a single path, see the
Tangency tab.

## The path tool

The Path tab is a live readout of the anchor you have selected, and every value
in it is editable.

- **X and Y**, artboard-relative with Y running down the screen, matching the
  Transform panel rather than the scripting DOM
- **In and out handle length and angle**, which Illustrator will show you
  nowhere and let you type nowhere
- **Segment lengths** either side of the anchor
- **Radius of curvature** arriving at and leaving the anchor. Where the two
  differ you have a curvature break — the thing that shows up as a seam in a
  gradient or a highlight and is otherwise very hard to see
- **Path length** and **enclosed area**

Typed values apply to **every selected anchor**, which makes typing one X into
six anchors the fastest alignment tool in the program. Where a value differs
across the selection it is shown dimmed rather than showing you the first one,
so committing a field cannot quietly flatten the rest.

Also on that tab: nudge by an exact step (the anchor, or one handle on its own,
which is the thing that is genuinely impossible to do accurately by dragging),
step through anchors one at a time, insert a point part way along a segment by
arc length or by bezier *t*, and match handle lengths or angles across a
selection.

---

## Locks

**Tangent continuity.** Select anchors, Tangency tab, **Lock anchors**. Their
two handles are forced collinear on every solve, so a curve you drew smooth
stays smooth through every later edit — including edits made with Illustrator's
own direct selection tool.

**Weld.** Holds an anchor on one path to an anchor on another. Select two paths
with one anchor selected on each; the first leads. Two modes, and they are
genuinely different operations:

- *Whole shape follows* — the second path travels with the first, keeping its
  shape. This is what people mean by locking two shapes together.
- *Only the anchor follows* — the second path stretches to stay attached. This
  is what you want when joining the end of one open path to another.

With tangent matching on, the join also reads as one continuous curve.

---

## Sync, and its one real cost

Illustrator tells extensions nothing about edits as they happen. There is no
event for "the user moved something". So Chisel polls: it fingerprints the
bounds of everything a constraint depends on, and re-solves only when that
fingerprint changes.

The consequence you will notice: **each rebuild is one undo step.** Move a
circle, and the belt rebuild is a separate entry from the move. Turn auto-sync
off in the Tangency tab while working on something unrelated, and press **Solve
now** when you want to catch up.

An idle document costs one small call every 350ms and no solve at all. There is
a test that fails if a satisfied constraint ever re-solves itself, because the
first version of this did exactly that and never settled.

---

## Install

### 1. Add CSInterface.js

Chisel does not bundle Adobe's library. Download `CSInterface.js` from Adobe's
official repository and drop it into `Chisel/js/`:

```
https://github.com/Adobe-CEP/CEP-Resources
  → CEP_12.x/CSInterface.js
```

**Use the CEP 12 build.** Illustrator moved to CEP 12 at version 29.5, and 2026
(30.x) is firmly on it. The CEP 11 copy of this file is the single most common
cause of a panel that loads its frame but stays blank.

### 2. Enable unsigned extensions

**macOS:**
```bash
defaults write com.adobe.CSXS.12 PlayerDebugMode 1
killall cfprefsd
```

**Windows** (Registry Editor):
```
HKEY_CURRENT_USER\Software\Adobe\CSXS.12   →  PlayerDebugMode  (String)  = 1
```

### 3. Copy the folder

Put the whole `Chisel` folder into the CEP extensions directory:

- macOS, per user: `~/Library/Application Support/Adobe/CEP/extensions/`
- macOS, all users: `/Library/Application Support/Adobe/CEP/extensions/`
- Windows, per user: `%APPDATA%\Adobe\CEP\extensions\`
- Windows, all users: `C:\Program Files (x86)\Common Files\Adobe\CEP\extensions\`

### 4. Restart Illustrator

**Window > Extensions > Chisel**.

### If the panel does not appear, or loads blank

1. **Wrong CSInterface build.** CEP 12, not CEP 11. This produces exactly the
   "frame renders, contents blank" symptom.
2. **Stale CEP cache.** Illustrator 2026 caches aggressively and will keep
   serving a failed load. Quit, then delete
   `~/Library/Caches/CSXS` and `~/Library/Application Support/Adobe/CEP/CEF`
   (Windows: `%LOCALAPPDATA%\Temp\cep_cache` and `%APPDATA%\Adobe\CEP\CEF`).
3. **macOS Sequoia file access.** Keep the extension in the per-user path rather
   than the system-wide one, and grant Illustrator Full Disk Access if anything
   still misbehaves.
4. **Read the log**, at `~/Library/Logs/CSXS/CEP12-ILST.log` (Windows:
   `%TEMP%\CEP12-ILST.log`). Raise verbosity first with
   `defaults write com.adobe.CSXS.12 LogLevel 6`.

If the status bar shows a **boot error** naming a module, that module failed to
parse and only its features are missing — the rest of the panel still works.
That is the point of loading them separately.

---

## Everything else in the box

| Tab | Operations |
|---|---|
| **Path** | Live point inspector, nudge, step, insert on segment, match handles. Extend or trim open paths in four modes. Strike tangents and normals off a path. Point reduction (tolerance-driven, handle-compensated). Smooth, corner, retract, swap, equalise, straighten, average. Handle scale/rotate/increment/set length/set angle. Add points by equal arc length, bezier *t*, or fixed distance |
| **Tangency** | Connect circles, tangent circle, tangent from a point, tangent continuity locks, welds, sync. Axis tangencies: add points where a curve runs level or upright, or move existing points there |
| **Shape** | Corners in regular, negative and chamfered types across true radius, standard and squircular methods. Close/open/reverse/split/connect. Add points at path intersections. Select by corner, smooth, grow, shrink, invert, or a skip/take pattern |
| **Make** | Roulette curves (epitrochoid and hypotrochoid, single or interpolated series), Delaunay triangulation |

Most operations follow one rule: **if you have anchor points selected, Chisel
works on those. If you only have whole objects selected, it works on the entire
path.** That is how you scope a corner radius to two corners instead of eight.

Everything runs through Illustrator's normal undo.

### Tolerance

The Clean slider runs 1 to 100 and maps to allowed curve deviation, where 10 is
roughly 0.5 pt. Start low. Push it up until the shape starts to matter, then
back off one notch. For type outlines and logo work, 5 to 15 is the useful band.

### Corner methods

- **True radius** builds a genuine circular arc, constant radius, tangent to
  both legs. For technical drawing and anything that has to measure correctly.
- **Standard** reproduces Illustrator's own Round Corners: fixed trim distance
  and a circular handle constant regardless of angle, so the radius varies away
  from 90 degrees. Use it to match existing native artwork.
- **Squircular** trims further back with softer handles, approximating a
  superellipse blend. Best on rectangles and modern app iconography.

Unlike the native Round Corners effect, Chisel trims along the actual segment by
arc length, so corners adjacent to curves do not distort.

### Roulette

Ratio R:S is reduced automatically, so 16:4 behaves the same as 4:1. Accuracy 1
to 5 sets samples per turn (24 to 384); points are placed with exact cubic
Hermite handles, so even accuracy 2 tracks the true curve closely. Parameters
are written into the path's Note field, visible in the Attributes panel, so you
can rebuild artwork later.

---

## The native plugin

A tool that lives in the toolbar, draws a preview while you drag, and responds
to modifier keys mid-gesture cannot be built in CEP — Illustrator exposes tool
tracking and canvas annotation only through the C++ SDK, and UXP is still not
publicly available for Illustrator. `native/` holds that layer.

Its geometry core is real and tested: 121 assertions, builds anywhere with a
C++17 compiler, no SDK required. In the native tool, dragging the end anchor of
an open path extends it live rather than moving it, with the same four modes. The SDK bridge is written but has never been
compiled, because building it needs Adobe's SDK, which cannot be redistributed.
`native/README.md` is explicit about which is which.

---

## Development

```bash
npm test                                    # 326 assertions, six suites

cmake -S native/core -B native/core/build   # 121 more, no SDK needed
cmake --build native/core/build
./native/core/build/chisel_core_tests
```

Debug the panel in Chrome at `http://localhost:8099` while Illustrator is
running (port set in `.debug`).

`test-stub.js` is a working stand-in for the slice of the Illustrator DOM Chisel
touches — path points that can only be appended and removed, a flat `pageItems`,
art tags, removed items that throw. It is what makes the constraint solver
testable without Illustrator open, and it caught four bugs that would otherwise
have shipped.

`test-panel.js` checks the panel's wiring statically. A CEP panel fails
*silently*: a button pointing at a command that does not exist simply does
nothing, and a renamed field id kills the controller mid-refresh with no error
anywhere the user will look.

The engine is split across `jsx/chisel.jsx` and four modules loaded by
`chiselBoot`. That split is not tidiness: ExtendScript refuses to define
*anything* in a file with a syntax error, so without it one typo in the tangency
solver takes the whole panel down.

All of it is written to the ExtendScript dialect, roughly ES3 — no `let`,
`const`, arrow functions, `JSON`, template literals, or array iteration methods.
`test-panel.js` fails the build if that slips.

`CHECKPOINT.md` is the running build log, including the bugs each phase caught.

---

## Licence and provenance

Chisel is an independent implementation. It shares no code with any commercial
Illustrator plugin, and the mathematics it uses — cubic bezier fitting, Kasa
circle fitting, common tangent construction, bezier clipping, Bowyer-Watson
triangulation, trochoid curves — is standard published computational geometry.
