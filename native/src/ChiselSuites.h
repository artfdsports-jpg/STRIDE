// Suite acquisition for the Chisel plugin.
//
// Everything below this line needs the Illustrator SDK on the include path and
// cannot be compiled without it. That is the boundary the architecture is built
// around: native/core holds the mathematics and compiles and tests anywhere,
// and this layer holds every Illustrator type. When the SDK ABI moves each
// autumn, this is the only part that has to move with it.
//
// Suite versions are named explicitly rather than taken from the "current"
// macros. A plugin built against kAIPathSuiteVersion silently binds to whatever
// the SDK header said that day and then fails to load against a host that ships
// a different one; naming the version you actually coded against turns that
// into a startup error you can read.

#ifndef CHISEL_SUITES_H
#define CHISEL_SUITES_H

#include "AIAnnotator.h"
#include "AIAnnotatorDrawer.h"
#include "AIArt.h"
#include "AIArtSet.h"
#include "AIDictionary.h"
#include "AIDocument.h"
#include "AIDocumentView.h"
#include "AIMatchingArt.h"
#include "AIPath.h"
#include "AITool.h"
#include "AIUndo.h"
#include "SPBasic.h"

namespace chisel {

// Acquired once at startup, released at shutdown. Raw pointers because that is
// what the SDK hands back; ownership stays with the host.
struct Suites {
    SPBasicSuite* basic = nullptr;
    AIToolSuite* tool = nullptr;
    AIArtSuite* art = nullptr;
    AIPathSuite* path = nullptr;
    AIArtSetSuite* artSet = nullptr;
    AIDocumentSuite* document = nullptr;
    AIDocumentViewSuite* view = nullptr;
    AIAnnotatorSuite* annotator = nullptr;
    AIAnnotatorDrawerSuite* drawer = nullptr;
    AIDictionarySuite* dictionary = nullptr;
    AIUndoSuite* undo = nullptr;
};

// The one instance, owned by the plugin object.
extern Suites g;

ASErr acquireSuites(SPBasicSuite* basic);
ASErr releaseSuites(SPBasicSuite* basic);

}  // namespace chisel

#endif  // CHISEL_SUITES_H
