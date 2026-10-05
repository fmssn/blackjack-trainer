// Basic strategy engine.
//
// Computes exact expected values for every player decision under the
// infinite-deck approximation. With an automatic (continuous) shuffler the
// composition of the shoe barely changes between rounds, so infinite-deck
// EVs are an excellent stand-in and let the chart adapt to any rule set.
//
// Card values: 2..10, ace = 11.

export const CARD_VALUES = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const prob = (v) => (v === 10 ? 4 / 13 : 1 / 13);

export const DEFAULT_RULES = {
  h17: false,         // dealer hits soft 17
  holeCard: false,    // false = European no-hole-card (dealer draws 2nd card after players)
  obo: false,         // ENHC only: lose only the original bet to a dealer blackjack
  double: '9-11',     // 'any' | '9-11' | '10-11'
  das: true,          // double after split
  maxHands: 4,        // max hands after resplitting (aces cannot be resplit)
  bjPays: 1.5,
};

// Value of a hand given its hard sum (aces counted as 1) and whether it holds an ace.
export function handValue(hard, hasAce) {
  if (hasAce && hard + 10 <= 21) return { total: hard + 10, soft: true };
  return { total: hard, soft: false };
}

export function evalCards(cards) {
  let hard = 0;
  let hasAce = false;
  for (const c of cards) {
    if (c === 11) { hard += 1; hasAce = true; } else hard += c;
  }
  return { hard, hasAce, ...handValue(hard, hasAce) };
}

// Dealer final-total distribution for a given upcard. Includes the chance
// of a natural blackjack (only possible on the 2nd card).
function dealerDistribution(up, rules) {
  const memo = new Map();
  const rec = (hard, hasAce, n) => {
    const key = `${hard}|${hasAce}|${Math.min(n, 3)}`;
    if (memo.has(key)) return memo.get(key);
    const { total, soft } = handValue(hard, hasAce);
    let res;
    if (n === 2 && total === 21) res = { bj: 1 };
    else if (total > 21) res = { bust: 1 };
    else if (total > 17 || (total === 17 && !(soft && rules.h17))) res = { [total]: 1 };
    else {
      res = {};
      for (const c of CARD_VALUES) {
        const sub = rec(hard + (c === 11 ? 1 : c), hasAce || c === 11, n + 1);
        for (const k in sub) res[k] = (res[k] || 0) + prob(c) * sub[k];
      }
    }
    memo.set(key, res);
    return res;
  };
  const raw = rec(up === 11 ? 1 : up, up === 11, 1);
  const d = { 17: 0, 18: 0, 19: 0, 20: 0, 21: 0, bust: 0, bj: 0 };
  for (const k in raw) d[k] += raw[k];
  return d;
}

// Distribution used for decisions. If the dealer peeks (hole card) or only
// original bets are lost (OBO), decisions are made knowing the dealer has no
// blackjack, so we condition it away. Otherwise (German default: no hole card,
// all bets lost) a dealer blackjack beats every hand, doubles and splits included.
function decisionContext(up, rules) {
  const full = dealerDistribution(up, rules);
  const pBJ = full.bj;
  const conditioned = rules.holeCard || rules.obo;
  let dist = full;
  if (conditioned && pBJ > 0) {
    dist = {};
    for (const k in full) dist[k] = k === 'bj' ? 0 : full[k] / (1 - pBJ);
  }
  return { dist, pBJ, conditioned };
}

function standEV(total, dist) {
  if (total > 21) return -1;
  let ev = -dist.bj + dist.bust;
  for (let t = 17; t <= 21; t++) {
    if (total > t) ev += dist[t];
    else if (total < t) ev -= dist[t];
  }
  return ev;
}

export function doubleAllowedByRule(cards, rules) {
  if (cards.length !== 2) return false;
  if (rules.double === 'any') return true;
  const { total, soft } = evalCards(cards);
  if (soft) return false;
  if (rules.double === '9-11') return total >= 9 && total <= 11;
  if (rules.double === '10-11') return total >= 10 && total <= 11;
  return false;
}

class Engine {
  constructor(up, rules) {
    this.up = up;
    this.rules = rules;
    const ctx = decisionContext(up, rules);
    this.dist = ctx.dist;
    this.pBJ = ctx.pBJ;
    this.conditioned = ctx.conditioned;
    this.hsMemo = new Map();
  }

  // Best of hit/stand for a hand that can no longer double or split.
  hitStand(hard, hasAce) {
    const key = hard * 2 + (hasAce ? 1 : 0);
    if (this.hsMemo.has(key)) return this.hsMemo.get(key);
    const { total } = handValue(hard, hasAce);
    const stand = standEV(total, this.dist);
    const hit = this.hitEV(hard, hasAce);
    const res = { stand, hit, best: Math.max(stand, hit) };
    this.hsMemo.set(key, res);
    return res;
  }

  hitEV(hard, hasAce) {
    let ev = 0;
    for (const c of CARD_VALUES) {
      const h = hard + (c === 11 ? 1 : c);
      const a = hasAce || c === 11;
      const { total } = handValue(h, a);
      ev += prob(c) * (total > 21 ? -1 : this.hitStand(h, a).best);
    }
    return ev;
  }

  doubleEV(hard, hasAce) {
    let ev = 0;
    for (const c of CARD_VALUES) {
      const { total } = handValue(hard + (c === 11 ? 1 : c), hasAce || c === 11);
      ev += prob(c) * standEV(total, this.dist);
    }
    return 2 * ev;
  }

  // EV of splitting a pair of `v`, per original unit bet (both hands counted).
  // Resplits are approximated as not taken, which changes EV by a hair and
  // never flips a basic strategy decision.
  splitEV(v) {
    let one = 0;
    for (const c of CARD_VALUES) {
      const cards = [v, c];
      const { hard, hasAce, total } = evalCards(cards);
      if (v === 11) {
        // Split aces receive exactly one card; A+10 counts as 21, not blackjack.
        one += prob(c) * standEV(total, this.dist);
        continue;
      }
      const hs = this.hitStand(hard, hasAce);
      let best = hs.best;
      if (this.rules.das && doubleAllowedByRule(cards, this.rules)) {
        best = Math.max(best, this.doubleEV(hard, hasAce));
      }
      one += prob(c) * best;
    }
    return 2 * one;
  }

  // Convert a decision EV to the unconditional EV of the whole round,
  // for display purposes.
  display(ev) {
    if (!this.conditioned) return ev;
    return (1 - this.pBJ) * ev - this.pBJ;
  }
}

const engineCache = new Map();
function getEngine(up, rules) {
  const key = `${up}|${JSON.stringify(rules)}`;
  if (!engineCache.has(key)) engineCache.set(key, new Engine(up, rules));
  return engineCache.get(key);
}

// opts: { canDouble, canSplit }
// Returns { evs: {hit, stand, double?, split?}, best, ranked: [[action, ev]...] }
export function analyze(cards, up, rules, opts) {
  const eng = getEngine(up, rules);
  const { hard, hasAce } = evalCards(cards);
  const hs = eng.hitStand(hard, hasAce);
  const raw = { hit: hs.hit, stand: hs.stand };
  if (opts.canDouble) raw.double = eng.doubleEV(hard, hasAce);
  if (opts.canSplit) raw.split = eng.splitEV(cards[0]);
  const evs = {};
  for (const k in raw) evs[k] = eng.display(raw[k]);
  const ranked = Object.entries(evs).sort((a, b) => b[1] - a[1]);
  return { evs, best: ranked[0][0], ranked };
}

// Insurance pays 2:1 on the dealer's blackjack chance. A 10 shows up 4/13 of the
// time, so insurance (and even money) is always -EV without counting.
export function insuranceEV() {
  return (4 / 13) * 2 - (9 / 13);
}

// Strategy chart for the opening two cards.
// Codes: H hit, S stand, D double (else hit), Ds double (else stand), P split.
export const UPCARDS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

export function chartCell(cards, up, rules) {
  const isPair = cards[0] === cards[1];
  const res = analyze(cards, up, rules, {
    canDouble: doubleAllowedByRule(cards, rules),
    canSplit: isPair,
  });
  if (res.best === 'split') return { code: 'P', res };
  if (res.best === 'double') return { code: res.evs.stand > res.evs.hit ? 'Ds' : 'D', res };
  return { code: res.best === 'hit' ? 'H' : 'S', res };
}

// Representative two-card hands for every chart row.
export function chartRows() {
  const hard = [];
  for (let t = 5; t <= 19; t++) {
    // pick two different cards summing to t (non-pair, no ace)
    let a = Math.min(10, t - 2);
    let b = t - a;
    if (a === b) { a += 1; b -= 1; }
    if (a > 10) { a = 10; b = t - 10; }
    hard.push({ key: `H${t}`, label: `${t}`, cards: [a, b] });
  }
  const soft = [];
  for (let o = 2; o <= 9; o++) soft.push({ key: `S${o}`, label: `A,${o}`, cards: [11, o] });
  const pairs = [];
  for (const v of [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]) {
    const n = v === 11 ? 'A' : v;
    pairs.push({ key: `P${v}`, label: `${n},${n}`, cards: [v, v] });
  }
  return { hard, soft, pairs };
}

// Key that groups two-card situations the same way the chart does.
export function situationKey(cards, isPairSplittable) {
  if (cards.length === 2 && cards[0] === cards[1] && isPairSplittable) return `P${cards[0]}`;
  const { total, soft } = evalCards(cards);
  if (soft) return `S${total - 11}`;
  return `H${total}`;
}
