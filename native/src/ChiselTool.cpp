#include "ChiselTool.h"

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <string>

namespace chisel {

ChiselTool gTool;

namespace {

const double kPi = 3.14159265358979323846;

// Hit tolerances in screen pixels. These are the numbers that decide whether
// the tool feels precise or fussy, so they are named here rather than buried.
const double kAnchorPixels = 5.0;
const double kHandlePixels = 5.0;
const double kSegmentPixels = 4.0;
const double kSnapPixels = 8.0;

// Annotation colours. Chisel's preview is brass, matching the panel; the snap
// guide is the same hue at full saturation so it reads as a live constraint
// rather than as part of the artwork.
AIRGBColor brass() {
    AIRGBColor c;
    c.red = 0xC900;
    c.green = 0xA200;
    c.blue = 0x4A00;
    return c;
}

AIRGBColor snapColor() {
    AIRGBColor c;
    c.red = 0xFF00;
    c.green = 0x8C00;
    c.blue = 0x1A00;
    return c;
}

Modifiers readModifiers(AIToolMessage* message) {
    Modifiers m;
    if (message == nullptr || message->event == nullptr) { return m; }
    const ai::int32 flags = message->event->modifiers;
    m.shift = (flags & shiftKey) != 0;
    m.option = (flags & optionKey) != 0;
    m.command = (flags & cmdKey) != 0;
    return m;
}

// Snap a vector to the nearest 45 degree step, keeping its length. What Shift
// does everywhere else in Illustrator, so it has to do it here too.
Vec2 constrain45(const Vec2& delta) {
    const double len = length(delta);
    if (len < 1e-9) { return delta; }
    const double step = kPi * 0.25;
    const double angle = std::round(std::atan2(delta.y, delta.x) / step) * step;
    return fromAngle(angle) * len;
}

}  // namespace

// ------------------------------------------------------------ registration

ASErr ChiselTool::registerTool(SPPluginRef plugin) {
    if (g.tool == nullptr) { return kBadParameterErr; }

    AIAddToolData data;
    data.title = "Chisel Path Tool";
    data.tooltip = "Edit anchors and handles with tangent locking";
    data.sameGroupAs = kNoTool;      // its own group, next to the pen tools
    data.sameToolsetAs = kNoTool;
    data.normalIconResID = 16000;    // must match the resource ids in the PiPL
    data.darkIconResID = 16001;

    const ai::int32 options = kToolWantsToTrackCursorOption |
                              kToolWantsAlternateSelectionTool;

    return g.tool->AddTool(plugin, "Chisel Path Tool", data, options, &toolHandle_);
}

ASErr ChiselTool::registerAnnotator(SPPluginRef plugin) {
    if (g.annotator == nullptr) { return kBadParameterErr; }
    const ASErr err = g.annotator->AddAnnotator(plugin, "Chisel Path Tool", &annotatorHandle_);
    if (err == kNoErr) {
        // Off until the tool is selected. An annotator left active draws over
        // every other tool in the program.
        g.annotator->SetAnnotatorActive(annotatorHandle_, false);
    }
    return err;
}

// ------------------------------------------------------------------ scene

double ChiselTool::pixels(double n) const {
    return n * documentUnitsPerPixel();
}

void ChiselTool::refreshScene() {
    collectPaths(paths_);
    collectCircles(paths_, circles_);
}

void ChiselTool::updateHover(const Vec2& cursor) {
    std::vector<PathRef> refs;
    refs.reserve(paths_.size());
    for (const PathHandle& p : paths_) { refs.push_back(p.ref); }

    hover_ = hitTest(refs, cursor,
                     pixels(kAnchorPixels),
                     pixels(kSegmentPixels),
                     pixels(kHandlePixels));
}

// ------------------------------------------------------------- callbacks

ASErr ChiselTool::selectTool(AIToolMessage*) {
    refreshScene();
    if (g.annotator != nullptr && annotatorHandle_ != nullptr) {
        g.annotator->SetAnnotatorActive(annotatorHandle_, true);
    }
    return kNoErr;
}

ASErr ChiselTool::deselectTool(AIToolMessage*) {
    cancelDrag();
    paths_.clear();
    circles_.clear();
    hover_ = HitResult();
    if (g.annotator != nullptr && annotatorHandle_ != nullptr) {
        g.annotator->SetAnnotatorActive(annotatorHandle_, false);
    }
    return kNoErr;
}

ASErr ChiselTool::trackCursor(AIToolMessage* message) {
    if (message == nullptr) { return kBadParameterErr; }

    // Hover has to see the document as it is now: another tool, the panel, or
    // an undo may have changed it since the last time through here.
    refreshScene();
    updateHover(fromAI(message->cursor));
    invalidate();
    return kNoErr;
}

ASErr ChiselTool::mouseDown(AIToolMessage* message) {
    if (message == nullptr) { return kBadParameterErr; }

    const Vec2 cursor = fromAI(message->cursor);
    refreshScene();
    updateHover(cursor);

    if (hover_.kind == HitKind::None) {
        dragging_ = false;
        return kNoErr;
    }

    const PathHandle& target = paths_[hover_.pathIndex];
    dragArt_ = target.art;
    original_ = target.ref.points;
    preview_ = original_;
    previewClosed_ = target.ref.closed;
    dragging_ = true;

    // Grab offset, so the point does not jump to the cursor at the instant it
    // is picked up. Sub-pixel, but its absence is immediately noticeable.
    grabOffset_ = hover_.position - cursor;

    // Is this anchor tangent-locked? Read once here rather than per mouse-move;
    // the dictionary does not change during a drag.
    grabLocked_ = false;
    Record rec;
    if (readRecord(dragArt_, rec)) {
        const std::string locks = recordValue(rec, "locks");
        // The locks field is a comma-separated list of anchor indices, in the
        // same encoding the panel writes.
        std::size_t start = 0;
        while (start <= locks.size() && !locks.empty()) {
            std::size_t end = locks.find(',', start);
            if (end == std::string::npos) { end = locks.size(); }
            if (end > start) {
                const long idx = std::strtol(locks.substr(start, end - start).c_str(), nullptr, 10);
                if (static_cast<std::size_t>(idx) == hover_.pointIndex) { grabLocked_ = true; }
            }
            if (end == locks.size()) { break; }
            start = end + 1;
        }
    }
    return kNoErr;
}

ASErr ChiselTool::mouseDrag(AIToolMessage* message) {
    if (message == nullptr || !dragging_) { return kNoErr; }

    // Sampled here, every tick, deliberately. Latching modifiers at mouse down
    // is what makes a tool feel dead.
    const Modifiers mods = readModifiers(message);
    buildPreview(fromAI(message->cursor) + grabOffset_, mods);
    invalidate();
    return kNoErr;
}

ASErr ChiselTool::mouseUp(AIToolMessage*) {
    if (!dragging_) { return kNoErr; }
    commit();
    dragging_ = false;
    dragArt_ = nullptr;
    hasSnap_ = false;
    refreshScene();
    invalidate();
    return kNoErr;
}

// -------------------------------------------------------------- preview

void ChiselTool::buildPreview(const Vec2& rawTarget, const Modifiers& mods) {
    preview_ = original_;
    hasSnap_ = false;

    Vec2 target = rawTarget;

    // Shift constrains the movement, not the destination, so the point travels
    // along a 45 degree line from where it started rather than jumping onto a
    // grid that has nothing to do with it.
    if (mods.shift) {
        const Vec2 anchor = (hover_.kind == HitKind::Segment)
                                ? hover_.position
                                : original_[hover_.pointIndex].anchor;
        target = anchor + constrain45(target - anchor);
    }

    // Snapping, unless the user has asked for it out of the way.
    if (!mods.command) {
        std::vector<PathRef> refs;
        std::vector<Circle> circleGeom;
        refs.reserve(paths_.size());
        circleGeom.reserve(circles_.size());
        for (const PathHandle& p : paths_) {
            // The path being dragged must not snap to itself, or the point
            // sticks to where it already is and will not move.
            if (p.art == dragArt_) { continue; }
            refs.push_back(p.ref);
        }
        for (const CircleHandle& c : circles_) {
            if (c.art == dragArt_) { continue; }
            circleGeom.push_back(c.circle);
        }

        const std::vector<SnapCandidate> found =
            findSnaps(refs, circleGeom, target, pixels(kSnapPixels));
        if (!found.empty()) {
            snap_ = found.front();
            hasSnap_ = true;
            target = snap_.position;
        }
    }

    const std::size_t i = hover_.pointIndex;

    switch (hover_.kind) {
        case HitKind::Anchor: {
            if (i >= preview_.size()) { break; }
            const Vec2 delta = target - original_[i].anchor;
            preview_[i].anchor = target;
            preview_[i].in = original_[i].in + delta;
            preview_[i].out = original_[i].out + delta;

            // Snapping to a circle tangency means more than landing on the
            // circle: the path should leave the point along the tangent, which
            // is the whole reason the snap carries a direction.
            if (hasSnap_ && snap_.kind == SnapKind::CircleTangency) {
                applyTangentConstraint(preview_, i, target, snap_.direction);
            }
            break;
        }

        case HitKind::InHandle:
        case HitKind::OutHandle: {
            if (i >= preview_.size()) { break; }
            if (hover_.kind == HitKind::InHandle) { preview_[i].in = target; }
            else { preview_[i].out = target; }

            // A locked anchor drags its other handle round to stay collinear.
            // Option suspends that for the length of this one gesture, which is
            // how you fix a lock you no longer want without first hunting for a
            // button to release it.
            if (grabLocked_ && !mods.option) {
                const bool draggingIn = (hover_.kind == HitKind::InHandle);
                const Vec2 dir = draggingIn ? normalize(preview_[i].anchor - preview_[i].in)
                                            : normalize(preview_[i].out - preview_[i].anchor);
                if (length(dir) > 1e-9) {
                    const double otherLen = draggingIn
                        ? distance(original_[i].anchor, original_[i].out)
                        : distance(original_[i].anchor, original_[i].in);
                    if (draggingIn) {
                        preview_[i].out = preview_[i].anchor + dir * otherLen;
                    } else {
                        preview_[i].in = preview_[i].anchor - dir * otherLen;
                    }
                    preview_[i].smooth = true;
                }
            }
            break;
        }

        case HitKind::Segment: {
            // Dragging the curve itself. The two handles either side move in
            // proportion to how much influence each has at the grabbed
            // parameter, which is what makes the curve follow the cursor rather
            // than swing away from it.
            if (preview_.size() < 2) { break; }
            const std::size_t j = (i + 1) % preview_.size();
            const double t = hover_.t;
            const double u = 1.0 - t;

            const double b1 = 3.0 * u * u * t;
            const double b2 = 3.0 * u * t * t;
            const double denom = b1 * b1 + b2 * b2;
            if (denom < 1e-12) { break; }

            const Cubic seg = segmentAt(original_, i, previewClosed_);
            const Vec2 delta = target - evaluate(seg, t);
            preview_[i].out = original_[i].out + delta * (b1 / denom);
            preview_[j].in = original_[j].in + delta * (b2 / denom);
            break;
        }

        case HitKind::None:
        default:
            break;
    }
}

// ---------------------------------------------------------------- commit

void ChiselTool::commit() {
    if (dragArt_ == nullptr || preview_.size() < 2) { return; }

    // One undo entry for the whole gesture. Illustrator opens an undo scope for
    // the tool automatically; naming it here is what puts a useful label in the
    // Edit menu instead of a generic one.
    if (g.undo != nullptr) {
        g.undo->SetUndoTextID(kChiselUndoStringID, kChiselRedoStringID);
    }

    writePath(dragArt_, preview_, previewClosed_);

    // A drag that ended on a tangent snap is a statement of intent, so record
    // the lock. The panel's solver will then keep it true through every later
    // edit, including ones made with Illustrator's own tools.
    if (hasSnap_ && snap_.kind == SnapKind::CircleTangency) {
        Record rec;
        readRecord(dragArt_, rec);
        if (recordValue(rec, "kind").empty()) { setRecordValue(rec, "kind", "ref"); }

        std::string locks = recordValue(rec, "locks");
        const std::string idx = std::to_string(hover_.pointIndex);
        // Only add an index that is not already there; duplicates would make
        // the solver do the same work twice.
        bool present = false;
        std::size_t start = 0;
        while (start <= locks.size() && !locks.empty()) {
            std::size_t end = locks.find(',', start);
            if (end == std::string::npos) { end = locks.size(); }
            if (locks.substr(start, end - start) == idx) { present = true; }
            if (end == locks.size()) { break; }
            start = end + 1;
        }
        if (!present) {
            if (!locks.empty()) { locks += ","; }
            locks += idx;
            setRecordValue(rec, "locks", locks);
            writeRecord(dragArt_, rec);
        }
    }
}

void ChiselTool::cancelDrag() {
    if (dragging_ && dragArt_ != nullptr) {
        writePath(dragArt_, original_, previewClosed_);
    }
    dragging_ = false;
    dragArt_ = nullptr;
    hasSnap_ = false;
}

// ----------------------------------------------------------- annotation

void ChiselTool::invalidate() {
    if (g.annotator == nullptr || g.view == nullptr) { return; }

    AIDocumentViewHandle viewHandle = nullptr;
    if (g.view->GetNthDocumentView(0, &viewHandle) != kNoErr) { return; }

    // Only the region the tool is actually drawing in. Invalidating the whole
    // canvas here is the difference between a tool that keeps up and one that
    // stutters on a page full of artwork.
    const PointList& shown = dragging_ ? preview_ : original_;
    if (shown.empty() && hover_.kind == HitKind::None) { return; }

    Vec2 lo(1e300, 1e300), hi(-1e300, -1e300);
    auto grow = [&lo, &hi](const Vec2& p) {
        lo.x = std::min(lo.x, p.x);
        lo.y = std::min(lo.y, p.y);
        hi.x = std::max(hi.x, p.x);
        hi.y = std::max(hi.y, p.y);
    };

    if (dragging_) {
        for (const PathPoint& p : preview_) { grow(p.anchor); grow(p.in); grow(p.out); }
        for (const PathPoint& p : original_) { grow(p.anchor); grow(p.in); grow(p.out); }
    } else if (hover_.kind != HitKind::None) {
        grow(hover_.position);
    }
    if (hasSnap_) { grow(snap_.position); }
    if (lo.x > hi.x) { return; }

    const double pad = pixels(12.0);
    const AIPoint a = artworkToView(Vec2(lo.x - pad, hi.y + pad));
    const AIPoint b = artworkToView(Vec2(hi.x + pad, lo.y - pad));

    AIRect r;
    r.left = std::min(a.h, b.h);
    r.top = std::min(a.v, b.v);
    r.right = std::max(a.h, b.h);
    r.bottom = std::max(a.v, b.v);
    g.annotator->InvalAnnotationRect(viewHandle, &r);
}

ASErr ChiselTool::drawAnnotation(AIAnnotatorMessage* message) {
    if (message == nullptr || g.drawer == nullptr) { return kBadParameterErr; }
    AIAnnotatorDrawer* d = message->drawer;
    if (d == nullptr) { return kBadParameterErr; }

    g.drawer->SetLineWidth(d, 1.0);

    // The preview curve, flattened to view space. The annotator has no bezier
    // primitive, so this is the only way to show what the drag will produce.
    if (dragging_ && preview_.size() >= 2) {
        g.drawer->SetColor(d, brass());
        const std::size_t n = segmentCount(preview_, previewClosed_);
        for (std::size_t i = 0; i < n; ++i) {
            const Cubic c = segmentAt(preview_, i, previewClosed_);
            AIPoint prev = artworkToView(evaluate(c, 0.0));
            const int steps = 24;
            for (int s = 1; s <= steps; ++s) {
                const AIPoint cur = artworkToView(evaluate(c, static_cast<double>(s) / steps));
                g.drawer->DrawLine(d, prev, cur, false);
                prev = cur;
            }
        }

        // Handles on the point being edited, so the user can see what they are
        // steering rather than inferring it from the curve.
        const std::size_t i = hover_.pointIndex;
        if (i < preview_.size()) {
            const AIPoint a = artworkToView(preview_[i].anchor);
            g.drawer->DrawLine(d, a, artworkToView(preview_[i].in), true);
            g.drawer->DrawLine(d, a, artworkToView(preview_[i].out), true);
        }
    }

    // The snap indicator, and the guide showing the direction it implies. The
    // guide is what makes a tangency snap legible: without it, the point simply
    // lands somewhere and the user has to take the tangency on trust.
    if (hasSnap_) {
        g.drawer->SetColor(d, snapColor());
        const AIPoint p = artworkToView(snap_.position);

        AIRect dot;
        dot.left = p.h - 3;
        dot.top = p.v - 3;
        dot.right = p.h + 3;
        dot.bottom = p.v + 3;
        g.drawer->DrawRect(d, dot, true);

        if (length(snap_.direction) > 1e-9) {
            const double reach = pixels(40.0);
            g.drawer->DrawLine(d,
                               artworkToView(snap_.position - snap_.direction * reach),
                               artworkToView(snap_.position + snap_.direction * reach),
                               true);
        }
    }

    // Hover highlight when not dragging.
    if (!dragging_ && hover_.kind != HitKind::None) {
        g.drawer->SetColor(d, brass());
        const AIPoint p = artworkToView(hover_.position);
        AIRect box;
        box.left = p.h - 3;
        box.top = p.v - 3;
        box.right = p.h + 3;
        box.bottom = p.v + 3;
        g.drawer->DrawRect(d, box, hover_.kind == HitKind::Anchor);
    }

    return kNoErr;
}

}  // namespace chisel
