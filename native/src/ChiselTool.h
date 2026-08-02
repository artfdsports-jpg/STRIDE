// The Chisel path tool: a cursor in Illustrator's toolbar.
//
// This is the half of the request that CEP genuinely cannot do. A panel acts on
// whatever is already selected; a tool owns the pointer, decides what is under
// it sixty times a second, draws its own preview, and reads modifier keys in
// the middle of a gesture. None of those are exposed to JavaScript by any
// Illustrator API that exists today.
//
// Three rules from the architecture notes that shape everything here:
//
//   One gesture, one undo step. Changes are batched through the drag and
//   committed on mouse up. Committing per mouse-move fills the undo stack with
//   hundreds of entries and makes a single Cmd-Z useless.
//
//   Poll modifiers every tick, never latch them at mouse down. This is the
//   single decision that separates a tool that feels alive from one that feels
//   like a dialog box: pressing Shift halfway through a drag has to work.
//
//   Invalidate dirty rectangles only. A full-canvas annotator invalidation on
//   every mouse-move makes the tool unusable on real artwork.

#ifndef CHISEL_TOOL_H
#define CHISEL_TOOL_H

#include <vector>

#include "../core/ChiselGeom.h"
#include "../core/ChiselHit.h"
#include "ChiselBridge.h"

namespace chisel {

// Undo and redo menu strings, which live in the plugin's string resources.
// Illustrator opens the undo scope for a tool gesture itself; naming it is what
// puts "Undo Chisel Path Edit" in the Edit menu rather than something generic.
const ai::int32 kChiselUndoStringID = 1;
const ai::int32 kChiselRedoStringID = 2;

// Live modifier state, sampled fresh on every mouse-move.
struct Modifiers {
    bool shift = false;     // constrain movement to 45 degree steps
    bool option = false;    // suspend the tangent lock for this drag
    bool command = false;   // suspend snapping
};

class ChiselTool {
public:
    ASErr registerTool(SPPluginRef plugin);
    ASErr registerAnnotator(SPPluginRef plugin);

    // Tool callbacks, one per SDK selector.
    ASErr trackCursor(AIToolMessage* message);
    ASErr mouseDown(AIToolMessage* message);
    ASErr mouseDrag(AIToolMessage* message);
    ASErr mouseUp(AIToolMessage* message);
    ASErr selectTool(AIToolMessage* message);
    ASErr deselectTool(AIToolMessage* message);

    ASErr drawAnnotation(AIAnnotatorMessage* message);

    AIToolHandle handle() const { return toolHandle_; }
    AIAnnotatorHandle annotator() const { return annotatorHandle_; }

private:
    void refreshScene();
    void updateHover(const Vec2& cursor);
    void buildPreview(const Vec2& cursor, const Modifiers& mods);
    void commit();
    void cancelDrag();
    void invalidate();

    // Screen-sized tolerances, converted through the current zoom so a grab
    // target is the same size on screen however far in you are.
    double pixels(double n) const;

    AIToolHandle toolHandle_ = nullptr;
    AIAnnotatorHandle annotatorHandle_ = nullptr;

    // The scene, rebuilt on mouse down rather than on every move. Re-collecting
    // every path in the document per mouse-move is the classic way to make a
    // tool feel sticky on a heavy file.
    std::vector<PathHandle> paths_;
    std::vector<CircleHandle> circles_;

    HitResult hover_;
    bool dragging_ = false;

    AIArtHandle dragArt_ = nullptr;
    PointList original_;      // as it was at mouse down, for cancel and for delta
    PointList preview_;       // what the annotator draws and mouse up commits
    bool previewClosed_ = false;

    Vec2 grabOffset_;         // cursor to grabbed point, so nothing jumps on grab
    SnapCandidate snap_;
    bool hasSnap_ = false;

    // Whether the grabbed anchor carries a tangent lock, read once at mouse
    // down from the art dictionary.
    bool grabLocked_ = false;

    // Extension. Grabbing the terminal anchor of an open path continues it
    // instead of moving it, which is the behaviour of a separate tool in
    // VectorScribe and is folded in here: the gesture is unambiguous, because
    // an end anchor is the only place a path can grow from.
    bool extending_ = false;
    bool extendAtStart_ = false;
    ExtendMode extendMode_ = ExtendMode::SingleBezier;
    double spiralWinding_ = 0.2;
    EndFrame extendFrame_;

    void buildExtendPreview(const Vec2& cursor, const Modifiers& mods);
    void drawEndTick(AIAnnotatorDrawer* d);

public:
    // Cycled by the E key, matching the shortcut users already have in their
    // fingers. Wired from the plugin's key handling, which is why it is public.
    void cycleExtendMode();
    void nudgeSpiralWinding(double delta);
};

extern ChiselTool gTool;

}  // namespace chisel

#endif  // CHISEL_TOOL_H
