'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { serverBase, appUrl, startUrl, posUrl, backOfficeUrl } = require('./start-url');

test('the app starts on the start screen of the chosen server', () => {
  assert.strictEqual(startUrl('http://192.168.1.10:3000'), 'http://192.168.1.10:3000/start');
  assert.strictEqual(startUrl('http://192.168.1.10:3000///'), 'http://192.168.1.10:3000/start');
  assert.strictEqual(startUrl(''), 'http://localhost:3000/start');
  assert.strictEqual(startUrl(undefined), 'http://localhost:3000/start');
});

test('Ctrl+Shift+1 opens the POS directly, Ctrl+Shift+2 the back office through the start screen', () => {
  assert.strictEqual(posUrl('http://pos.local:3000/'), 'http://pos.local:3000/pos');
  assert.strictEqual(backOfficeUrl('http://pos.local:3000'), 'http://pos.local:3000/start?go=backoffice');
});

test('routes', () => {
  assert.strictEqual(appUrl('http://a:3000', 'products'), 'http://a:3000/products');
  assert.strictEqual(appUrl('http://a:3000/', '/settings'), 'http://a:3000/settings');
  assert.strictEqual(serverBase('  http://a:3000/ '), 'http://a:3000');
});
