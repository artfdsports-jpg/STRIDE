// Chisel native core: geometry.
//
// Deliberately free of every Illustrator type. Illustrator ships a major
// version each autumn and the SDK ABI moves with it; keeping the mathematics
// in a layer that knows nothing about AIRealPoint or AIArtHandle confines that
// annual break to the bridge and leaves this file alone.
//
// It is also what makes the core testable. CoreTests.cpp runs it on any
// machine with a compiler, no Illustrator and no SDK required, which is the
// difference between geometry you have checked and geometry you hope is right.
//
// The algorithms mirror jsx/chisel-tangency.jsx one for one, so a fix in either
// belongs in both. Anything here that the panel does not have - closest point
// on a curve, hit testing, coincidence hashing - exists because it only matters
// when there is a cursor, which is the whole reason this layer exists.

#ifndef CHISEL_GEOM_H
#define CHISEL_GEOM_H

#include <cstddef>
#include <vector>

namespace chisel {

// ---------------------------------------------------------------- vectors

struct Vec2 {
    double x = 0.0;
    double y = 0.0;

    Vec2() = default;
    Vec2(double ax, double ay) : x(ax), y(ay) {}
};

Vec2 operator+(const Vec2& a, const Vec2& b);
Vec2 operator-(const Vec2& a, const Vec2& b);
Vec2 operator*(const Vec2& a, double s);

double dot(const Vec2& a, const Vec2& b);
double cross(const Vec2& a, const Vec2& b);
double length(const Vec2& a);
double distance(const Vec2& a, const Vec2& b);
Vec2 normalize(const Vec2& a);
Vec2 rotate(const Vec2& a, double radians);
Vec2 fromAngle(double radians);
double angleOf(const Vec2& a);

double normalizeAngle(double radians);          // into [0, 2pi)

// ---------------------------------------------------------------- beziers

// A cubic segment, in the order Illustrator stores it: anchor, out handle,
// in handle of the next point, next anchor.
struct Cubic {
    Vec2 p0, p1, p2, p3;
};

Vec2 evaluate(const Cubic& c, double t);
Vec2 derivative(const Cubic& c, double t);
Vec2 secondDerivative(const Cubic& c, double t);
Vec2 tangentAt(const Cubic& c, double t);       // unit; falls back on degenerate handles

// Radius of curvature. Returns a very large number where the curve is flat,
// rather than infinity, so callers can compare without special-casing.
double curvatureRadius(const Cubic& c, double t);

void split(const Cubic& c, double t, Cubic& left, Cubic& right);
double arcLength(const Cubic& c, int steps = 64);
bool isStraight(const Cubic& c, double eps = 1e-6);

// Parameters where the curve runs parallel to an axis. axis 0 gives vertical
// tangencies (x' = 0), axis 1 horizontal ones (y' = 0). Strictly inside (0,1).
std::vector<double> derivativeRoots(const Cubic& c, int axis);

// The point on the segment nearest p. Coarse sampling to bracket the minimum,
// then Newton refinement. tOut is the parameter, distOut the distance.
Vec2 closestPoint(const Cubic& c, const Vec2& p, double* tOut = nullptr,
                  double* distOut = nullptr, int samples = 24);

// ---------------------------------------------------------------- circles

struct Circle {
    Vec2 centre;
    double radius = 0.0;
};

struct CircleFit {
    Circle circle;
    double deviation = 0.0;   // worst radial error, in document units
    double relative = 0.0;    // that error as a fraction of the radius
    bool ok = false;          // within tolerance to be treated as a circle
};

// Kasa algebraic fit, mean-centred for conditioning. Illustrator coordinates
// routinely sit thousands of points from the origin and the raw normal
// equations lose most of their precision there.
bool fitCircle(const std::vector<Vec2>& samples, Circle& out, double* worstDev = nullptr);

// Recognise a closed path as a circle. Fit the anchors, which lie exactly on
// the true circle, then verify against densely sampled curve points. Fitting
// the samples instead returns a radius about 0.03% too large, because a bezier
// circle bulges outward between its anchors, and every tangent built from that
// radius inherits the error.
CircleFit recogniseCircle(const std::vector<Vec2>& anchors,
                          const std::vector<Vec2>& denseSamples,
                          double tolerance = 0.004);

// ---------------------------------------------------------------- tangents

struct TangentPair {
    Vec2 direction;   // unit; the shared radius direction for external tangents
    double angle = 0.0;
    int side = 0;     // +1 or -1, stable as the circles move
    Vec2 pointA;
    Vec2 pointB;
};

// External (open belt): both radius vectors point the same way.
// Exists unless one circle lies strictly inside the other.
std::vector<TangentPair> externalTangents(const Circle& a, const Circle& b);

// Internal (crossed belt): the line passes between the circles.
// Exists only when they are clear of each other.
std::vector<TangentPair> internalTangents(const Circle& a, const Circle& b);

struct PointTangent {
    int side = 0;
    Vec2 point;       // where it touches the circle
    double length = 0.0;
};

// Tangents from an external point. The half angle at p is asin(r/d) - the
// right angle is at the tangent point, not at p.
std::vector<PointTangent> tangentsFromPoint(const Vec2& p, const Circle& c);

std::vector<Vec2> circleIntersections(const Circle& a, const Circle& b);

// A circle of the given radius touching both. mode is two characters, one per
// driver: 'e' to sit outside it, 'i' to wrap around it.
std::vector<Circle> tangentCircles(const Circle& a, const Circle& b,
                                   double radius, const char* mode = "ee");

// ------------------------------------------------------------------ paths

// A path point in Illustrator's own terms: handles are absolute positions, not
// offsets from the anchor.
struct PathPoint {
    Vec2 anchor;
    Vec2 in;
    Vec2 out;
    bool smooth = false;
};

using PointList = std::vector<PathPoint>;

Cubic segmentAt(const PointList& pts, std::size_t i, bool closed);
std::size_t segmentCount(const PointList& pts, bool closed);

// A circular arc as cubics, split at 90 degrees or finer, using the standard
// k = 4/3 tan(sweep/4). Endpoint handles come back retracted, because an arc is
// nearly always stitched to a straight tangent there.
PointList arcPoints(const Circle& c, double a0, double a1, bool counterClockwise);

// The arc between two angles that passes through `via`, direction chosen for
// you. Which of the two arcs belongs to an outline is decided by what it has
// to wrap around, not by which is shorter.
PointList arcThrough(const Circle& c, double a0, double a1, double via);

PointList linePoints(const Vec2& a, const Vec2& b);

// The belt: one closed outline wrapping both circles and joined along their
// common tangents. Empty when the circles admit no such tangent.
PointList beltOutline(const Circle& a, const Circle& b, bool crossed);

// One common tangent as an open two-point run. side selects which.
PointList tangentSegment(const Circle& a, const Circle& b, bool crossed, int side);

// Enclosed area by Green's theorem with three-point Gauss-Legendre, which is
// exact for cubics. Shoelace over a sampled polygon under-reports a circle by
// more than half a percent.
double enclosedArea(const PointList& pts, bool closed);
double pathLength(const PointList& pts, bool closed);

std::vector<Vec2> samplePath(const PointList& pts, bool closed, int perSegment = 6);

}  // namespace chisel

#endif  // CHISEL_GEOM_H
