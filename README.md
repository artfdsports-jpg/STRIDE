# Chisel

Precision path tools for Adobe Illustrator 2025 and later (ILST 29.0+).

Chisel gives you the panel-driven precision work that Illustrator has never had natively: least-squares point reduction, tangency placement, three corner methods, numeric handle editing, path intersections, and a spirograph generator.

---

## What is in the box

| Section | Operations |
|---|---|
| **Clean** | Smart remove points (tolerance-driven, handle-compensated), remove without smoothing, remove redundant points, count redundant points |
| **Points** | Smooth (with generated handles), corner, retract handles, swap in/out, equalise handle lengths, straighten segment, average positions (both, X only, Y only) |
| **Handles** | Scale, rotate, increment, set length, set angle. Applies to in, out, or both handles across every selected anchor |
| **Add points** | Equal arc-length spacing, bezier t spacing, fixed distance spacing with optional centring |
| **Tangencies** | Add points at horizontal, vertical, or both tangencies. Move points to tangencies (adds tangent points then prunes the originals the curve no longer needs) |
| **Corners** | Regular, negative, and chamfered types across true radius, standard, and squircular methods |
| **Paths** | Close (honour handles / flat / smooth), open, reverse direction, start at selected point, split at points, connect two paths smoothly, add points at path intersections |
| **Select** | Corners, smooth points, all, grow, shrink, invert, and skip/take pattern selection |
| **Generate** | Roulette curves (epitrochoid and hypotrochoid, single or series with interpolated R, D, and rotation), Delaunay triangulation from anchors or bounding-box centres |

---

## Install

### 1. Add CSInterface.js

Chisel does not bundle Adobe's library. Download `CSInterface.js` from Adobe's official repository and drop it into `Chisel/js/`:

```
https://github.com/Adobe-CEP/CEP-Resources
  → CEP_12.x/CSInterface.js
```

**Use the CEP 12 build.** Illustrator moved to CEP 12 at version 29.5, and Illustrator 2026 (30.x) is firmly on it. The CEP 11 copy of this file is the single most common cause of a panel that loads its frame but stays blank.

The panel will show a red status message until this file is present.

### 2. Enable unsigned extensions

Chisel is unsigned during development, so Illustrator must be told to load it.

**macOS:**
```bash
defaults write com.adobe.CSXS.12 PlayerDebugMode 1
killall cfprefsd
```

**Windows** (Registry Editor):
```
HKEY_CURRENT_USER\Software\Adobe\CSXS.12   →  PlayerDebugMode  (String)  = 1
```

CSXS.12 is the one that matters for Illustrator 2025 and 2026. Setting CSXS.11 as well is harmless, and useful only if you also run older Illustrator versions.

### 3. Copy the folder

Put the whole `Chisel` folder into the CEP extensions directory:

**macOS, per user:**
`~/Library/Application Support/Adobe/CEP/extensions/`

**macOS, all users:**
`/Library/Application Support/Adobe/CEP/extensions/`

**Windows, per user:**
`%APPDATA%\Adobe\CEP\extensions\`

**Windows, all users:**
`C:\Program Files (x86)\Common Files\Adobe\CEP\extensions\`

### 4. Restart Illustrator

Open it from **Window > Extensions > Chisel**.

### If the panel does not appear, or loads blank

Work through these in order. All are Illustrator 2026 specific gotchas.

1. **Wrong CSInterface build.** Confirm you took the CEP 12 copy, not CEP 11. This produces exactly the "frame renders, contents blank" symptom.
2. **Stale CEP cache.** Illustrator 2026 caches aggressively and will happily keep serving a failed load. Quit Illustrator, then delete:
   - macOS: `~/Library/Caches/CSXS` and `~/Library/Application Support/Adobe/CEP/CEF`
   - Windows: `%LOCALAPPDATA%\Temp\cep_cache` and `%APPDATA%\Adobe\CEP\CEF`
3. **macOS Sequoia file access.** Sequoia sandboxes folders more tightly. Keep the extension in the per-user path (`~/Library/Application Support/Adobe/CEP/extensions/`) rather than the system-wide one, and grant Illustrator Full Disk Access if anything still misbehaves.
4. **Read the log.** It will name the actual failure:
   - macOS: `~/Library/Logs/CSXS/CEP12-ILST.log`
   - Windows: `%TEMP%\CEP12-ILST.log`
   Raise verbosity first with `defaults write com.adobe.CSXS.12 LogLevel 6` (Windows: a `LogLevel` string of `6` under the same registry key).

---

## Using it

Most operations follow one rule: **if you have anchor points selected, Chisel works on those. If you only have whole objects selected, it works on the entire path.** That is how you scope a corner radius to two corners instead of eight, or reduce points on one troublesome section instead of the whole letterform.

Everything runs through Illustrator's normal undo, so Cmd/Ctrl-Z reverts the last operation.

### Tolerance

The Clean slider runs 1 to 100 and maps to allowed curve deviation, where 10 is roughly 0.5 pt. Start low. Push it up until the preview of the shape starts to matter, then back off one notch. For type outlines and logo work, 5 to 15 is the useful band. For rough illustration where exact geometry does not matter, 40 and above will strip aggressively.

### Corner methods

- **True radius** builds a genuine circular arc, constant radius, tangent to both legs. Use this for technical drawing and anything that has to measure correctly.
- **Standard** reproduces Illustrator's own Round Corners behaviour: fixed trim distance and a circular handle constant regardless of angle, so the radius varies away from 90 degrees. Use it when you need to match existing native artwork.
- **Squircular** trims further back with softer handles, approximating a superellipse blend for continuous curvature. Best on rectangles and anything that needs to look like modern app iconography.

Unlike the native Round Corners effect, Chisel trims along the actual segment by arc length, so corners adjacent to curves do not distort.

### Roulette

Ratio R:S is reduced automatically, so 16:4 behaves the same as 4:1. The curve closes after S turns of the reduced ratio, and Chisel generates exactly that. Accuracy 1 to 5 sets samples per turn (24 to 384); points are placed with exact cubic Hermite handles, so even accuracy 2 tracks the true curve closely. Parameters are written into the path's Note field, visible in the Attributes panel, so you can rebuild artwork later.

---

## Development

Debug the panel in Chrome at `http://localhost:8099` while Illustrator is running (port set in `.debug`).

Run the geometry test suite without Illustrator:

```bash
node test-geometry.js
```

It stubs the Illustrator DOM and exercises the bezier core: evaluation, splitting, arc length against a known quarter circle, tangency roots, least-squares point removal, curve intersection, corner construction, roulette closure, and the smoothing algorithm. 29 assertions, all passing.

The engine in `jsx/chisel.jsx` is written to the ExtendScript dialect (roughly ES3): no `let`, `const`, arrow functions, `JSON`, or array iteration methods. Keep it that way or Illustrator will fail to parse it.

---

## What Chisel does not do yet

Interactive canvas tools cannot be built in CEP. A tool that lives in the toolbar, draws a red preview while you drag, responds to modifier keys mid-gesture, or paints anchor removal with a brush requires a compiled C++ plugin. See `native/ROADMAP.md`.

The features waiting on that layer: the point-reduction brush, live parametric shapes and corners, on-canvas measurement, path extension by dragging, path zipper, and non-destructive live effects.

---

## Licence and provenance

Chisel is an independent implementation. It shares no code with any commercial Illustrator plugin, and the mathematics it uses (cubic bezier fitting, bezier clipping, Bowyer-Watson triangulation, trochoid curves) is standard published computational geometry.
