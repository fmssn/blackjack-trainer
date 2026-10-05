import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chartCell, analyze, DEFAULT_RULES, insuranceEV, evalCards } from '../js/strategy.js';

const A = 11;
const code = (cards, up, rules = DEFAULT_RULES) => chartCell(cards, up, rules).code;
const anyDouble = { ...DEFAULT_RULES, double: 'any' };
const usPeek = { ...DEFAULT_RULES, double: 'any', holeCard: true };

test('hand evaluation', () => {
  assert.deepEqual(evalCards([A, 6]), { hard: 7, hasAce: true, total: 17, soft: true });
  assert.deepEqual(evalCards([A, 6, 10]), { hard: 17, hasAce: true, total: 17, soft: false });
  assert.equal(evalCards([A, A, 9]).total, 21);
});

test('German ENHC: no doubling 11 or 10 against a 10 or ace', () => {
  assert.equal(code([6, 5], 10), 'H');
  assert.equal(code([6, 5], A), 'H');
  assert.equal(code([6, 4], 10), 'H');
  assert.equal(code([6, 5], 9), 'D');
  assert.equal(code([5, 4], 3), 'D');
  assert.equal(code([5, 4], 2), 'H');
});

test('German ENHC: do not split 8s or aces against a 10/ace', () => {
  assert.equal(code([8, 8], 10), 'H');
  assert.equal(code([8, 8], A), 'H');
  assert.equal(code([A, A], A), 'H');
  assert.equal(code([A, A], 10), 'P');
  assert.equal(code([8, 8], 9), 'P');
});

test('standard hard/pair decisions', () => {
  assert.equal(code([10, 2], 2), 'H');
  assert.equal(code([10, 2], 4), 'S');
  assert.equal(code([10, 6], 6), 'S');
  assert.equal(code([10, 6], 7), 'H');
  assert.equal(code([10, 6], 10), 'H');
  assert.equal(code([9, 9], 7), 'S');
  assert.equal(code([9, 9], 8), 'P');
  assert.equal(code([10, 10], 6), 'S');
  assert.equal(code([5, 5], 9), 'D');
  assert.equal(code([4, 4], 5), 'P');
  assert.equal(code([2, 2], 7), 'P');
});

test('soft hands depend on doubling rule', () => {
  assert.equal(code([A, 7], 3, anyDouble), 'Ds');
  assert.equal(code([A, 6], 3, anyDouble), 'D');
  assert.equal(code([A, 7], 3), 'S'); // 9-11 only: cannot double soft 18
  assert.equal(code([A, 6], 3), 'H');
  assert.equal(code([A, 7], 9), 'H');
  assert.equal(code([A, 7], 2), 'S');
});

test('US hole-card rules recover the familiar chart', () => {
  assert.equal(code([6, 5], 10, usPeek), 'D');
  assert.equal(code([8, 8], 10, usPeek), 'P');
  assert.equal(code([A, A], A, usPeek), 'P');
});

test('split aces vs 6 is worth a lot more than hitting', () => {
  const r = analyze([A, A], 6, DEFAULT_RULES, { canDouble: false, canSplit: true });
  assert.equal(r.best, 'split');
  assert.ok(r.evs.split > 0.5);
});

test('insurance is always negative', () => {
  assert.ok(insuranceEV() < 0);
});
