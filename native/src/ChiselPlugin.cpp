// Plugin entry point and message dispatch.
//
// Illustrator drives a plugin entirely through one function and a pair of
// strings. Everything the plugin does begins here.

#include "AIPlugin.h"
#include "ChiselSuites.h"
#include "ChiselTool.h"
#include "SPInterf.h"

namespace {

SPPluginRef gPluginRef = nullptr;

ASErr startup(SPInterfaceMessage* message) {
    gPluginRef = message->d.self;

    ASErr err = chisel::acquireSuites(message->d.basic);
    if (err != kNoErr) { return err; }

    err = chisel::gTool.registerTool(gPluginRef);
    if (err != kNoErr) { return err; }

    // The annotator is not optional. Without it the tool still edits paths
    // correctly and feels broken, because nothing on screen responds until the
    // mouse comes up.
    return chisel::gTool.registerAnnotator(gPluginRef);
}

ASErr shutdown(SPInterfaceMessage* message) {
    return chisel::releaseSuites(message->d.basic);
}

}  // namespace

extern "C" ASErr PluginMain(char* caller, char* selector, void* message) {
    if (caller == nullptr || selector == nullptr || message == nullptr) {
        return kBadParameterErr;
    }

    // Interface: startup and shutdown.
    if (sSPBasic->IsEqual(caller, kSPInterfaceCaller)) {
        if (sSPBasic->IsEqual(selector, kSPInterfaceStartupSelector)) {
            return startup(static_cast<SPInterfaceMessage*>(message));
        }
        if (sSPBasic->IsEqual(selector, kSPInterfaceShutdownSelector)) {
            return shutdown(static_cast<SPInterfaceMessage*>(message));
        }
        return kNoErr;
    }

    // Tool: the whole gesture.
    if (sSPBasic->IsEqual(caller, kCallerAITool)) {
        AIToolMessage* toolMessage = static_cast<AIToolMessage*>(message);

        if (sSPBasic->IsEqual(selector, kSelectorAISelectTool)) {
            return chisel::gTool.selectTool(toolMessage);
        }
        if (sSPBasic->IsEqual(selector, kSelectorAIDeselectTool)) {
            return chisel::gTool.deselectTool(toolMessage);
        }
        if (sSPBasic->IsEqual(selector, kSelectorAITrackToolCursor)) {
            return chisel::gTool.trackCursor(toolMessage);
        }
        if (sSPBasic->IsEqual(selector, kSelectorAIToolMouseDown)) {
            return chisel::gTool.mouseDown(toolMessage);
        }
        if (sSPBasic->IsEqual(selector, kSelectorAIToolMouseDrag)) {
            return chisel::gTool.mouseDrag(toolMessage);
        }
        if (sSPBasic->IsEqual(selector, kSelectorAIToolMouseUp)) {
            return chisel::gTool.mouseUp(toolMessage);
        }
        return kNoErr;
    }

    // Annotation: the live preview.
    if (sSPBasic->IsEqual(caller, kCallerAIAnnotation)) {
        if (sSPBasic->IsEqual(selector, kSelectorAIDrawAnnotation)) {
            return chisel::gTool.drawAnnotation(static_cast<AIAnnotatorMessage*>(message));
        }
        return kNoErr;
    }

    return kNoErr;
}
