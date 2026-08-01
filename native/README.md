# Chisel Native

The C++ layer. Everything the CEP panel cannot reach, because it needs a cursor.

## What is verified and what is not

Be clear about this before you start, because the two halves of this directory
have very different standing.

**`core/` is verified.** It contains no Illustrator types at all, builds with any
C++17 compiler, and ships 88 assertions that run in about a second:

```bash
cmake -S native/core -B native/core/build
cmake --build native/core/build
./native/core/build/chisel_core_tests
```

That is where the mathematics lives: circle recognition, common tangents, belt
outlines, arcs, closest point on a curve, hit testing, snap resolution, the
spatial hash for coincident anchors, and the tangent constraints.

**`src/` is not verified.** It is the Illustrator SDK bridge, and it has never
been compiled, because building it needs the SDK, which Adobe distributes only
through `console.adobe.io` and which cannot be redistributed here. Treat it as a
worked specification with real suite names and real call signatures rather than
as known-good code. Expect to fix things on the first build:

- suite version macros drift between SDK releases; the table in
  `ChiselSuites.cpp` names versions explicitly so a mismatch is a startup error
  you can read rather than a silent misbind
- `AIAnnotatorDrawerSuite` gained and lost primitives across versions; the
  drawing code sticks to `DrawLine` and `DrawRect`, which have been stable
- letter-key modifiers during a drag are **not** implemented. Shift, Option and
  Command are read from `message->event->modifiers` every tick, which is solid.
  A `T`-to-tangent-constrain binding of the kind VectorScribe uses needs the
  SDK's key handling, and inventing a selector name here would have been worse
  than leaving a gap

## Why C++ at all

CEP can read and write the document. It cannot own a cursor. Tool tracking,
canvas annotation, live effects and art dictionaries are exposed only through
the C++ SDK, and UXP is still not publicly available for Illustrator, so there
is no JavaScript route to any of it.

Concretely, the panel cannot: put a tool in the toolbar, draw a preview while
you drag, respond to a modifier pressed halfway through a gesture, or hit-test
what is under the pointer. Those four are the whole difference between a panel
and a tool.

## Layout

```
core/                platform-agnostic, zero Illustrator types, fully tested
  ChiselGeom.*       vectors, cubics, circle fit, tangents, arcs, belts, area
  ChiselHit.*        hit testing, snapping, coincidence hashing, constraints
  test/CoreTests.cpp 88 assertions
src/                 the SDK bridge; needs the Illustrator SDK to compile
  ChiselSuites.*     suite acquisition, as a table so release mirrors acquire
  ChiselBridge.*     AIArt <-> core geometry, and the parametric metadata
  ChiselTool.*       the tool and its annotator
  ChiselPlugin.cpp   entry point and message dispatch
```

The metadata encoding in `ChiselBridge.cpp` is deliberately identical to the one
in `jsx/chisel-meta.jsx`. A document built with the panel opens with its
constraints intact in the plugin and the other way round; letting the two
diverge would mean artwork silently losing its constraints depending on which
half of Chisel the user happened to be running.

## Toolchain

Download the Illustrator SDK from `console.adobe.io`.

**macOS**
- Xcode 12 minimum, tested to 16.4
- Illustrator 30 (2026) needs the macOS 12.3 SDK, shipped in Xcode 13.3
- Illustrator 29 (2025) needs 11.3 on Apple Silicon (Xcode 12.5) or 10.15 on
  Intel (Xcode 12.0)
- Graft the old SDK folders into modern Xcode and strip `MinimumSDKVersion` from
  the platform `Info.plist` to build every target from one IDE
- Notarize before distribution

**Windows**
- Visual Studio 2022, toolset v143, MFC, x86-64 and ARM64, Windows 10 SDK

**PiPL**: generate with the SDK's `tools/pipl/create_pipl.py` and embed it
correctly, or the plugin fails to load silently on macOS. The tool icon resource
ids in `ChiselTool.cpp` (16000 and 16001) have to match what the PiPL declares.

**Consider Hot Door CORE** instead of the raw SDK. It wraps the platform UI
work, covers Illustrator 2024 through 2026, and its `Annotate` sample is a drag
tool annotating its own geometry, which is exactly the pattern here.

## Design rules

These are not style preferences. Each one is a specific failure mode.

1. **Metadata versioned from commit one.** `{v, kind, ...}` in the art
   dictionary, with a defined degradation path for records a future version
   cannot read. Ship the "release parametric status" command in the same release
   as the first parametric object, never later.
2. **Rebuild, never patch.** Regenerate dependent geometry wholesale from its
   parameters. Nudging existing point arrays toward where they should be is how
   parametric systems accumulate drift and eventually produce garbage.
3. **One gesture, one undo step.** Batch through the drag, commit on mouse up.
   Per mouse-move commits make a single Cmd-Z useless.
4. **Poll modifiers every tick.** Never latch at mouse down. This is the single
   decision that separates a tool that feels alive from one that feels like a
   dialog box.
5. **Invalidate dirty rects only.** Full-canvas annotator invalidation on
   mouse-move makes the tool unusable on real artwork, and lag kills adoption
   faster than a missing feature.

## What is built here, and what is still to come

Implemented in `src/`: the toolbar tool, hover hit-testing with anchors taking
priority over segments, anchor and handle and segment dragging, tangent snapping
to any circle in the document with a live guide showing the direction, tangent
locks that hold handles collinear during a drag with Option to suspend, a
flattened live preview, dirty-rect invalidation, and writing the resulting lock
back into the same dictionary format the panel reads.

Still to come, in the order they earn their keep:

- **Point reduction brush.** `fitRemoval` ports across unchanged from
  `chisel.jsx`. Self-contained, demonstrates in three seconds, and exercises the
  entire native stack.
- **Parametric corners.** Annotated radius handles, Alt-marquee creation across
  unselected paths, proportional multi-corner editing.
- **Parametric shapes.** The annotated control system from corners carries over.
- **Measurement and path extension.** Persistent measures saved into the
  document, curve normals and evolutes, extension by single bezier, constant
  radius, straight and logarithmic spiral.
- **Live effects.** `AILiveEffectSuite`, for non-destructive corners and point
  reduction.

## Sustaining cost

Illustrator ships a major version every autumn and the ABI moves with it. Budget
a rebuild-and-retest window each September plus a beta cycle against the
prerelease build. `core/` stays free of Illustrator types precisely so that
break is confined to `src/`.
