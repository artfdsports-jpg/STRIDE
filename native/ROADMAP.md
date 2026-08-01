# Chisel Native: the C++ layer

Everything the CEP panel cannot reach. This document is the build specification, not aspiration: each item names the actual SDK suite that does the work.

## Why C++ is unavoidable here

CEP can read and write the document. It cannot own a cursor. Illustrator exposes tool tracking, canvas annotation, live effects, and art dictionaries only through the C++ SDK. UXP is not publicly available for Illustrator as of mid 2026, so there is no JavaScript route to these features.

## Toolchain

Download the Illustrator SDK from `console.adobe.io` (navigate to Illustrator, choose your OS build).

**macOS**
- Xcode 12 minimum, tested to 16.4
- Illustrator 30 (2026) needs the macOS 12.3 SDK, shipped in Xcode 13.3
- Illustrator 29 (2025) needs 11.3 on Apple Silicon (Xcode 12.5) or 10.15 on Intel (Xcode 12.0)
- Graft the old SDK folders into modern Xcode and strip `MinimumSDKVersion` from the platform `Info.plist` to build every target from one IDE
- Notarize before distribution

**Windows**
- Visual Studio 2022, toolset v143, MFC, x86-64 and ARM64, Windows 10 SDK
- Nothing extra needed for Illustrator 28 through 30

**PiPL**: generate with the SDK's script at `/tools/pipl/create_pipl.py` and embed it correctly, or the plugin will fail to load silently on macOS.

**Consider Hot Door CORE** rather than the raw SDK. It wraps the platform-specific UI work, covers Illustrator 2024 through 2026, and ships an `Annotate` sample that is a drag tool annotating its own geometry, which is exactly the interaction pattern below. Start from its `Skeleton` sample.

## Architecture

```
Chisel.aip
├── core/          platform-agnostic, zero Illustrator types.
│                  Port the algorithms straight across from chisel.jsx:
│                  fitRemoval, cornerGeometry, buildCorner, bezIntersect,
│                  bezDerivRoots, smoothPoint. They are already isolated.
├── bridge/        AIArtSuite, AIPathSuite, AIDictionarySuite, AIUndoSuite
├── tools/         AIToolSuite handlers
├── annot/         AIAnnotatorSuite overlays
├── effects/       AILiveEffectSuite
└── panels/        CORE UI, or reuse the CEP panel over a socket
```

### Five decisions to make before writing feature code

1. **Metadata schema, versioned from commit one.** `{schemaVersion, kind, params{}}` in the art dictionary. Every parametric object needs a defined degradation path for when a future version cannot read it. Ship the "remove parametric status" command in the same release as the first parametric object, not later.
2. **Rebuild, never patch.** Regenerate geometry wholesale from parameters on every edit. Patching existing point arrays is where parametric systems rot.
3. **One gesture, one undo step.** Batch inside the tool track handler, commit on mouse up. Never per mouse-move.
4. **Poll modifiers every tick.** Sample a `ModifierState` struct on each mouse-move rather than latching at mouse-down. This single decision is the difference between a tool that feels responsive and one that feels like a dialog box.
5. **Invalidate dirty rects only.** Full-canvas annotator invalidation on mouse-move will make the tool unusable on real artwork, and lag kills adoption faster than a missing feature.

## Build order

Each phase ships something usable on its own.

### N1. Point reduction brush
`AIToolSuite` + `AIAnnotatorSuite`. Brush circle cursor sized by the Increase/Decrease Diameter shortcuts. Live red preview of the resulting curve. Modifier cascade: Shift protects selected anchors, Cmd forces non-compensated removal, Alt inverts the tolerance rule, arrow keys adjust tolerance and diameter mid-drag, and already-brushed anchors are not re-evaluated when tolerance changes.

Reuses `fitRemoval` unchanged. Best first target: self-contained, demos in three seconds, and exercises the entire native stack.

### N2. Parametric corners
`AIDictionarySuite` for per-corner parameters, annotators for the radius handles. Click, drag, and Alt-marquee creation across unselected paths. Proportional multi-corner editing. Hover conversion of eligible existing corners. Alt held before the drag moves the corner instead of resizing it.

Reuses `cornerGeometry` and `buildCorner`.

### N3. Parametric shapes
Standard shapes with corners and slicing first, then advanced shapes incrementally. The annotated control system from N2 carries over: transformation point, size controls, corner controls, slice controls, rotation control.

### N4. Precision path tool
The largest single body of work. Multi-handle selection with four drag modes (normal rotation, counter-rotation, constraining, group), connector point recognition and auto-alignment, coincident-point welding via a spatial hash, and slow-drag. Budget more time for this than for N1 through N3 combined, because it is judged entirely on feel.

### N5. Measurement, path extension, path welding
Persistent measures saved into the document, hover readouts, curve normals and evolutes. Path extension by single bezier, constant radius, straight, and logarithmic spiral. Boundary welding between paths with coincident anchors.

### N6. Live effects
`AILiveEffectSuite`. Non-destructive versions of the corner and point-reduction operations, plus the general-purpose building blocks that combine into graphic styles.

## Sustaining cost

Illustrator ships a major version every autumn and the ABI moves with it. Budget a rebuild-and-retest window each September, plus a beta cycle against the prerelease build. Keep `core/` free of Illustrator types so the annual break is confined to `bridge/`.
