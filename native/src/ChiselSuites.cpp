#include "ChiselSuites.h"

namespace chisel {

Suites g;

namespace {

// One row per suite. A table beats a run of hand-written AcquireSuite calls
// because the release path is then guaranteed to mirror the acquire path, and
// a suite added to one and forgotten in the other is a leak that only shows up
// as Illustrator refusing to quit cleanly.
struct SuiteRow {
    const char* name;
    int version;
    void** slot;
};

SuiteRow rows[] = {
    {kAIToolSuite,            kAIToolSuiteVersion,            reinterpret_cast<void**>(&g.tool)},
    {kAIArtSuite,             kAIArtSuiteVersion,             reinterpret_cast<void**>(&g.art)},
    {kAIPathSuite,            kAIPathSuiteVersion,            reinterpret_cast<void**>(&g.path)},
    {kAIArtSetSuite,          kAIArtSetSuiteVersion,          reinterpret_cast<void**>(&g.artSet)},
    {kAIDocumentSuite,        kAIDocumentSuiteVersion,        reinterpret_cast<void**>(&g.document)},
    {kAIDocumentViewSuite,    kAIDocumentViewSuiteVersion,    reinterpret_cast<void**>(&g.view)},
    {kAIAnnotatorSuite,       kAIAnnotatorSuiteVersion,       reinterpret_cast<void**>(&g.annotator)},
    {kAIAnnotatorDrawerSuite, kAIAnnotatorDrawerSuiteVersion, reinterpret_cast<void**>(&g.drawer)},
    {kAIDictionarySuite,      kAIDictionarySuiteVersion,      reinterpret_cast<void**>(&g.dictionary)},
    {kAIUndoSuite,            kAIUndoSuiteVersion,            reinterpret_cast<void**>(&g.undo)}
};

const int kRowCount = static_cast<int>(sizeof(rows) / sizeof(rows[0]));

}  // namespace

ASErr acquireSuites(SPBasicSuite* basic) {
    if (basic == nullptr) { return kBadParameterErr; }
    g.basic = basic;

    for (int i = 0; i < kRowCount; ++i) {
        const ASErr err = basic->AcquireSuite(rows[i].name, rows[i].version, rows[i].slot);
        if (err != kNoErr) {
            // Unwind what was acquired. A partially initialised plugin that
            // reports success is far worse than one that refuses to start: it
            // will null-dereference inside a tool callback later, in the middle
            // of the user's drag.
            for (int j = 0; j < i; ++j) {
                basic->ReleaseSuite(rows[j].name, rows[j].version);
                *rows[j].slot = nullptr;
            }
            return err;
        }
    }
    return kNoErr;
}

ASErr releaseSuites(SPBasicSuite* basic) {
    if (basic == nullptr) { return kBadParameterErr; }
    for (int i = 0; i < kRowCount; ++i) {
        if (*rows[i].slot != nullptr) {
            basic->ReleaseSuite(rows[i].name, rows[i].version);
            *rows[i].slot = nullptr;
        }
    }
    g.basic = nullptr;
    return kNoErr;
}

}  // namespace chisel
