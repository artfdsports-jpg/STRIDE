/*
 * Chisel: document metadata store
 *
 * Parametric objects and constraints have to survive a save, a close, and a
 * reopen, so they live in the .ai file itself rather than in panel memory.
 * Illustrator gives every page item a Tags collection: named string slots that
 * round-trip through the file format and stay invisible in the UI. That is
 * where Chisel keeps everything.
 *
 * The note field is deliberately left alone. Chisel 1.0 wrote roulette
 * parameters there and users read it in the Attributes panel; clobbering it
 * with constraint data would be rude.
 *
 * ExtendScript has no JSON, so records are flat "key=value;key=value" strings.
 * Flat is a real constraint on the schema, not just an encoding detail: no
 * nesting. Lists are comma joined and parsed back by hand.
 *
 * Depends on: chisel.jsx
 */

var META = {};

META.TAG = "Chisel";           // the tag name every record lives under
META.SCHEMA = 1;               // bump when a field changes meaning, never when one is added

//= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =
// 1. Encoding
//= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =

/*
 * Percent-escape the three characters that would otherwise break the format.
 * The % must be escaped first or unescaping becomes ambiguous.
 */
function metaEsc(s) {
    s = String(s);
    s = s.replace(/%/g, "%25");
    s = s.replace(/;/g, "%3B");
    s = s.replace(/=/g, "%3D");
    s = s.replace(/\r/g, "%0D");
    s = s.replace(/\n/g, "%0A");
    return s;
}

function metaUnesc(s) {
    s = String(s);
    s = s.replace(/%0A/g, "\n");
    s = s.replace(/%0D/g, "\r");
    s = s.replace(/%3D/g, "=");
    s = s.replace(/%3B/g, ";");
    s = s.replace(/%25/g, "%");
    return s;
}

/*
 * Fixed six decimals, then trailing zeros stripped. Illustrator's own numbers
 * carry float noise, and without this a circle that has not actually moved
 * serialises differently on every solve and the change detector never settles.
 */
function metaNum(v) {
    if (typeof v !== "number" || isNaN(v) || !isFinite(v)) { return "0"; }
    var s = v.toFixed(6);
    s = s.replace(/0+$/, "");
    s = s.replace(/\.$/, "");
    if (s === "-0") { s = "0"; }
    return s;
}

function metaSerialize(obj) {
    var parts = [], k, v;
    for (k in obj) {
        if (!obj.hasOwnProperty(k)) { continue; }
        v = obj[k];
        if (v === null || typeof v === "undefined") { continue; }
        if (typeof v === "number") { v = metaNum(v); }
        else if (typeof v === "boolean") { v = v ? "1" : "0"; }
        else if (v instanceof Array) { v = metaJoinNums(v); }
        parts.push(metaEsc(k) + "=" + metaEsc(v));
    }
    return parts.join(";");
}

function metaParse(str) {
    var out = {}, i, kv, pairs;
    if (!str) { return out; }
    pairs = String(str).split(";");
    for (i = 0; i < pairs.length; i++) {
        if (!pairs[i].length) { continue; }
        kv = pairs[i].split("=");
        if (kv.length < 2) { continue; }
        out[metaUnesc(kv[0])] = metaUnesc(kv.slice(1).join("="));
    }
    return out;
}

function metaJoinNums(arr) {
    var s = [], i;
    for (i = 0; i < arr.length; i++) {
        s.push(typeof arr[i] === "number" ? metaNum(arr[i]) : String(arr[i]));
    }
    return s.join(",");
}

function metaSplitNums(str) {
    var out = [], i, parts;
    if (!str || !String(str).length) { return out; }
    parts = String(str).split(",");
    for (i = 0; i < parts.length; i++) {
        out.push(parseFloat(parts[i]));
    }
    return out;
}

function metaSplitStrs(str) {
    if (!str || !String(str).length) { return []; }
    return String(str).split(",");
}

// Typed field readers. Records come back off disk as strings, always.
function metaN(rec, key, d) {
    var v = parseFloat(rec[key]);
    return isNaN(v) ? d : v;
}
function metaS(rec, key, d) {
    return (typeof rec[key] === "string" && rec[key].length) ? rec[key] : d;
}
function metaB(rec, key, d) {
    if (typeof rec[key] === "undefined") { return d; }
    return rec[key] === "1" || rec[key] === "true";
}

//= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =
// 2. Tag access
//= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =

function metaTagOf(item) {
    var i;
    try {
        for (i = 0; i < item.tags.length; i++) {
            if (item.tags[i].name === META.TAG) { return item.tags[i]; }
        }
    } catch (e) {}
    return null;
}

/* Returns the decoded record, or null if this item is not a Chisel object. */
function metaRead(item) {
    var t = metaTagOf(item), rec;
    if (!t) { return null; }
    try { rec = metaParse(t.value); } catch (e) { return null; }
    if (!rec.kind) { return null; }
    return rec;
}

function metaWrite(item, rec) {
    var t = metaTagOf(item);
    rec.v = String(META.SCHEMA);
    try {
        if (!t) {
            t = item.tags.add();
            t.name = META.TAG;
        }
        t.value = metaSerialize(rec);
        return true;
    } catch (e) { return false; }
}

/* Merge fields into an existing record, creating it if absent. */
function metaPatch(item, fields) {
    var rec = metaRead(item) || {}, k;
    for (k in fields) {
        if (fields.hasOwnProperty(k)) { rec[k] = fields[k]; }
    }
    return metaWrite(item, rec);
}

function metaClear(item) {
    var t = metaTagOf(item);
    if (!t) { return false; }
    try { t.remove(); return true; } catch (e) { return false; }
}

//= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =
// 3. Identity
//= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =

META.seq = 0;

/*
 * IDs need to be unique across documents, because artwork gets copied between
 * them and two objects colliding on an ID would silently cross-wire a
 * constraint. Time plus a counter plus randomness is enough; this is not a
 * security boundary.
 */
function metaNewId(prefix) {
    META.seq++;
    var t = (new Date()).getTime().toString(36);
    var r = Math.floor(Math.random() * 1679616).toString(36);
    return (prefix || "o") + t.slice(-6) + r + META.seq.toString(36);
}

/* The item's ID, minted and stored on first ask. */
function metaIdOf(item, prefix) {
    var rec = metaRead(item);
    if (rec && rec.id) { return rec.id; }
    var id = metaNewId(prefix || "o");
    metaPatch(item, { kind: (rec && rec.kind) ? rec.kind : "ref", id: id });
    return id;
}

//= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =
// 4. Registry
//= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =

/*
 * doc.pageItems is already flat across groups and compound paths, so one pass
 * finds every Chisel object in the document. On a heavy file this is the most
 * expensive thing Chisel does, which is why the auto-sync loop checks a cheap
 * hash first and only lands here when something actually moved.
 */
function metaScan(doc) {
    var reg = { byId: {}, list: [], links: [], count: 0 };
    var i, it, rec, entry;
    if (!doc) { doc = app.activeDocument; }
    for (i = 0; i < doc.pageItems.length; i++) {
        it = doc.pageItems[i];
        rec = metaRead(it);
        if (!rec || !rec.id) { continue; }
        entry = { item: it, rec: rec, id: rec.id, kind: rec.kind };
        reg.byId[rec.id] = entry;
        reg.list.push(entry);
        if (rec.kind === "tanlink" || rec.kind === "tancircle" || rec.kind === "tanline") {
            reg.links.push(entry);
        }
        reg.count++;
    }
    return reg;
}

function metaGet(reg, id) {
    if (!id) { return null; }
    return reg.byId[id] || null;
}

/*
 * A constraint whose driver was deleted has to be detectable, or a solve pass
 * throws deep inside the geometry and takes the whole sync with it.
 */
function metaAlive(entry) {
    if (!entry || !entry.item) { return false; }
    try {
        var junk = entry.item.geometricBounds;
        return junk ? true : true;
    } catch (e) { return false; }
}
