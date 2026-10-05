import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_KEYS, KEY_ACTIONS, keyLabel, normalizeKeys, actionForCode, rebind } from '../js/keys.js';

test('default keys are unique and reachable with the left hand', () => {
  const codes = Object.values(DEFAULT_KEYS);
  assert.equal(new Set(codes).size, codes.length);
  const leftHand = new Set(['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'Space']);
  for (const c of codes) assert.ok(leftHand.has(c), c);
  assert.equal(KEY_ACTIONS.length, codes.length);
});

test('labels', () => {
  assert.equal(keyLabel('KeyA'), 'A');
  assert.equal(keyLabel('Digit3'), '3');
  assert.equal(keyLabel('Space'), 'Space');
  assert.equal(keyLabel('Numpad4'), 'Num 4');
});

test('normalizeKeys fills gaps and ignores junk', () => {
  assert.deepEqual(normalizeKeys(null), DEFAULT_KEYS);
  const k = normalizeKeys({ hit: 'KeyJ', bogus: 'KeyX', stand: 5 });
  assert.equal(k.hit, 'KeyJ');
  assert.equal(k.stand, DEFAULT_KEYS.stand);
  assert.equal(k.bogus, undefined);
});

test('rebind swaps on conflict', () => {
  const k = rebind(DEFAULT_KEYS, 'hit', 'KeyS');
  assert.equal(k.hit, 'KeyS');
  assert.equal(k.stand, 'KeyA');
  assert.equal(actionForCode(k, 'KeyS'), 'hit');
  const k2 = rebind(DEFAULT_KEYS, 'split', 'KeyJ');
  assert.equal(k2.split, 'KeyJ');
  assert.equal(actionForCode(k2, 'KeyF'), null);
});
