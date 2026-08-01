// The bridge: Illustrator art in, core geometry out, and back again.
//
// The only file that knows both vocabularies. Everything above it works in
// core::PointList and never sees an AIArtHandle; everything below is the SDK.
//
// It also owns the parametric metadata, which lives in each art object's
// dictionary under the same flat key=value encoding the CEP panel writes into
// tags. The two are deliberately the same format so a document built with the
// panel opens with its constraints intact in the plugin, and the other way
// round. Diverging them would mean a user's locked artwork silently losing its
// constraints depending on which half of Chisel they happened to be running.

#ifndef CHISEL_BRIDGE_H
#define CHISEL_BRIDGE_H

#include <string>
#include <vector>

#include "../core/ChiselGeom.h"
#include "../core/ChiselHit.h"
#include "ChiselSuites.h"

namespace chisel {

// ------------------------------------------------------------ conversion

AIRealPoint toAI(const Vec2& v);
Vec2 fromAI(const AIRealPoint& p);

// Read every segment of a path into the core's representation.
// Returns false for art that is not a path, or that has fewer than two points.
bool readPath(AIArtHandle art, PointList& out, bool& closed);

// Write a point list back. Illustrator can resize a path's segment array in
// place, so unlike the ExtendScript side there is no append-then-delete dance
// here; SetPathSegmentCount followed by SetPathSegments is the whole operation.
bool writePath(AIArtHandle art, const PointList& pts, bool closed);

// Collect the paths worth hit-testing: everything visible and unlocked in the
// current document, with their selection state recorded so handles are only
// offered on paths that are actually showing them.
struct PathHandle {
    AIArtHandle art = nullptr;
    PathRef ref;
};

bool collectPaths(std::vector<PathHandle>& out);

// Circles among the collected paths, for tangent snapping. Recognised by
// fitting, not by a stored flag, so an ellipse drawn years ago with the plain
// ellipse tool is a valid snap target.
struct CircleHandle {
    AIArtHandle art = nullptr;
    Circle circle;
};

bool collectCircles(const std::vector<PathHandle>& paths, std::vector<CircleHandle>& out);

// -------------------------------------------------------------- metadata

// A Chisel record on an art object. Flat, because the ExtendScript half has no
// JSON and the two encodings have to match exactly.
using Record = std::vector<std::pair<std::string, std::string>>;

std::string serialiseRecord(const Record& rec);
Record parseRecord(const std::string& text);

std::string recordValue(const Record& rec, const std::string& key,
                        const std::string& fallback = std::string());
void setRecordValue(Record& rec, const std::string& key, const std::string& value);

bool readRecord(AIArtHandle art, Record& out);
bool writeRecord(AIArtHandle art, const Record& rec);
bool clearRecord(AIArtHandle art);

// ---------------------------------------------------------------- screen

// Document units per screen pixel at the current zoom. Every hit tolerance is
// expressed in pixels and converted through this, so a grab target stays the
// same size on screen at every magnification. Baking a document-space tolerance
// in instead gives a tool that is unusable zoomed out and imprecise zoomed in.
double documentUnitsPerPixel();

// Convert for the annotator, which draws in view coordinates.
AIPoint artworkToView(const Vec2& p);

}  // namespace chisel

#endif  // CHISEL_BRIDGE_H
