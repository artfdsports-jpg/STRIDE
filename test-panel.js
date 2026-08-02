// Panel wiring test.
//
// A CEP panel fails silently. A button pointing at a command that does not
// exist does nothing at all; getElementById on a renamed field returns null and
// the controller dies mid-refresh, freezing every live readout with no error
// anywhere the user will look. Both are the kind of mistake that survives
// review and shows up in Illustrator.
//
// So this checks the three seams statically: markup to controller, controller
// to markup, and markup to engine.
//
//   node test-panel.js

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, 'js', 'main.js'), 'utf8');
const jsxFiles = ['chisel.jsx', 'chisel-meta.jsx', 'chisel-tangency.jsx',
                  'chisel-constraints.jsx', 'chisel-inspector.jsx', 'chisel-extend.jsx'];
const jsx = jsxFiles.map(f => fs.readFileSync(path.join(__dirname, 'jsx', f), 'utf8')).join('\n');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); }
}

const all = (re, s) => {
  const out = [];
  let m;
  while ((m = re.exec(s)) !== null) { out.push(m[1]); }
  return out;
};
const uniq = (a) => Array.from(new Set(a));

const htmlIds = uniq(all(/\bid="([^"]+)"/g, html));
const dataCmds = uniq(all(/data-cmd="([^"]+)"/g, html));
const dataArgs = uniq(all(/data-args="([^"]+)"/g, html));
const dataTabs = uniq(all(/data-tab="([^"]+)"/g, html));

const engineCmds = uniq(all(/^CMD\.(\w+)\s*=/gm, jsx));
const argBuilders = uniq(all(/^\s{4}(\w+): function \(\)/gm, main));
const segInits = uniq(all(/initSeg\("([^"]+)"/g, main));

// Every id the controller reaches for, by any of its accessors.
const wantedIds = uniq([
  ...all(/\$\("([^"]+)"\)/g, main),
  ...all(/\bnum\("([^"]+)"/g, main),
  ...all(/\bchecked\("([^"]+)"\)/g, main),
  ...all(/\bbindOut\("([^"]+)",\s*"([^"]+)"\)/g, main)
]);
// bindOut takes two ids; the regex above only captured the first.
for (const m of main.matchAll(/bindOut\("([^"]+)",\s*"([^"]+)"\)/g)) { wantedIds.push(m[2]); }
// Field ids live in a table rather than as literals.
for (const m of main.matchAll(/\{\s*id:\s*"([^"]+)"/g)) { wantedIds.push(m[1]); }

console.log('\n[1] Every button points at a command the engine defines');
{
  const missing = dataCmds.filter(c => !engineCmds.includes(c));
  ok('no button calls a command that does not exist', missing.length === 0, missing);
  ok('the panel exposes a useful number of commands', dataCmds.length >= 30, dataCmds.length);
}

console.log('\n[2] Every argument builder referenced exists');
{
  // data-args is either the name of a builder or an inline object literal.
  const named = dataArgs.filter(a => !a.trim().startsWith('{'));
  const missing = named.filter(a => !argBuilders.includes(a));
  ok('no button names a missing argument builder', missing.length === 0, missing);

  const inline = dataArgs.filter(a => a.trim().startsWith('{'));
  const bad = inline.filter(a => {
    try { eval('(' + a + ')'); return false; } catch (e) { return true; }
  });
  ok('every inline argument literal parses', bad.length === 0, bad);
  ok('inline literals use single quotes, which survive the evalScript wrapper',
    inline.every(a => !a.includes('"')), inline.filter(a => a.includes('"')));
}

console.log('\n[3] Every element the controller reaches for exists in the markup');
{
  const missing = uniq(wantedIds).filter(id => !htmlIds.includes(id));
  ok('no getElementById returns null', missing.length === 0, missing);
}

console.log('\n[4] Every segmented control is initialised and reachable');
{
  const segsInHtml = uniq(all(/<div class="seg" id="([^"]+)"/g, html));
  const uninit = segsInHtml.filter(s => !segInits.includes(s));
  ok('every segmented control in the markup is initialised', uninit.length === 0, uninit);

  const phantom = segInits.filter(s => !segsInHtml.includes(s));
  ok('no controller state points at a control that was removed', phantom.length === 0, phantom);

  // A segmented control with no default selected leaves segState holding a
  // value that does not match what the user sees.
  const segBlocks = html.match(/<div class="seg"[\s\S]*?<\/div>/g) || [];
  const noDefault = segBlocks.filter(b => !b.includes('class="on"'));
  ok('every segmented control marks a default', noDefault.length === 0, noDefault.length);
}

console.log('\n[5] Tabs');
{
  const names = uniq(dataTabs);
  for (const n of names) {
    const hasBtn = new RegExp(`<button[^>]*data-tab="${n}"`).test(html);
    const hasPane = new RegExp(`<div class="tab[^"]*" data-tab="${n}"`).test(html);
    ok(`tab "${n}" has both a button and a pane`, hasBtn && hasPane, { hasBtn, hasPane });
  }
  ok('exactly one tab starts active',
    (html.match(/<button class="on" data-tab=/g) || []).length === 1);
  ok('exactly one pane starts visible',
    (html.match(/<div class="tab on"/g) || []).length === 1);
}

console.log('\n[6] Ids are unique');
{
  const raw = all(/\bid="([^"]+)"/g, html);
  const dupes = raw.filter((v, i) => raw.indexOf(v) !== i);
  ok('no duplicate ids in the markup', dupes.length === 0, uniq(dupes));
}

console.log('\n[7] The engine stays inside the ExtendScript dialect');
{
  // ExtendScript is roughly ES3. Any of these parses fine in node and then
  // fails in Illustrator, taking the whole module with it.
  const banned = [
    [/\blet\s+\w/, 'let'],
    [/\bconst\s+\w/, 'const'],
    [/=>/, 'arrow function'],
    [/\bJSON\.(parse|stringify)\b/, 'JSON'],
    [/`/, 'template literal'],
    [/\.\.\./, 'spread'],
    [/\bArray\.prototype\.(map|filter|forEach|reduce)\b/, 'array iteration methods'],
    [/\.(forEach|map|filter|reduce)\s*\(/, 'array iteration methods'],
    [/\bObject\.(keys|assign|values)\b/, 'Object statics'],
    [/,\s*[\]}]/, 'trailing comma']
  ];
  for (const f of jsxFiles) {
    const src = fs.readFileSync(path.join(__dirname, 'jsx', f), 'utf8')
      // Strip comments first: prose is allowed to mention any of this.
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const hits = banned.filter(([re]) => re.test(src)).map(([, n]) => n);
    ok(`${f} avoids post-ES3 syntax`, hits.length === 0, hits);
  }
}

console.log('\n[8] The module list matches the files on disk');
{
  const declared = all(/"(chisel-[\w-]+\.jsx)"/g, fs.readFileSync(path.join(__dirname, 'jsx', 'chisel.jsx'), 'utf8'));
  const onDisk = fs.readdirSync(path.join(__dirname, 'jsx')).filter(f => /^chisel-.*\.jsx$/.test(f));
  ok('every declared module exists', declared.every(d => onDisk.includes(d)),
    declared.filter(d => !onDisk.includes(d)));
  ok('every module on disk is declared', onDisk.every(d => declared.includes(d)),
    onDisk.filter(d => !declared.includes(d)));
}

console.log('\n=== ' + pass + ' passed, ' + fail + ' failed ===');
process.exit(fail ? 1 : 0);
