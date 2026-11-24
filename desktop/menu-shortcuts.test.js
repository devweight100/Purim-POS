'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { DESKTOP_SHORTCUTS, PAGE_SHORTCUTS, normalizeAccelerator, shortcutProblems, shortcutLabel } = require('./menu-shortcuts');

test('the desktop map has no F-key except F11 and no page shortcut', () => {
  assert.deepStrictEqual(shortcutProblems(), []);
  const fKeys = Object.values(DESKTOP_SHORTCUTS).filter((a) => /(^|\+)F\d+$/.test(a));
  assert.deepStrictEqual(fKeys, ['F11']);
});

test('every desktop-only shortcut except reload / fullscreen is Ctrl+Shift+...', () => {
  for (const [name, acc] of Object.entries(DESKTOP_SHORTCUTS)) {
    if (name === 'reload' || name === 'fullscreen') continue;
    assert.match(normalizeAccelerator(acc), /^ctrl\+shift\+[^+]+$/, name);
  }
});

test('F2 (POS quantity / price keys) and F5 (POS refresh) belong to the page', () => {
  const desktop = new Set(Object.values(DESKTOP_SHORTCUTS).map(normalizeAccelerator));
  for (const k of ['F1', 'F2', 'F3', 'F4', 'F5', 'F8', 'F9', 'F10', 'F12']) {
    assert.ok(!desktop.has(normalizeAccelerator(k)), k);
    assert.ok(PAGE_SHORTCUTS.includes(k), k);
  }
  // the old products accelerator was the POS hold-bill key
  assert.ok(!desktop.has(normalizeAccelerator('CmdOrCtrl+Shift+P')));
});

test('the checker catches conflicts written in any form', () => {
  assert.strictEqual(normalizeAccelerator('CmdOrCtrl+Shift+P'), normalizeAccelerator('shift+Control+p'));
  const bad = shortcutProblems({ a: 'F2', b: 'CmdOrCtrl+Shift+P', c: 'Ctrl+M', d: 'Alt+3', e: 'CommandOrControl+Shift+9', f: 'Control+Shift+9' });
  assert.strictEqual(bad.length, 6, bad.join('\n'));
  assert.deepStrictEqual(shortcutProblems({ ok: 'CommandOrControl+Shift+K', fs: 'F11' }), []);
});

test('main.js uses the map only: no literal accelerators, no global shortcuts', () => {
  const src = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  assert.doesNotMatch(src, /globalShortcut\.register\(/);
  const literal = [...src.matchAll(/accelerator:\s*['"`]/g)];
  assert.strictEqual(literal.length, 0, 'accelerators must come from DESKTOP_SHORTCUTS');
  const used = [...src.matchAll(/accelerator:\s*DESKTOP_SHORTCUTS\.(\w+)/g)].map((m) => m[1]);
  assert.deepStrictEqual(new Set(used), new Set(Object.keys(DESKTOP_SHORTCUTS)));
});

test('labels for the menu / guide', () => {
  assert.strictEqual(shortcutLabel(DESKTOP_SHORTCUTS.pos), 'Ctrl+Shift+1');
  assert.strictEqual(shortcutLabel(DESKTOP_SHORTCUTS.fullscreen), 'F11');
});
