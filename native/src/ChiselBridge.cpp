#include "ChiselBridge.h"

#include <cmath>
#include <cstdio>

namespace chisel {
namespace {

const char* kDictKey = "Chisel";

// Percent-escape the three characters that would break the flat encoding. The
// % has to go first, or unescaping is ambiguous. Identical to metaEsc in
// jsx/chisel-meta.jsx; the two must stay in step.
std::string escape(const std::string& s) {
    std::string out;
    out.reserve(s.size());
    for (char c : s) {
        switch (c) {
            case '%': out += "%25"; break;
            case ';': out += "%3B"; break;
            case '=': out += "%3D"; break;
            case '\r': out += "%0D"; break;
            case '\n': out += "%0A"; break;
            default: out += c; break;
        }
    }
    return out;
}

std::string unescape(const std::string& s) {
    std::string out;
    out.reserve(s.size());
    for (std::size_t i = 0; i < s.size(); ++i) {
        if (s[i] == '%' && i + 2 < s.size()) {
            const std::string code = s.substr(i + 1, 2);
            if (code == "25") { out += '%'; i += 2; continue; }
            if (code == "3B") { out += ';'; i += 2; continue; }
            if (code == "3D") { out += '='; i += 2; continue; }
            if (code == "0D") { out += '\r'; i += 2; continue; }
            if (code == "0A") { out += '\n'; i += 2; continue; }
        }
        out += s[i];
    }
    return out;
}

}  // namespace

// ------------------------------------------------------------ conversion

AIRealPoint toAI(const Vec2& v) {
    AIRealPoint p;
    p.h = static_cast<AIReal>(v.x);
    p.v = static_cast<AIReal>(v.y);
    return p;
}

Vec2 fromAI(const AIRealPoint& p) {
    return Vec2(static_cast<double>(p.h), static_cast<double>(p.v));
}

bool readPath(AIArtHandle art, PointList& out, bool& closed) {
    out.clear();
    if (art == nullptr || g.path == nullptr || g.art == nullptr) { return false; }

    short type = 0;
    if (g.art->GetArtType(art, &type) != kNoErr || type != kPathArt) { return false; }

    ai::int16 count = 0;
    if (g.path->GetPathSegmentCount(art, &count) != kNoErr || count < 2) { return false; }

    std::vector<AIPathSegment> segs(static_cast<std::size_t>(count));
    if (g.path->GetPathSegments(art, 0, count, segs.data()) != kNoErr) { return false; }

    AIBoolean isClosed = false;
    g.path->GetPathClosed(art, &isClosed);
    closed = (isClosed != 0);

    out.reserve(segs.size());
    for (const AIPathSegment& s : segs) {
        PathPoint p;
        p.anchor = fromAI(s.p);
        p.in = fromAI(s.in);
        p.out = fromAI(s.out);
        // Illustrator stores the corner flag; smooth is its complement. Note
        // this is the stored intent, not a geometric test - a point flagged
        // smooth can still have handles that disagree, which is exactly the
        // decay the tangent lock exists to prevent.
        p.smooth = (s.corner == 0);
        out.push_back(p);
    }
    return true;
}

bool writePath(AIArtHandle art, const PointList& pts, bool closed) {
    if (art == nullptr || g.path == nullptr || pts.size() < 2) { return false; }

    const ai::int16 count = static_cast<ai::int16>(pts.size());
    if (g.path->SetPathSegmentCount(art, count) != kNoErr) { return false; }

    std::vector<AIPathSegment> segs(pts.size());
    for (std::size_t i = 0; i < pts.size(); ++i) {
        segs[i].p = toAI(pts[i].anchor);
        segs[i].in = toAI(pts[i].in);
        segs[i].out = toAI(pts[i].out);
        segs[i].corner = pts[i].smooth ? false : true;
    }
    if (g.path->SetPathSegments(art, 0, count, segs.data()) != kNoErr) { return false; }

    g.path->SetPathClosed(art, closed ? true : false);
    return true;
}

bool collectPaths(std::vector<PathHandle>& out) {
    out.clear();
    if (g.artSet == nullptr || g.art == nullptr) { return false; }

    AIArtSpec spec;
    spec.type = kPathArt;
    // Every path, not just the selection: a tool has to hit-test artwork the
    // user has not selected yet, which is the entire point of having a tool.
    spec.whichAttr = 0;
    spec.attr = 0;

    // AIArtSet rather than the raw GetMatchingArt handle. The raw form hands
    // back a memory handle the caller has to dispose through a separate suite,
    // and every early-return in this function would be a leak.
    AIArtSet set = nullptr;
    if (g.artSet->NewArtSet(&set) != kNoErr) { return false; }
    if (g.artSet->MatchingArtSet(&spec, 1, set) != kNoErr) {
        g.artSet->DisposeArtSet(&set);
        return false;
    }

    std::size_t count = 0;
    g.artSet->CountArtSet(set, &count);

    for (std::size_t i = 0; i < count; ++i) {
        AIArtHandle art = nullptr;
        if (g.artSet->IndexArtSet(set, i, &art) != kNoErr || art == nullptr) { continue; }

        ai::int32 attr = 0;
        g.art->GetArtUserAttr(art, kArtHidden | kArtLocked | kArtSelected, &attr);
        if ((attr & kArtHidden) != 0 || (attr & kArtLocked) != 0) { continue; }

        PathHandle ph;
        ph.art = art;
        bool closed = false;
        if (!readPath(art, ph.ref.points, closed)) { continue; }
        ph.ref.closed = closed;
        ph.ref.hasSelection = (attr & kArtSelected) != 0;
        out.push_back(ph);
    }

    g.artSet->DisposeArtSet(&set);
    return true;
}

bool collectCircles(const std::vector<PathHandle>& paths, std::vector<CircleHandle>& out) {
    out.clear();
    for (const PathHandle& p : paths) {
        if (!p.ref.closed) { continue; }

        std::vector<Vec2> anchors;
        anchors.reserve(p.ref.points.size());
        for (const PathPoint& pt : p.ref.points) { anchors.push_back(pt.anchor); }

        const CircleFit fit = recogniseCircle(anchors, samplePath(p.ref.points, true, 6));
        if (!fit.ok) { continue; }

        CircleHandle ch;
        ch.art = p.art;
        ch.circle = fit.circle;
        out.push_back(ch);
    }
    return true;
}

// -------------------------------------------------------------- metadata

std::string serialiseRecord(const Record& rec) {
    std::string out;
    for (const auto& kv : rec) {
        if (!out.empty()) { out += ';'; }
        out += escape(kv.first);
        out += '=';
        out += escape(kv.second);
    }
    return out;
}

Record parseRecord(const std::string& text) {
    Record out;
    std::size_t start = 0;
    while (start <= text.size()) {
        std::size_t end = text.find(';', start);
        if (end == std::string::npos) { end = text.size(); }
        const std::string pair = text.substr(start, end - start);
        const std::size_t eq = pair.find('=');
        if (eq != std::string::npos) {
            out.emplace_back(unescape(pair.substr(0, eq)), unescape(pair.substr(eq + 1)));
        }
        if (end == text.size()) { break; }
        start = end + 1;
    }
    return out;
}

std::string recordValue(const Record& rec, const std::string& key, const std::string& fallback) {
    for (const auto& kv : rec) {
        if (kv.first == key) { return kv.second; }
    }
    return fallback;
}

void setRecordValue(Record& rec, const std::string& key, const std::string& value) {
    for (auto& kv : rec) {
        if (kv.first == key) { kv.second = value; return; }
    }
    rec.emplace_back(key, value);
}

bool readRecord(AIArtHandle art, Record& out) {
    out.clear();
    if (art == nullptr || g.art == nullptr || g.dictionary == nullptr) { return false; }

    AIDictionaryRef dict = nullptr;
    if (g.art->GetDictionary(art, &dict) != kNoErr || dict == nullptr) { return false; }

    const AIDictKey key = g.dictionary->Key(kDictKey);
    ai::UnicodeString value;
    const ASErr err = g.dictionary->GetUnicodeStringEntry(dict, key, value);
    g.dictionary->Release(dict);

    if (err != kNoErr) { return false; }
    out = parseRecord(value.as_UTF8());
    return !out.empty();
}

bool writeRecord(AIArtHandle art, const Record& rec) {
    if (art == nullptr || g.art == nullptr || g.dictionary == nullptr) { return false; }

    AIDictionaryRef dict = nullptr;
    if (g.art->GetDictionary(art, &dict) != kNoErr || dict == nullptr) { return false; }

    const AIDictKey key = g.dictionary->Key(kDictKey);
    const ai::UnicodeString value(serialiseRecord(rec).c_str());
    const ASErr err = g.dictionary->SetUnicodeStringEntry(dict, key, value);
    g.dictionary->Release(dict);
    return err == kNoErr;
}

bool clearRecord(AIArtHandle art) {
    if (art == nullptr || g.art == nullptr || g.dictionary == nullptr) { return false; }

    AIDictionaryRef dict = nullptr;
    if (g.art->GetDictionary(art, &dict) != kNoErr || dict == nullptr) { return false; }

    const AIDictKey key = g.dictionary->Key(kDictKey);
    const ASErr err = g.dictionary->DeleteEntry(dict, key);
    g.dictionary->Release(dict);
    return err == kNoErr;
}

// ---------------------------------------------------------------- screen

double documentUnitsPerPixel() {
    if (g.view == nullptr) { return 1.0; }

    AIDocumentViewHandle viewHandle = nullptr;
    if (g.view->GetNthDocumentView(0, &viewHandle) != kNoErr) { return 1.0; }

    AIReal zoom = 1.0;
    if (g.view->GetDocumentViewZoom(viewHandle, &zoom) != kNoErr || zoom <= 0.0) { return 1.0; }
    return 1.0 / static_cast<double>(zoom);
}

AIPoint artworkToView(const Vec2& p) {
    AIPoint out;
    out.h = 0;
    out.v = 0;
    if (g.view == nullptr) { return out; }

    AIDocumentViewHandle viewHandle = nullptr;
    if (g.view->GetNthDocumentView(0, &viewHandle) != kNoErr) { return out; }

    const AIRealPoint art = toAI(p);
    g.view->ArtworkPointToViewPoint(viewHandle, &art, &out);
    return out;
}

}  // namespace chisel
