// Chisel native core: hit testing and snapping.
//
// None of this exists in the CEP panel, and none of it could: it only has
// meaning when there is a cursor on the canvas. A panel operates on whatever is
// already selected. A tool has to decide, sixty times a second, what is under
// the pointer, what it would snap to, and what to draw as a preview.
//
// Everything here works in document coordinates and takes tolerances in
// document units. The tool layer converts from screen pixels using the current
// zoom, so a hit target stays the same size on screen at every magnification -
// which is what the user expects, and the opposite of what you get if you bake
// a fixed document-space tolerance into the geometry.

#ifndef CHISEL_HIT_H
#define CHISEL_HIT_H

#include <cstddef>
#include <vector>

#include "ChiselGeom.h"

namespace chisel {

// What the cursor is over. Ordered by priority: when an anchor and a segment
// are both within tolerance the anchor wins, because a point you can grab is
// almost always what you meant.
enum class HitKind {
    None,
    Anchor,
    InHandle,
    OutHandle,
    Segment
};

struct HitResult {
    HitKind kind = HitKind::None;
    std::size_t pathIndex = 0;
    std::size_t pointIndex = 0;    // anchor, or the point starting the segment
    double t = 0.0;                // parameter along the segment, for Segment
    double distance = 0.0;         // document units from the query point
    Vec2 position;                 // the exact point hit
};

// One path, as the tool sees it.
struct PathRef {
    PointList points;
    bool closed = false;
    bool hasSelection = false;     // handles are only hit-testable when shown
};

// Nearest thing under the cursor across a set of paths.
//
// handleTolerance is separate from pointTolerance because handles sit at the
// end of a thin line and are easy to miss, while anchors sit on the path and
// are easy to hit by accident.
HitResult hitTest(const std::vector<PathRef>& paths,
                  const Vec2& query,
                  double pointTolerance,
                  double segmentTolerance,
                  double handleTolerance);

// ------------------------------------------------------------------ snaps

enum class SnapKind {
    None,
    HorizontalTangency,   // the path runs level here
    VerticalTangency,
    CircleTangency,       // the dragged point would make a tangent to a circle
    Anchor,               // another anchor, for welding
    Intersection
};

struct SnapCandidate {
    SnapKind kind = SnapKind::None;
    Vec2 position;
    double distance = 0.0;
    Vec2 direction;       // the tangent direction, where the snap implies one
    std::size_t subject = 0;
};

// Snap targets near a point.
//
// The order the results come back in is the order of preference, not distance:
// a tangency the user is clearly reaching for should win over an anchor that
// happens to be a hair closer, or the snap flickers between the two as they
// move. Callers take the first result within tolerance.
std::vector<SnapCandidate> findSnaps(const std::vector<PathRef>& paths,
                                     const std::vector<Circle>& circles,
                                     const Vec2& query,
                                     double tolerance);

// ----------------------------------------------------------- coincidence

// Anchors sharing a position, found through a spatial hash rather than the
// obvious double loop. Welding a hundred-point path against a document full of
// artwork is O(n*m) done naively, and it runs on mouse-up where a stall is
// felt immediately.
struct Coincidence {
    std::size_t pathA = 0;
    std::size_t pointA = 0;
    std::size_t pathB = 0;
    std::size_t pointB = 0;
    double gap = 0.0;
};

std::vector<Coincidence> findCoincidentAnchors(const std::vector<PathRef>& paths,
                                               double tolerance);

// ------------------------------------------------------------ constraints

// Move an anchor while holding the path's direction through it fixed. This is
// tangent constraining: the point slides, the curve keeps its heading. Handle
// lengths are preserved, so the segment either side keeps its weight.
void applyTangentConstraint(PointList& pts, std::size_t index, const Vec2& newAnchor,
                            const Vec2& lockedDirection);

// Force the two handles at an anchor collinear, each keeping its own length.
// Returns false when there is no direction to be had - both handles retracted.
bool enforceSmooth(PointList& pts, std::size_t index);

// Where an anchor would land if it snapped to make the path tangent to a
// circle: the nearest point on the circle itself, plus the tangent direction
// there. Returns false if the circle is degenerate.
bool tangentSnapToCircle(const Circle& c, const Vec2& query, Vec2& outPoint, Vec2& outDirection);

// ------------------------------------------------------------- extending

// How a path is continued past its end.
enum class ExtendMode {
    SingleBezier,     // push the terminal cubic's parameter range past t=1
    ConstantRadius,   // a circular arc at the curvature the path already has
    Straight,         // a straight run along the end tangent
    Spiral            // a logarithmic spiral starting at that curvature
};

// Everything needed to continue a path from one of its ends.
struct EndFrame {
    Vec2 point;              // the endpoint
    Vec2 tangent;            // unit, pointing outward, away from the path
    double radius = 0.0;     // radius of curvature; huge where the end is flat
    Vec2 centre;             // centre of curvature
    bool curved = false;     // false when there is no curvature to continue
};

// Read the frame at one end of an open path.
//
// The curvature radius comes from a circle fitted to the terminal segment where
// that segment is genuinely circular, not from the pointwise curvature. A
// bezier quarter circle's endpoint curvature is 2.2% larger than the circle it
// draws, which is inherent to the four-cubic approximation, and an arc built on
// it drifts visibly off the shape the user can see.
bool endFrame(const PointList& pts, bool closed, bool atStart, EndFrame& out);

// Build the run that continues a path, starting at the frame's own endpoint.
// Empty when the mode cannot be built.
PointList buildExtension(const EndFrame& frame, ExtendMode mode, double length,
                         double spiralWinding);

// Join a run built outward from an end back onto the path. The run's first
// point coincides with the existing endpoint and is merged into it rather than
// duplicated.
PointList attachExtension(const PointList& pts, const PointList& run, bool atStart);

// Shorten from one end by an arc length, dropping whole segments and splitting
// the one the cut lands in. Empty if nothing would be left.
PointList trimEnd(const PointList& pts, bool atStart, double amount);

// Reverse a run, swapping each point's in and out handles with it.
PointList reversed(const PointList& pts);

}  // namespace chisel

#endif  // CHISEL_HIT_H
