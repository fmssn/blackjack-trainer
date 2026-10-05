// Game state machine: dealing, player actions, dealer play and settlement.
import { evalCards, analyze, doubleAllowedByRule } from './strategy.js';

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

export function rankValue(rank) {
  if (rank === 'A') return 11;
  if (rank === 'J' || rank === 'Q' || rank === 'K') return 10;
  return Number(rank);
}

export function makeCard(rank, suit) {
  return { rank, suit, value: rankValue(rank), red: suit === '♥' || suit === '♦' };
}

const randInt = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[randInt(arr.length)];

export function cardOfValue(value) {
  const rank = value === 11 ? 'A' : value === 10 ? pick(['10', 'J', 'Q', 'K']) : String(value);
  return makeCard(rank, pick(SUITS));
}

// Automatic shuffler: every round starts from a complete shoe, as the cards
// of the previous round go straight back into the machine.
export class Shoe {
  constructor(decks = 6) {
    this.decks = decks;
    this.refill();
  }
  refill() {
    this.cards = [];
    for (let d = 0; d < this.decks; d++) {
      for (const s of SUITS) for (const r of RANKS) this.cards.push(makeCard(r, s));
    }
  }
  draw() {
    const i = randInt(this.cards.length);
    const [c] = this.cards.splice(i, 1);
    return c;
  }
  // Remove a specific value (used when a drill presets the cards).
  take(value) {
    const idx = [];
    this.cards.forEach((c, i) => { if (c.value === value) idx.push(i); });
    const [c] = this.cards.splice(pick(idx), 1);
    return c;
  }
}

const values = (cards) => cards.map((c) => c.value);
export const handInfo = (cards) => evalCards(values(cards));

export function isNatural(cards) {
  return cards.length === 2 && handInfo(cards).total === 21;
}

function newHand(cards, bet, fromSplit = false) {
  return { cards, bet, fromSplit, doubled: false, splitAces: false, done: false, outcome: null, net: 0 };
}

// preset: { player: [value, value], up: value } for drills.
export function startRound(shoe, rules, bet, preset = null) {
  shoe.refill();
  const draw = (v) => (v != null ? shoe.take(v) : shoe.draw());
  const p1 = draw(preset?.player[0]);
  const up = draw(preset?.up);
  const p2 = draw(preset?.player[1]);
  const round = {
    dealer: [up],
    holeHidden: false,
    hands: [newHand([p1, p2], bet)],
    active: 0,
    baseBet: bet,
    insurance: null,
    phase: 'player',
    settled: false,
  };
  if (rules.holeCard) {
    round.dealer.push(shoe.draw());
    round.holeHidden = true;
  }
  if (up.value === 11) round.phase = 'insurance';
  else afterInsurance(round, rules);
  return round;
}

function afterInsurance(round, rules) {
  // With a hole card the dealer peeks for blackjack before anyone acts.
  if (rules.holeCard && (round.dealer[0].value >= 10) && isNatural(round.dealer)) {
    round.phase = 'dealer';
    return;
  }
  if (isNatural(round.hands[0].cards)) {
    round.hands[0].done = true;
    round.phase = 'dealer';
    return;
  }
  round.phase = 'player';
}

export function resolveInsurance(round, rules, take) {
  round.insurance = take;
  afterInsurance(round, rules);
}

export function activeHand(round) {
  return round.hands[round.active];
}

export function availableActions(round, rules) {
  const h = activeHand(round);
  if (!h || round.phase !== 'player') return {};
  const two = h.cards.length === 2;
  const canDouble = two && !h.splitAces && (!h.fromSplit || rules.das) &&
    doubleAllowedByRule(values(h.cards), rules);
  const canSplit = two && h.cards[0].value === h.cards[1].value &&
    round.hands.length < rules.maxHands && !h.splitAces;
  return { hit: true, stand: true, double: canDouble, split: canSplit };
}

export function analyzeActive(round, rules) {
  const h = activeHand(round);
  const acts = availableActions(round, rules);
  return analyze(values(h.cards), round.dealer[0].value, rules, {
    canDouble: acts.double,
    canSplit: acts.split,
  });
}

function advance(round) {
  while (round.active < round.hands.length && round.hands[round.active].done) round.active++;
  if (round.active >= round.hands.length) round.phase = 'dealer';
}

function checkAutoDone(h) {
  const { total } = handInfo(h.cards);
  if (total >= 21 || h.splitAces) h.done = true;
}

export function applyAction(round, action, shoe, rules) {
  const h = activeHand(round);
  if (action === 'hit') {
    h.cards.push(shoe.draw());
    checkAutoDone(h);
  } else if (action === 'stand') {
    h.done = true;
  } else if (action === 'double') {
    h.bet *= 2;
    h.doubled = true;
    h.cards.push(shoe.draw());
    h.done = true;
  } else if (action === 'split') {
    const second = h.cards.pop();
    const nh = newHand([second], h.bet, true);
    h.fromSplit = true;
    const aces = second.value === 11;
    h.splitAces = aces;
    nh.splitAces = aces;
    round.hands.splice(round.active + 1, 0, nh);
    h.cards.push(shoe.draw());
    nh.cards.push(shoe.draw());
    checkAutoDone(h);
    checkAutoDone(nh);
  }
  advance(round);
}

// Does the dealer need to draw out their hand at all?
function anyLiveHand(round) {
  return round.hands.some((h) => handInfo(h.cards).total <= 21 && !(isNatural(h.cards) && !h.fromSplit));
}

// One dealer step. Returns true while the dealer is still acting.
export function dealerStep(round, shoe, rules) {
  if (round.holeHidden) {
    round.holeHidden = false;
    return true;
  }
  if (round.dealer.length < 2) {
    round.dealer.push(shoe.draw());
    return true;
  }
  if (isNatural(round.dealer) || !anyLiveHand(round)) return false;
  const { total, soft } = handInfo(round.dealer);
  if (total < 17 || (total === 17 && soft && rules.h17)) {
    round.dealer.push(shoe.draw());
    return true;
  }
  return false;
}

export function settle(round, rules) {
  const dealerBJ = isNatural(round.dealer);
  const { total: d } = handInfo(round.dealer);
  let net = 0;
  const playerBJ = round.hands.length === 1 && isNatural(round.hands[0].cards);

  if (round.insurance) {
    const ins = round.baseBet / 2;
    net += dealerBJ ? ins * 2 : -ins;
  }

  for (const h of round.hands) {
    const { total } = handInfo(h.cards);
    let outcome;
    let n;
    if (playerBJ) {
      outcome = dealerBJ ? 'push' : 'blackjack';
      n = dealerBJ ? 0 : h.bet * rules.bjPays;
    } else if (total > 21) {
      outcome = 'bust'; n = -h.bet;
    } else if (dealerBJ) {
      outcome = 'dealer blackjack'; n = -h.bet;
    } else if (d > 21) {
      outcome = 'win'; n = h.bet;
    } else if (total > d) {
      outcome = 'win'; n = h.bet;
    } else if (total < d) {
      outcome = 'lose'; n = -h.bet;
    } else {
      outcome = 'push'; n = 0;
    }
    h.outcome = outcome;
    h.net = n;
    net += n;
  }

  // Original-bets-only: a dealer blackjack (no hole card) takes just the first stake.
  if (dealerBJ && !playerBJ && rules.obo && !rules.holeCard) {
    const handLoss = round.hands.reduce((s, h) => s + h.net, 0);
    net += -round.baseBet - handLoss;
  }

  round.net = net;
  round.settled = true;
  round.phase = 'done';
  return net;
}

export function describeHand(cards) {
  const { total, soft } = handInfo(cards);
  if (isNatural(cards)) return 'Blackjack';
  if (total > 21) return `Bust (${total})`;
  return soft ? `Soft ${total}` : `${total}`;
}
