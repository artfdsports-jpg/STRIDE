/* Chisel panel controller
   Builds argument literals from the UI, dispatches into the ExtendScript
   engine, and keeps the point inspector and constraint readout live. */

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
      if (id === "spaceSeg" || id === "unitSeg") { tick(true); }
    });
  }

  initSeg("whichSeg", "both");
  initSeg("addSeg", "equal");
  initSeg("tanSeg", "both");
  initSeg("cnType", "regular");
  initSeg("cnMethod", "trueRadius");
  initSeg("roKind", "hypo");
  initSeg("dlSrc", "anchors");
  initSeg("nudgeTarget", "anchor");
  initSeg("insMode", "length");
  initSeg("spaceSeg", "artboard");
  initSeg("unitSeg", "pt");
  initSeg("tcStyle", "belt");
  initSeg("tcSide", "1");
  initSeg("tkMode", "ee");
  initSeg("tkPick", "0");
  initSeg("tpSide", "1");
  initSeg("wMode", "shape");

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

  // Space and units ride along with everything the inspector touches, so a
  // value typed in millimetres is never applied as points.
  function view() {
    return { space: segState.spaceSeg, units: segState.unitSeg };
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
    },

    // --- Tangency ---

    tanConnectArgs: function () {
      return lit({
        style: segState.tcStyle,
        crossed: checked("tcCrossed"),
        side: parseFloat(segState.tcSide)
      });
    },
    tanCircleArgs: function () {
      return lit({
        radius: num("tkRadius", 50),
        mode: segState.tkMode,
        pick: parseFloat(segState.tkPick)
      });
    },
    tanPointArgs: function () { return lit({ side: parseFloat(segState.tpSide) }); },
    weldArgs: function () { return lit({ g1: checked("wG1"), mode: segState.wMode }); },

    // --- Path tool ---

    insertArgs: function () {
      var o = view();
      o.at = num("insAt", 0.5);
      o.mode = segState.insMode;
      return lit(o);
    }
  };

  // --- Dispatch ----------------------------------------------------------

  function call(cmd, argLiteral, done) {
    if (!cs) { say("CSInterface.js is missing from /js.", "err"); return; }
    var js = 'chiselRun("' + cmd + '", "' + argLiteral.replace(/"/g, '\\"') + '")';
    cs.evalScript(js, done || function () {});
  }

  /*
   * A reply is bad news if it reads like an instruction rather than a result.
   * The engine deliberately returns prose, so this sniffs the openings it uses
   * for refusals rather than threading a status code through every command.
   */
  function isRefusal(res) {
    return /^(Error|No |Select|Open |Need |Nothing|One circle|These circles|Neither|Radius|That |Position)/.test(res || "");
  }

  function run(cmd, argSpec, intoId) {
    var args = "{}";
    if (argSpec) {
      if (ARGS[argSpec]) { args = ARGS[argSpec](); }
      else { args = argSpec; } // inline literal written straight into the markup
    }
    say("Working...");
    call(cmd, args, function (res) {
      if (intoId) {
        var t = $(intoId);
        if (t) { t.textContent = res + " redundant point(s) in the selection."; }
        say("Counted.", "ok");
      } else {
        say(res || "Done.", isRefusal(res) ? "err" : "ok");
      }
      // A command may have created or destroyed locked geometry, so the stored
      // fingerprint is stale. Refreshing it here stops the very next poll from
      // firing a solve, and a spurious undo step with it.
      LIVE.hash = "";
      tick(true);
      refreshConstraints();
    });
  }

  document.addEventListener("click", function (ev) {
    var b = ev.target.closest("button[data-cmd]");
    if (!b) { return; }
    run(b.getAttribute("data-cmd"), b.getAttribute("data-args"), b.getAttribute("data-into"));
  });

  // --- Tabs --------------------------------------------------------------

  var tabsEl = $("tabs");
  tabsEl.addEventListener("click", function (ev) {
    var b = ev.target.closest("button[data-tab]");
    if (!b) { return; }
    showTab(b.getAttribute("data-tab"));
  });

  function showTab(name) {
    var i, btns = tabsEl.querySelectorAll("button"), panes = document.querySelectorAll(".tab");
    for (i = 0; i < btns.length; i++) {
      btns[i].classList.toggle("on", btns[i].getAttribute("data-tab") === name);
    }
    for (i = 0; i < panes.length; i++) {
      panes[i].classList.toggle("on", panes[i].getAttribute("data-tab") === name);
    }
    $("scroll").scrollTop = 0;
    try { window.localStorage.setItem("chisel.tab", name); } catch (e) {}
    if (name === "tangent") { refreshConstraints(); }
  }

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

  // --- The live loop -----------------------------------------------------

  /*
   * Illustrator sends CEP no event when the selection or the artwork changes,
   * so everything live here is polled. One call per tick does both jobs: read
   * the focused anchor, and re-solve locked geometry if a driver moved.
   *
   * busy guards against overlap. evalScript is asynchronous, and on a heavy
   * document a solve can outlast the interval; without the guard the calls
   * stack up and the panel stops responding.
   */
  var LIVE = { hash: "", busy: false };

  var FIELDS = [
    { id: "fX", key: "x", mix: "mixX", dp: 3 },
    { id: "fY", key: "y", mix: "mixY", dp: 3 },
    { id: "fInLen", key: "inLen", mix: "mixIn", dp: 3, needs: "hasIn" },
    { id: "fInAng", key: "inAng", dp: 2, needs: "hasIn" },
    { id: "fOutLen", key: "outLen", mix: "mixOut", dp: 3, needs: "hasOut" },
    { id: "fOutAng", key: "outAng", dp: 2, needs: "hasOut" }
  ];

  function tick(force) {
    if (!cs || (LIVE.busy && !force)) { return; }
    var o = view();
    o.sync = checked("autoSync");
    o.hash = LIVE.hash;
    LIVE.busy = true;
    call("tick", lit(o), function (res) {
      LIVE.busy = false;
      applyTick(res);
    });
  }

  // The engine's flat key=value record, decoded.
  function parseRec(s) {
    var out = {}, i, kv, pairs = String(s || "").split(";");
    for (i = 0; i < pairs.length; i++) {
      if (!pairs[i].length) { continue; }
      kv = pairs[i].split("=");
      if (kv.length < 2) { continue; }
      out[unesc(kv[0])] = unesc(kv.slice(1).join("="));
    }
    return out;
  }
  function unesc(s) {
    return String(s)
      .replace(/%0A/g, "\n").replace(/%0D/g, "\r")
      .replace(/%3D/g, "=").replace(/%3B/g, ";").replace(/%25/g, "%");
  }

  function fmt(v, dp) {
    if (v === undefined || v === null || v === "" || isNaN(parseFloat(v))) { return "—"; }
    var n = parseFloat(v);
    var s = n.toFixed(dp === undefined ? 2 : dp);
    if (s.indexOf(".") >= 0) { s = s.replace(/0+$/, "").replace(/\.$/, ""); }
    return s;
  }

  function unitLabel() { return segState.unitSeg; }

  function applyTick(res) {
    var r = parseRec(res);

    if (r.shash) { LIVE.hash = r.shash; }
    if (r.solved !== undefined) {
      var broken = parseFloat(r.sbroken || 0);
      say("Rebuilt " + r.solved + " locked object" + (r.solved === "1" ? "" : "s") +
          (broken ? ", " + broken + " could not be built" : "") + ".",
          broken ? "err" : "ok");
      refreshConstraints();
    }

    if (r.state !== "ok") {
      $("rPaths").textContent = "0";
      $("rPts").textContent = "0";
      $("rSel").textContent = "0";
      setAnchorLabel("no selection", false);
      clearFields();
      clearMeters();
      return;
    }

    $("rPaths").textContent = r.paths || "0";
    $("rPts").textContent = r.pts || "0";
    $("rSel").textContent = r.sel || "0";

    var idx = parseFloat(r.idx);
    var nSel = parseFloat(r.sel || 0);
    var live = !isNaN(idx) && idx >= 0;

    if (live) {
      setAnchorLabel(
        "Anchor " + (idx + 1) + " of " + r.pts +
          (nSel > 1 ? "  (+" + (nSel - 1) + ")" : "") +
          "  " + (r.type === "s" ? "smooth" : "corner"),
        r.locked === "1"
      );
    } else {
      setAnchorLabel(r.pts + " points, none selected", false);
    }

    var i, f, el, avail;
    for (i = 0; i < FIELDS.length; i++) {
      f = FIELDS[i];
      el = $(f.id);
      avail = live && (!f.needs || r[f.needs] === "1");
      el.disabled = !avail;
      el.classList.toggle("mixed", !!(f.mix && r[f.mix] === "1"));
      // Never overwrite the field the user is typing into.
      if (document.activeElement === el) { continue; }
      el.value = avail ? fmt(r[f.key], f.dp) : "";
    }

    var u = unitLabel();
    $("mSegPrev").textContent = seg(r.segPrev, u);
    $("mSegNext").textContent = seg(r.segNext, u);
    $("mCurv").textContent = live
      ? (curv(r.curvIn) + " / " + curv(r.curvOut))
      : "—";
    $("mLen").textContent = fmt(r.len, 2) + " " + u;
    $("mArea").textContent = (r.closed === "1") ? (fmt(r.area, 1) + " " + u + "²") : "—";
  }

  function seg(v, u) {
    var n = parseFloat(v);
    if (isNaN(n) || n < 0) { return "—"; }
    return fmt(n, 2) + " " + u;
  }

  /*
   * A straight segment has infinite radius of curvature. Showing a nine digit
   * number there is noise; the useful reading is that it is flat.
   */
  function curv(v) {
    var n = parseFloat(v);
    if (isNaN(n)) { return "—"; }
    if (!isFinite(n) || n > 1e6) { return "flat"; }
    return fmt(n, 1);
  }

  function setAnchorLabel(text, locked) {
    var el = $("anchorLbl");
    el.textContent = text;
    el.classList.toggle("locked", !!locked);
  }

  function clearFields() {
    for (var i = 0; i < FIELDS.length; i++) {
      var el = $(FIELDS[i].id);
      el.value = "";
      el.disabled = true;
      el.classList.remove("mixed");
    }
  }

  function clearMeters() {
    var ids = ["mSegPrev", "mSegNext", "mCurv", "mLen", "mArea"], i;
    for (i = 0; i < ids.length; i++) { $(ids[i]).textContent = "—"; }
  }

  // --- Committing typed values -------------------------------------------

  /*
   * change fires on Enter, on blur after an edit, and on the number stepper,
   * which is every way a value gets committed. It does not fire when the poll
   * writes a value in, so the loop cannot trigger an edit of its own.
   *
   * Only the field that changed is sent. Sending the whole record would let a
   * stale Y ride along with a deliberate X.
   */
  for (i = 0; i < FIELDS.length; i++) {
    (function (f) {
      var el = $(f.id);
      el.addEventListener("change", function () {
        var v = parseFloat(el.value);
        if (isNaN(v)) { tick(true); return; }
        var o = view();
        o[f.key] = v;
        run("applyPoint", lit(o));
      });
      el.addEventListener("keydown", function (ev) {
        if (ev.key === "Escape") { el.blur(); tick(true); }
      });
    })(FIELDS[i]);
  }

  document.addEventListener("click", function (ev) {
    var b = ev.target.closest("button[data-nudge]");
    if (b) {
      var d = b.getAttribute("data-nudge").split(",");
      var step = num("nStep", 1);
      var o = view();
      o.dx = parseFloat(d[0]) * step;
      o.dy = parseFloat(d[1]) * step;
      o.target = segState.nudgeTarget;
      run("nudgePoint", lit(o));
      return;
    }
    var s = ev.target.closest("button[data-step]");
    if (s) { run("stepPoint", lit({ to: s.getAttribute("data-step") })); }
  });

  // --- Constraint readout ------------------------------------------------

  function refreshConstraints() {
    if (!cs) { return; }
    call("constraintsInfo", "{}", function (res) {
      if (!res || res.indexOf("|") < 0) { return; }
      var p = res.split("|");
      $("cLinks").textContent = p[0];
      $("cCircles").textContent = p[1];
      $("cLocks").textContent = p[2];
      $("cWelds").textContent = p[3];
      $("cBroken").textContent = p[4];
      $("cBroken").style.color = (p[4] !== "0") ? "#d98166" : "";
    });
  }

  // --- Boot --------------------------------------------------------------

  /*
   * The engine self-boots from $.fileName when Illustrator loads it as
   * ScriptPath, but that probe is empty in some hosting situations. The path
   * CSInterface reports is authoritative, so re-boot from it and surface any
   * module that failed to parse instead of leaving half a panel that silently
   * does nothing.
   */
  function boot() {
    if (!cs) { return; }
    var root = "";
    try { root = cs.getSystemPath(SystemPath.EXTENSION); } catch (e) { root = ""; }
    root = String(root).replace(/\\/g, "/").replace(/"/g, "").replace(/\/+$/, "");
    if (!root.length) {
      say("Cannot locate the extension folder. Tangency features are unavailable.", "err");
      return;
    }
    cs.evalScript('chiselBoot("' + root + '/jsx")', function (res) {
      if (String(res).indexOf("ok") === 0) {
        say("Ready.");
        tick(true);
        refreshConstraints();
      } else {
        say(String(res), "err");
      }
    });
  }

  // Restore the tab and open sections from last session before the first poll,
  // so the panel does not visibly rearrange itself on open.
  try {
    var savedTab = window.localStorage.getItem("chisel.tab");
    if (savedTab) { showTab(savedTab); }

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

  boot();
  setInterval(tick, 350);
  setInterval(function () {
    if (document.querySelector('.tab[data-tab="tangent"]').classList.contains("on")) {
      refreshConstraints();
    }
  }, 2000);

})();
