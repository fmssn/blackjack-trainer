import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Shoe, startRound, applyAction, dealerStep, settle, availableActions, resolveInsurance, makeCard } from '../js/game.js';
import { DEFAULT_RULES } from '../js/strategy.js';

const c = (r) => makeCard(r, '♠');

function finish(round, shoe, rules) {
  while (dealerStep(round, shoe, rules));
  return settle(round, rules);
}

test('random rounds always settle consistently', () => {
  const shoe = new Shoe(6);
  for (const rules of [DEFAULT_RULES, { ...DEFAULT_RULES, holeCard: true, double: 'any' }, { ...DEFAULT_RULES, obo: true }]) {
    for (let i = 0; i < 3000; i++) {
      const r = startRound(shoe, rules, 10);
      if (r.phase === 'insurance') resolveInsurance(r, rules, false);
      let guard = 0;
      while (r.phase === 'player' && guard++ < 50) {
        const acts = availableActions(r, rules);
        const opts = Object.keys(acts).filter((k) => acts[k]);
        applyAction(r, opts[Math.floor(Math.random() * opts.length)], shoe, rules);
      }
      assert.equal(r.phase, 'dealer');
      const net = finish(r, shoe, rules);
      assert.ok(Number.isFinite(net));
      assert.ok(r.hands.length <= rules.maxHands);
    }
  }
});

test('no hole card: dealer blackjack takes doubled bet', () => {
  const rules = DEFAULT_RULES;
  const round = {
    dealer: [c('10'), c('A')], holeHidden: false, baseBet: 10, insurance: null, phase: 'dealer', active: 1,
    hands: [{ cards: [c('5'), c('6'), c('9')], bet: 20, doubled: true, fromSplit: false }],
  };
  assert.equal(settle(round, rules), -20);
  round.hands[0].outcome = null;
  assert.equal(settle(round, { ...rules, obo: true }), -10);
});

test('blackjack pays 3:2, split 21 is not blackjack', () => {
  const rules = DEFAULT_RULES;
  const bj = { dealer: [c('9'), c('8')], baseBet: 10, hands: [{ cards: [c('A'), c('K')], bet: 10 }] };
  assert.equal(settle(bj, rules), 15);
  const split = { dealer: [c('9'), c('A'), c('A')], baseBet: 10, hands: [
    { cards: [c('A'), c('K')], bet: 10, fromSplit: true }, { cards: [c('A'), c('5')], bet: 10, fromSplit: true }] };
  // dealer 21 (9+A+A): first hand pushes, second loses
  assert.equal(settle(split, rules), -10);
});

test('even money / insurance pays when dealer has blackjack', () => {
  const r = { dealer: [c('A'), c('Q')], baseBet: 10, insurance: true, hands: [{ cards: [c('A'), c('K')], bet: 10 }] };
  assert.equal(settle(r, DEFAULT_RULES), 10);
});
