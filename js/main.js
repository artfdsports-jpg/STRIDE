/* Chisel panel controller
   Builds argument literals from the UI, dispatches into the ExtendScript
   engine, and keeps the selection readout live. */

(function () {
  "use strict";

  var cs = null;
  try { cs = new CSInterface(); } catch (e) { cs = null; }

  var $ = function (id) { return document.getElementById(id); };
  var statusEl = $("status");

  function say(msg, kind) {
    statusEl.textContent = msg;
    statusEl.className = "status" + (kind ? " " + kind : "");
  }

  if (!cs) {
    say("CSInterface.js is missing from /js. See README.", "err");
  }

  function num(id, d) {
    var v = parseFloat($(id).value);
    return isNaN(v) ? d : v;
  }
  function checked(id) { return $(id).checked; }

  // --- Segmented controls ------------------------------------------------

  var segState = {};

  function initSeg(id, def) {
    segState[id] = def;
    var wrap = $(id);
    if (!wrap) { return; }
    wrap.addEventListener("click", function (ev) {
      var b = ev.target.closest("button");
      if (!b) { return; }
      var kids = wrap.querySelectorAll("button");
      for (var i = 0; i < kids.length; i++) { kids[i].classList.remove("on"); }
      b.classList.add("on");
      segState[id] = b.getAttribute("data-val");
    });
  }

  initSeg("whichSeg", "both");
  initSeg("addSeg", "equal");
  initSeg("tanSeg", "both");
  initSeg("cnType", "regular");
  initSeg("cnMethod", "trueRadius");
  initSeg("roKind", "hypo");
  initSeg("dlSrc", "anchors");

  // --- Argument builders -------------------------------------------------
  // Each returns a JS object literal STRING, because ExtendScript has no JSON.

  function lit(obj) {
    var parts = [], k, v;
    for (k in obj) {
      if (!obj.hasOwnProperty(k)) { continue; }
      v = obj[k];
      if (typeof v === "string") { parts.push(k + ":'" + v.replace(/'/g, "") + "'"); }
      else if (typeof v === "boolean") { parts.push(k + ":" + (v ? "true" : "false")); }
      else { parts.push(k + ":" + v); }
    }
    return "{" + parts.join(",") + "}";
  }

  var ARGS = {
    smartRemoveArgs: function () { return lit({ tol: num("srTol", 10), smart: true }); },
    dumbRemoveArgs: function () { return lit({ tol: num("srTol", 10), smart: false }); },
    smoothArgs: function () { return lit({ ratio: num("smRatio", 0.4), addHandles: true }); },

    scaleArgs: function () { return lit({ mode: "scale", value: num("hScale", 80) / 100, which: segState.whichSeg }); },
    rotArgs: function () { return lit({ mode: "rotate", value: num("hRot", 15), which: segState.whichSeg }); },
    incArgs: function () { return lit({ mode: "increment", value: num("hInc", 5), which: segState.whichSeg }); },
    lenArgs: function () { return lit({ mode: "setLength", value: num("hLen", 40), which: segState.whichSeg }); },
    angArgs: function () { return lit({ mode: "setAngle", value: num("hAng", 0), which: segState.whichSeg }); },

    addArgs: function () {
      return lit({
        mode: segState.addSeg,
        count: num("apCount", 1),
        dist: num("apDist", 20),
        centre: checked("apCentre")
      });
    },

    tanAddArgs: function () { return lit({ axis: segState.tanSeg, remove: false }); },
    tanMoveArgs: function () { return lit({ axis: segState.tanSeg, remove: true, tol: num("srTol", 10) }); },

    cornerArgs: function () {
      return lit({ radius: num("cnRadius", 12), type: segState.cnType, method: segState.cnMethod });
    },

    closeSmoothArgs: function () { return lit({ mode: "smooth", ratio: num("smRatio", 0.4) }); },

    pxArgs: function () {
      return lit({
        cut: false,
        ignoreSelf: checked("pxSelf"),
        topOnly: checked("pxTop"),
        keepTop: checked("pxKeep")
      });
    },

    patternArgs: function () {
      return lit({ mode: "pattern", initSkip: num("sSkip0", 0), take: num("sTake", 1), skip: num("sSkip", 1) });
    },

    rouletteArgs: function () {
      return lit({
        kind: segState.roKind,
        ratioR: num("roR1", 10),
        ratioS: num("roS1", 3),
        R: num("roRa", 200),
        R2: num("roRb", 200),
        D: num("roDa", 100),
        D2: num("roDb", 100),
        count: num("roCount", 1),
        rotate: num("roRot", 0),
        weight: num("roW", 0.5),
        accuracy: num("roAcc", 3),
        centreOnScreen: checked("roCentre")
      });
    },

    delaunayArgs: function () {
      return lit({ source: segState.dlSrc, minAngle: num("dlAngle", 0), keep: checked("dlKeep") });
    }
  };

  // --- Dispatch ----------------------------------------------------------

  function run(cmd, argSpec, intoId) {
    if (!cs) { say("CSInterface.js is missing from /js.", "err"); return; }
    var args = "{}";
    if (argSpec) {
      if (ARGS[argSpec]) { args = ARGS[argSpec](); }
      else { args = argSpec; } // inline literal written straight into the markup
    }
    var call = 'chiselRun("' + cmd + '", "' + args.replace(/"/g, '\\"') + '")';
    say("Working...");
    cs.evalScript(call, function (res) {
      if (intoId) {
        var t = $(intoId);
        if (t) { t.textContent = res + " redundant point(s) in the selection."; }
        say("Counted.", "ok");
      } else {
        var bad = (res || "").indexOf("Error") === 0 ||
                  (res || "").indexOf("No ") === 0 ||
                  (res || "").indexOf("Select") === 0 ||
                  (res || "").indexOf("Open ") === 0 ||
                  (res || "").indexOf("Need ") === 0 ||
                  (res || "").indexOf("Nothing") === 0;
        say(res || "Done.", bad ? "err" : "ok");
      }
      refresh();
    });
  }

  document.addEventListener("click", function (ev) {
    var b = ev.target.closest("button[data-cmd]");
    if (!b) { return; }
    run(b.getAttribute("data-cmd"), b.getAttribute("data-args"), b.getAttribute("data-into"));
  });

  // --- Accordion ---------------------------------------------------------

  var heads = document.querySelectorAll(".sec > h2");
  for (var i = 0; i < heads.length; i++) {
    heads[i].addEventListener("click", function () {
      this.parentNode.classList.toggle("open");
    });
  }

  // --- Slider outputs ----------------------------------------------------

  function bindOut(sliderId, outId) {
    var s = $(sliderId), o = $(outId);
    if (!s || !o) { return; }
    o.textContent = s.value;
    s.addEventListener("input", function () { o.textContent = s.value; });
  }
  bindOut("srTol", "srTolOut");
  bindOut("roAcc", "roAccOut");

  // --- Live selection readout -------------------------------------------

  var lastSig = "";

  function refresh() {
    if (!cs) { return; }
    cs.evalScript('chiselRun("info","{}")', function (res) {
      if (!res || res.indexOf("|") < 0) { return; }
      var p = res.split("|");
      $("rPaths").textContent = p[0];
      $("rPts").textContent = p[1];
      $("rSel").textContent = p[2];
      lastSig = res;
    });
  }

  // Illustrator fires no granular selection event to CEP, so poll gently.
  setInterval(refresh, 900);
  refresh();

  // Persist panel state between sessions
  try {
    var saved = window.localStorage.getItem("chisel.open");
    if (saved) {
      var open = saved.split(",");
      var secs = document.querySelectorAll(".sec");
      for (var s = 0; s < secs.length; s++) {
        secs[s].classList.toggle("open", open.indexOf(secs[s].getAttribute("data-sec")) >= 0);
      }
    }
    window.addEventListener("beforeunload", function () {
      var on = [], secs2 = document.querySelectorAll(".sec.open"), k;
      for (k = 0; k < secs2.length; k++) { on.push(secs2[k].getAttribute("data-sec")); }
      window.localStorage.setItem("chisel.open", on.join(","));
    });
  } catch (e2) {}

})();
