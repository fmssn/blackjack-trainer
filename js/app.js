import {
  DEFAULT_RULES, UPCARDS, chartRows, chartCell, situationKey, evalCards, insuranceEV,
} from './strategy.js';
import {
  Shoe, startRound, resolveInsurance, availableActions, analyzeActive, applyAction,
  dealerStep, settle, activeHand, handInfo, describeHand, isNatural,
} from './game.js';
import {
  KEY_ACTIONS, keyLabel, normalizeKeys, actionForCode, rebind, RESERVED, DEFAULT_KEYS,
} from './keys.js';

/* ---------------- Persistence ---------------- */
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
  },
};

const PRESETS = {
  de: { ...DEFAULT_RULES },
  'de-any': { ...DEFAULT_RULES, double: 'any' },
  us: { ...DEFAULT_RULES, holeCard: true, double: 'any' },
};
const DEFAULT_OPTS = { feedback: 'always', onMistake: 'continue', speed: '300', autoDeal: 'false' };

const settings = store.get('bjt.settings', null) || { rules: { ...DEFAULT_RULES }, opts: { ...DEFAULT_OPTS } };
settings.rules = { ...DEFAULT_RULES, ...settings.rules };
settings.opts = { ...DEFAULT_OPTS, ...settings.opts };
settings.keys = normalizeKeys(settings.keys);

const freshStats = () => ({
  decisions: 0, correct: 0, streak: 0, bestStreak: 0, evLost: 0,
  hands: 0, net: 0, bankroll: 1000, cells: {}, cats: {},
});
let stats = { ...freshStats(), ...store.get('bjt.stats', {}) };
const saveStats = () => store.set('bjt.stats', stats);
const saveSettings = () => store.set('bjt.settings', settings);

/* ---------------- State ---------------- */
const BET = 10;
const shoe = new Shoe(6);
let mode = 'play';
let drillFocus = 'all';
let round = null;
let busy = false;
let drillAnswered = false;
let lastSpot = null; // { key, up }
let history = [];
let autoTimer = null;
let pendingRetry = false;
let rulesDirty = false;

/* ---------------- DOM ---------------- */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const el = {
  dealerCards: $('#dealerCards'), dealerTotal: $('#dealerTotal'), hands: $('#playerHands'),
  actions: $('#actions'), insActions: $('#insActions'), nextActions: $('#nextActions'),
  insQuestion: $('#insQuestion'), nextBtn: $('#nextBtn'), banner: $('#banner'),
  fbEmpty: $('#fbEmpty'), fbBody: $('#fbBody'), drillPicker: $('#drillPicker'),
  rulesLine: $('#rulesLine'), feltRules: $('#feltRules'), chartRules: $('#chartRules'),
  charts: $('#charts'), cellDetail: $('#cellDetail'), overlayToggle: $('#overlayToggle'),
  statsGrid: $('#statsGrid'), missList: $('#missList'), bankBox: $('#bankBox'),
  dialog: $('#settings'), preset: $('#preset'),
};

const ACTION_LABEL = { hit: 'Hit', stand: 'Stand', double: 'Double', split: 'Split' };
const upLabel = (v) => (v === 11 ? 'A' : String(v));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmtEV = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(1)}%`;

/* ---------------- Rules text ---------------- */
function rulesSummary(r) {
  const dbl = { any: 'double any 2', '9-11': 'double 9–11', '10-11': 'double 10–11' }[r.double];
  return [
    '6 decks · auto shuffler',
    r.holeCard ? 'hole card' : 'no hole card',
    r.h17 ? 'H17' : 'S17',
    dbl,
    r.das ? 'DAS' : 'no DAS',
    !r.holeCard && !r.obo ? 'dealer BJ takes all' : null,
    'BJ 3:2',
  ].filter(Boolean).join(' · ');
}

function updateRulesText() {
  const s = rulesSummary(settings.rules);
  el.rulesLine.textContent = s;
  el.chartRules.textContent = s;
  el.feltRules.textContent = `Dealer ${settings.rules.h17 ? 'hits soft 17' : 'stands on all 17s'} · Insurance pays 2 to 1`;
}

/* ---------------- Rendering: cards & table ---------------- */
function cardHTML(c, hidden = false) {
  if (hidden) return '<div class="card back" aria-label="face-down card"></div>';
  const face = ['J', 'Q', 'K'].includes(c.rank);
  const center = face ? `<div class="pip face">${c.rank}</div>` : `<div class="pip">${c.rank === 'A' ? c.suit : c.suit}</div>`;
  return `<div class="card${c.red ? ' red' : ''}" aria-label="${c.rank} of ${c.suit}">
    <div class="corner"><span>${c.rank}</span><span class="s">${c.suit}</span></div>
    ${center}
    <div class="corner br"><span>${c.rank}</span><span class="s">${c.suit}</span></div>
  </div>`;
}

// Re-render cards while only animating the newly added ones.
function renderCards(container, cards, hiddenIdx = -1) {
  const prev = Number(container.dataset.count || 0);
  const prevHidden = container.dataset.hidden === '1';
  const html = cards.map((c, i) => cardHTML(c, i === hiddenIdx)).join('');
  container.innerHTML = html;
  [...container.children].forEach((node, i) => {
    const isNew = i >= prev || (prevHidden && i === 1 && hiddenIdx !== 1);
    if (!isNew) node.style.animation = 'none';
  });
  container.dataset.count = cards.length;
  container.dataset.hidden = hiddenIdx === 1 ? '1' : '0';
}

function renderTable() {
  if (!round) return;
  const hiddenIdx = round.holeHidden ? 1 : -1;
  renderCards(el.dealerCards, round.dealer, hiddenIdx);
  const visible = round.holeHidden ? [round.dealer[0]] : round.dealer;
  el.dealerTotal.textContent = describeHand(visible);

  const multi = round.hands.length > 1;
  el.hands.classList.toggle('multi', multi);
  // Rebuild hand containers if the count changed.
  if (el.hands.children.length !== round.hands.length) {
    el.hands.innerHTML = round.hands.map(() => `
      <div class="hand">
        <div class="cards"></div>
        <div class="hand-meta"><span class="chip"></span><span class="total"></span><span class="outcome"></span></div>
      </div>`).join('');
  }
  round.hands.forEach((h, i) => {
    const node = el.hands.children[i];
    const isActive = round.phase === 'player' && i === round.active;
    node.classList.toggle('active', isActive);
    node.classList.toggle('waiting', round.phase === 'player' && i !== round.active);
    renderCards(node.querySelector('.cards'), h.cards);
    node.querySelector('.chip').textContent = h.bet;
    const label = h.fromSplit && isNatural(h.cards) ? '21' : describeHand(h.cards);
    node.querySelector('.total').textContent = label;
    const oc = node.querySelector('.outcome');
    if (h.outcome) {
      oc.className = `outcome ${h.outcome.replace(' ', '-')}`;
      const n = h.net;
      oc.textContent = `${h.outcome}${n ? ` ${n > 0 ? '+' : ''}${n}` : ''}`;
    } else {
      oc.className = 'outcome';
      oc.textContent = '';
    }
  });
}

function renderControls() {
  const phase = round?.phase;
  const showNext = phase === 'done' || (mode === 'drill' && drillAnswered);
  el.insActions.hidden = !(phase === 'insurance' && !showNext);
  el.actions.hidden = phase === 'insurance' || showNext;
  el.nextActions.hidden = !showNext;
  el.nextBtn.querySelector('span').textContent = mode === 'drill' ? 'Next spot' : 'Next hand';
  if (phase === 'insurance') {
    el.insQuestion.textContent = isNatural(round.hands[0].cards)
      ? 'You have blackjack. Take even money?'
      : 'Dealer shows an Ace. Insurance?';
  }
  const acts = phase === 'player' && !busy ? availableActions(round, settings.rules) : {};
  $$('#actions .act').forEach((b) => { b.disabled = !acts[b.dataset.action]; });
}

function showBanner(text, cls) {
  el.banner.textContent = text;
  el.banner.className = `banner ${cls || ''}`;
  el.banner.hidden = false;
  $('#felt').classList.add('has-banner');
}
const hideBanner = () => {
  el.banner.hidden = true;
  $('#felt').classList.remove('has-banner');
};

function renderScore() {
  const acc = stats.decisions ? `${((stats.correct / stats.decisions) * 100).toFixed(1)}%` : '–';
  $('#sAcc').textContent = acc;
  $('#sDec').textContent = stats.decisions;
  $('#sStreak').textContent = stats.streak;
  $('#sEvLost').textContent = stats.evLost.toFixed(2);
  const bank = $('#sBank');
  bank.textContent = Math.round(stats.bankroll);
  bank.className = `score-val ${stats.bankroll > 1000 ? 'up' : stats.bankroll < 1000 ? 'down' : ''}`;
  el.bankBox.hidden = mode === 'drill';
}

/* ---------------- Situation descriptions & tips ---------------- */
function spotLabel(key, up) {
  const t = key.slice(1);
  let hand;
  if (key[0] === 'P') hand = `Pair of ${t === '11' ? 'Aces' : t === '10' ? 'Tens' : `${t}s`}`;
  else if (key[0] === 'S') hand = `Soft ${Number(t) + 11} (A,${t})`;
  else if (key === 'INS') return up === 'even' ? 'Even money offer' : 'Insurance offer';
  else hand = `Hard ${t}`;
  return `${hand} vs ${upLabel(up)}`;
}

function tipFor(cards, up, best, chosen, analysis) {
  const r = settings.rules;
  const { total, soft } = evalCards(cards);
  const pair = cards.length === 2 && cards[0] === cards[1];
  const enhc = !r.holeCard && !r.obo;
  const strongUp = up >= 10;
  if (enhc && strongUp && pair && (cards[0] === 8 || cards[0] === 11) && best !== 'split') {
    return 'No hole card: if the dealer completes a blackjack, you lose both split hands. Against a 10 or Ace that risk makes splitting worse than just playing the hand.';
  }
  if (enhc && strongUp && !soft && (total === 10 || total === 11) && chosen === 'double') {
    return 'No hole card: a dealer blackjack also takes your double. Against a 10 or Ace, just hit.';
  }
  if (pair && cards[0] === 10) return 'Never split tens. A made 20 wins most of the time.';
  if (pair && cards[0] === 5) return 'Treat 5,5 as hard 10, never split it.';
  if (!soft && total >= 12 && total <= 16 && up >= 2 && up <= 6 && best === 'stand') {
    return 'The dealer shows a bust card (2–6) and busts often. Don\'t risk busting a stiff hand yourself.';
  }
  if (!soft && total === 12 && (up === 2 || up === 3) && best === 'hit') {
    return '12 vs 2 or 3 is the classic exception: only 4 cards (10s) bust you, so hit.';
  }
  if (!soft && total >= 12 && total <= 16 && up >= 7 && best === 'hit') {
    return 'The dealer will usually make 17 or more. Standing on a stiff hand loses too often, so take the risk and hit.';
  }
  if (soft && cards.length === 2 && r.double !== 'any' && chosen === 'double') {
    return `This table only allows doubling on hard ${r.double === '9-11' ? '9, 10 and 11' : '10 and 11'}.`;
  }
  if (soft && total === 18 && up >= 9 && best === 'hit') {
    return 'Soft 18 looks good but loses to a 9, 10 or Ace on average. Hitting can\'t bust you.';
  }
  if (soft && total <= 17 && best === 'hit') return 'A soft 17 or less never wins by standing. Hitting can\'t bust you.';
  if (best === 'split' && pair && cards[0] === 11) return 'Always split aces (unless no hole card vs Ace). Two hands starting at 11 beat one soft 12.';
  if (best === 'split' && pair && cards[0] === 8) return '16 is the worst hand in blackjack. Splitting 8s turns it into two hands starting at 8.';
  if (best === 'double') return 'You\'re likely to end with a strong hand while the dealer is weak, so put more money out.';
  const diff = analysis.ranked[0][1] - analysis.ranked[1][1];
  if (diff < 0.01) return `A close call: the best two options are only ${(diff * 100).toFixed(2)}% apart.`;
  return null;
}

/* ---------------- Recording decisions ---------------- */
function record({ correct, cost, key, up, cat }) {
  stats.decisions++;
  if (correct) {
    stats.correct++;
    stats.streak++;
    stats.bestStreak = Math.max(stats.bestStreak, stats.streak);
  } else {
    stats.streak = 0;
    stats.evLost += cost;
  }
  if (key) {
    const ck = `${key}|${up}`;
    const c = stats.cells[ck] || (stats.cells[ck] = { n: 0, wrong: 0 });
    c.n++;
    if (!correct) c.wrong++;
  }
  const cs = stats.cats[cat] || (stats.cats[cat] = { n: 0, wrong: 0 });
  cs.n++;
  if (!correct) cs.wrong++;
  saveStats();
  renderScore();
}

function pushHistory(entry) {
  history.unshift(entry);
  history = history.slice(0, 8);
}

/* ---------------- Feedback panel ---------------- */
function renderFeedback({ correct, title, sub, situation, evs, best, chosen, tip, force }) {
  if (!force && correct && settings.opts.feedback === 'mistakes') {
    renderHistoryOnly();
    return;
  }
  el.fbEmpty.hidden = true;
  el.fbBody.hidden = false;
  const entries = Object.entries(evs).sort((a, b) => b[1] - a[1]);
  const vals = entries.map((e) => e[1]);
  const lo = Math.min(...vals, 0);
  const hi = Math.max(...vals, 0);
  const span = hi - lo || 1;
  const zero = ((0 - lo) / span) * 100;
  const rows = entries.map(([a, v]) => {
    const pos = ((v - lo) / span) * 100;
    const left = Math.min(pos, zero);
    const width = Math.max(Math.abs(pos - zero), 1.5);
    const color = a === best ? 'var(--good)' : a === chosen ? 'var(--bad)' : 'rgba(255,255,255,0.35)';
    return `<div class="ev-row${a === best ? ' best' : ''}${a === chosen ? ' chosen' : ''}">
      <span class="name">${ACTION_LABEL[a] || a}</span>
      <span class="bar"><i style="left:${left}%;width:${width}%;background:${color}"></i></span>
      <span class="val">${fmtEV(v)}</span>
    </div>`;
  }).join('');
  el.fbBody.innerHTML = `
    <div class="verdict ${correct ? 'good' : 'bad'}">
      <div class="icon">${correct ? '✓' : '✗'}</div>
      <div><h3>${title}</h3><div class="sub">${sub}</div></div>
    </div>
    <p class="situation">${situation}</p>
    <div class="ev-list">${rows}</div>
    <p class="muted small" style="margin-top:8px">Expected return per unit bet${settings.rules.holeCard || settings.rules.obo ? '' : ', counting the risk of a dealer blackjack'}.</p>
    ${tip ? `<div class="tip">💡 ${tip}</div>` : ''}
    ${historyHTML()}`;
}

function historyHTML() {
  if (!history.length) return '';
  return `<div class="history"><h4>Recent decisions</h4><ol>${history.map((h) =>
    `<li class="${h.correct ? 'good' : 'bad'}"><span class="m">${h.correct ? '✓' : '✗'}</span><span>${h.text}</span></li>`).join('')}</ol></div>`;
}

function renderHistoryOnly() {
  el.fbEmpty.hidden = true;
  el.fbBody.hidden = false;
  el.fbBody.innerHTML = `<div class="verdict good"><div class="icon">✓</div><div><h3>Correct</h3><div class="sub">Keep going</div></div></div>${historyHTML()}`;
}

/* ---------------- Play flow ---------------- */
function clearAuto() {
  if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
}

function resetTableDom() {
  el.dealerCards.dataset.count = 0;
  el.hands.innerHTML = '';
  hideBanner();
}

function newHand() {
  clearAuto();
  resetTableDom();
  drillAnswered = false;
  pendingRetry = false;
  if (mode === 'drill') {
    round = makeDrillRound();
  } else {
    round = startRound(shoe, settings.rules, BET);
  }
  round.mode = mode;
  render();
  if (round.phase === 'dealer') runDealer();
}

function render() {
  renderTable();
  renderControls();
  renderScore();
}

function onAction(action) {
  if (busy || !round || round.phase !== 'player') return;
  if (mode === 'drill' && drillAnswered) return;
  const acts = availableActions(round, settings.rules);
  if (!acts[action]) return;

  const h = activeHand(round);
  const vals = h.cards.map((c) => c.value);
  const up = round.dealer[0].value;
  const analysis = analyzeActive(round, settings.rules);
  const best = analysis.best;
  const correct = action === best;
  const cost = analysis.evs[best] - analysis.evs[action];

  // Second attempt after a mistake in "make me pick again" mode: not graded again.
  if (pendingRetry) {
    if (!correct) { shake(action); return; }
    pendingRetry = false;
    if (mode === 'drill') {
      drillAnswered = true;
      renderControls();
      return;
    }
    applyAction(round, action, shoe, settings.rules);
    render();
    if (round.phase === 'dealer') runDealer();
    return;
  }

  const twoCard = vals.length === 2;
  const key = twoCard ? situationKey(vals, acts.split) : null;
  const info = handInfo(h.cards);
  const handName = twoCard && vals[0] === vals[1]
    ? `${upLabel(vals[0])},${upLabel(vals[1])}`
    : `${info.soft ? 'Soft' : 'Hard'} ${info.total}`;
  const handText = `${handName} vs ${upLabel(up)}`;
  const cat = !twoCard ? 'multi' : key[0] === 'P' ? 'pairs' : key[0] === 'S' ? 'soft' : 'hard';
  if (twoCard) lastSpot = { key, up };

  record({ correct, cost, key, up, cat });
  pushHistory({ correct, text: `${handText}: ${ACTION_LABEL[action]}${correct ? '' : ` → ${ACTION_LABEL[best]}`}` });
  renderFeedback({
    correct,
    title: correct ? `${ACTION_LABEL[action]} is right` : `Best play: ${ACTION_LABEL[best]}`,
    sub: correct ? (analysis.ranked.length > 1 ? `${((analysis.evs[best] - analysis.ranked[1][1]) * 100).toFixed(1)}% of your bet better than ${ACTION_LABEL[analysis.ranked[1][0]].toLowerCase()}` : '') : `You chose ${ACTION_LABEL[action].toLowerCase()}, costing ${(cost * 100).toFixed(1)}% of your bet`,
    situation: `${handText}${h.cards.length > 2 ? ` · ${h.cards.length} cards` : ''}`,
    evs: analysis.evs,
    best,
    chosen: action,
    tip: tipFor(vals, up, best, action, analysis),
  });

  if (!correct && settings.opts.onMistake === 'retry') {
    pendingRetry = true;
    shake(action);
    return;
  }

  if (mode === 'drill') {
    drillAnswered = true;
    showBanner(correct ? '✓ Correct' : `✗ ${ACTION_LABEL[best]}`, correct ? 'good' : 'bad');
    renderControls();
    return;
  }

  applyAction(round, action, shoe, settings.rules);
  render();
  if (round.phase === 'dealer') runDealer();
}

function shake(action) {
  const btn = $(`#actions [data-action="${action}"]`);
  btn.classList.remove('flash-wrong');
  void btn.offsetWidth;
  btn.classList.add('flash-wrong');
}

function onInsurance(take) {
  if (busy || !round || round.phase !== 'insurance') return;
  const even = isNatural(round.hands[0].cards);
  const correct = !take;
  const ev = insuranceEV(); // per unit of insurance stake
  const cost = take ? -ev * 0.5 : 0;
  record({ correct, cost, key: null, cat: 'insurance' });
  pushHistory({ correct, text: `${even ? 'Even money' : 'Insurance'}: ${take ? 'Yes' : 'No'}${correct ? '' : ' → No'}` });
  renderFeedback({
    correct,
    title: correct ? `Declining is right` : `Never take ${even ? 'even money' : 'insurance'}`,
    sub: correct ? 'Insurance is a losing side bet' : `Costs ${(cost * 100).toFixed(1)}% of your main bet`,
    situation: even ? 'Your blackjack vs dealer Ace' : `${describeHand(round.hands[0].cards)} vs dealer Ace`,
    evs: { Decline: 0, Take: ev * 0.5 },
    best: 'Decline',
    chosen: take ? 'Take' : 'Decline',
    tip: 'Insurance wins only when the dealer\'s next card is a 10-value: 4 of 13 cards (30.8%). Paying 2:1, it needs 33.3% to break even. Without counting (and with an automatic shuffler) it\'s always a losing bet.',
  });
  resolveInsurance(round, settings.rules, take);
  render();
  if (round.phase === 'dealer') runDealer();
}

async function runDealer() {
  busy = true;
  renderControls();
  const speed = Number(settings.opts.speed);
  await sleep(speed * 0.6);
  while (dealerStep(round, shoe, settings.rules)) {
    renderTable();
    await sleep(speed);
  }
  const net = settle(round, settings.rules);
  if (round.mode !== mode) {
    // The player switched modes while the dealer was drawing.
    busy = false;
    stats.hands++;
    stats.net += net;
    stats.bankroll += net;
    saveStats();
    if (mode === 'play' || mode === 'drill') newHand();
    return;
  }
  stats.hands++;
  stats.net += net;
  stats.bankroll += net;
  saveStats();
  busy = false;
  render();
  const msg = net > 0 ? `You win +${net}` : net < 0 ? `You lose ${net}` : 'Push';
  const dealerBJ = isNatural(round.dealer);
  showBanner(dealerBJ && net < 0 ? `Dealer blackjack · ${net}` : msg, net > 0 ? 'good' : net < 0 ? 'bad' : '');
  if (settings.opts.autoDeal === 'true' && mode === 'play') {
    autoTimer = setTimeout(newHand, 1800);
  }
}

/* ---------------- Drill ---------------- */
function drillCells() {
  const cells = [];
  const add = (key, cards) => UPCARDS.forEach((up) => cells.push({ key, cards, up }));
  const wantHard = ['all', 'hard', 'weak'].includes(drillFocus);
  const wantSoft = ['all', 'soft', 'weak'].includes(drillFocus);
  const wantPairs = ['all', 'pairs', 'weak'].includes(drillFocus);
  if (wantHard) for (let t = 8; t <= 17; t++) add(`H${t}`, null);
  if (wantSoft) for (let o = 2; o <= 9; o++) add(`S${o}`, [11, o]);
  if (wantPairs) for (let v = 2; v <= 11; v++) add(`P${v}`, [v, v]);
  return cells;
}

function hardCombo(t) {
  const combos = [];
  for (let a = 2; a <= 10; a++) for (let b = a + 1; b <= 10; b++) if (a + b === t) combos.push([a, b]);
  return combos[Math.floor(Math.random() * combos.length)];
}

function pickWeighted(cells) {
  const weights = cells.map((c) => {
    if (drillFocus !== 'weak') return 1;
    const s = stats.cells[`${c.key}|${c.up}`];
    if (!s) return 1.5;
    return 0.3 + (s.wrong / s.n) * 10 + s.wrong;
  });
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < cells.length; i++) {
    r -= weights[i];
    if (r <= 0) return cells[i];
  }
  return cells[cells.length - 1];
}

function makeDrillRound() {
  const cells = drillCells();
  for (let attempt = 0; attempt < 50; attempt++) {
    const cell = pickWeighted(cells);
    let cards = cell.cards || hardCombo(Number(cell.key.slice(1)));
    if (Math.random() < 0.5) cards = [cards[1], cards[0]];
    const r = startRound(shoe, settings.rules, BET, { player: cards, up: cell.up });
    if (r.phase === 'insurance') resolveInsurance(r, settings.rules, false);
    if (r.phase === 'player') return r;
  }
  return startRound(shoe, settings.rules, BET, { player: [10, 6], up: 10 });
}

/* ---------------- Chart ---------------- */
let selectedCell = null;

function renderChart() {
  const rows = chartRows();
  const overlay = el.overlayToggle.checked;
  const block = (title, list) => `
    <div class="chart-block">
      <h3>${title}</h3>
      <table class="chart">
        <thead><tr><th></th>${UPCARDS.map((u) => `<th>${upLabel(u)}</th>`).join('')}</tr></thead>
        <tbody>${list.map((row) => `<tr><th class="row">${row.label}</th>${UPCARDS.map((u) => {
          const { code } = chartCell(row.cards, u, settings.rules);
          const s = stats.cells[`${row.key}|${u}`];
          let acc = '';
          let heat = '';
          if (s && s.n) {
            const rate = s.wrong / s.n;
            acc = `${Math.round((1 - rate) * 100)}%`;
            const hue = Math.round(130 * (1 - rate));
            heat = `--heat: hsl(${hue} 60% 32%);`;
          }
          const cur = lastSpot && lastSpot.key === row.key && lastSpot.up === u ? ' current' : '';
          const sel = selectedCell && selectedCell.key === row.key && selectedCell.up === u ? ' selected' : '';
          return `<td class="c-${code}${cur}${sel}" data-key="${row.key}" data-up="${u}" data-acc="${acc}" style="${heat}" title="${row.label} vs ${upLabel(u)}">${code}</td>`;
        }).join('')}</tr>`).join('')}</tbody>
      </table>
    </div>`;
  el.charts.classList.toggle('overlay', overlay);
  el.charts.innerHTML = block('Hard totals', rows.hard) + block('Soft totals', rows.soft) + block('Pairs', rows.pairs);
}

function showCellDetail(key, up) {
  const rows = chartRows();
  const row = [...rows.hard, ...rows.soft, ...rows.pairs].find((r) => r.key === key);
  if (!row) return;
  selectedCell = { key, up };
  const { res, code } = chartCell(row.cards, up, settings.rules);
  const s = stats.cells[`${key}|${up}`];
  const lo = Math.min(...res.ranked.map((e) => e[1]), 0);
  const hi = Math.max(...res.ranked.map((e) => e[1]), 0);
  const span = hi - lo || 1;
  const zero = ((0 - lo) / span) * 100;
  el.cellDetail.hidden = false;
  el.cellDetail.innerHTML = `
    <h3>${row.label} vs ${upLabel(up)} → <span class="lg c-${code}">${code}</span></h3>
    <div class="ev-list">${res.ranked.map(([a, v]) => {
      const pos = ((v - lo) / span) * 100;
      return `<div class="ev-row${a === res.best ? ' best' : ''}"><span class="name">${ACTION_LABEL[a]}</span>
        <span class="bar"><i style="left:${Math.min(pos, zero)}%;width:${Math.max(Math.abs(pos - zero), 1.5)}%;background:${a === res.best ? 'var(--good)' : 'rgba(255,255,255,0.35)'}"></i></span>
        <span class="val">${fmtEV(v)}</span></div>`;
    }).join('')}</div>
    <p class="muted small" style="margin:10px 0 0">${s ? `Your record: ${s.n - s.wrong}/${s.n} correct.` : 'You haven\'t seen this spot yet.'}</p>`;
  renderChart();
}

/* ---------------- Stats view ---------------- */
function renderStats() {
  const pct = (c) => (c && c.n ? `${Math.round(((c.n - c.wrong) / c.n) * 100)}%` : '–');
  const card = (k, v, d = '') => `<div class="stat-card"><div class="k">${k}</div><div class="v">${v}</div><div class="d">${d}</div></div>`;
  el.statsGrid.innerHTML = [
    card('Accuracy', stats.decisions ? `${((stats.correct / stats.decisions) * 100).toFixed(1)}%` : '–', `${stats.correct} of ${stats.decisions} decisions`),
    card('Best streak', stats.bestStreak, `current ${stats.streak}`),
    card('EV given away', stats.evLost.toFixed(2), 'bets lost to mistakes, on average'),
    card('Hands played', stats.hands, `net ${stats.net >= 0 ? '+' : ''}${Math.round(stats.net)} chips`),
    card('Hard totals', pct(stats.cats.hard), `${stats.cats.hard?.n || 0} decisions`),
    card('Soft totals', pct(stats.cats.soft), `${stats.cats.soft?.n || 0} decisions`),
    card('Pairs', pct(stats.cats.pairs), `${stats.cats.pairs?.n || 0} decisions`),
    card('3+ card hands', pct(stats.cats.multi), `${stats.cats.multi?.n || 0} decisions`),
    card('Insurance', pct(stats.cats.insurance), `${stats.cats.insurance?.n || 0} offers`),
  ].join('');

  const rows = chartRows();
  const all = [...rows.hard, ...rows.soft, ...rows.pairs];
  const misses = Object.entries(stats.cells)
    .filter(([, s]) => s.wrong > 0)
    .sort((a, b) => b[1].wrong - a[1].wrong || (b[1].wrong / b[1].n) - (a[1].wrong / a[1].n))
    .slice(0, 12);
  el.missList.innerHTML = misses.length ? misses.map(([k, s]) => {
    const [key, up] = k.split('|');
    const row = all.find((r) => r.key === key);
    const code = row ? chartCell(row.cards, Number(up), settings.rules).code : '';
    return `<div class="miss"><span>${spotLabel(key, Number(up))}</span><span class="lg c-${code}">${code}</span><span class="rate">${s.wrong}/${s.n} wrong</span></div>`;
  }).join('') : '<p class="muted">No mistakes recorded yet. Nice.</p>';
}

/* ---------------- Mode switching ---------------- */
function setMode(m) {
  mode = m;
  $$('.modes button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === m)));
  const table = m === 'play' || m === 'drill';
  $('#tableView').hidden = !table;
  $('#chartView').hidden = m !== 'chart';
  $('#statsView').hidden = m !== 'stats';
  el.drillPicker.hidden = m !== 'drill';
  renderScore();
  if (table) {
    if (!busy && (!round || round.mode !== m || round.phase === 'done' || (m === 'drill' && drillAnswered))) {
      newHand();
    }
  } else {
    clearAuto();
  }
  if (m === 'chart') renderChart();
  if (m === 'stats') renderStats();
}

/* ---------------- Settings ---------------- */
function matchPreset() {
  const r = settings.rules;
  for (const [name, p] of Object.entries(PRESETS)) {
    if (Object.keys(p).every((k) => p[k] === r[k])) return name;
  }
  return 'custom';
}

function syncSettingsForm() {
  el.preset.value = matchPreset();
  $$('[data-rule]').forEach((s) => { s.value = String(settings.rules[s.dataset.rule]); });
  $$('[data-opt]').forEach((s) => { s.value = String(settings.opts[s.dataset.opt]); });
  // OBO only matters without a hole card.
  $('[data-rule="obo"]').disabled = settings.rules.holeCard;
}

function parseRule(name, v) {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (name === 'maxHands') return Number(v);
  return v;
}

function onRulesChanged() {
  rulesDirty = true;
  saveSettings();
  syncSettingsForm();
  updateRulesText();
  if (mode === 'chart') renderChart();
  if (mode === 'stats') renderStats();
}

/* ---------------- Events ---------------- */
$$('.modes button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
$$('#actions .act').forEach((b) => b.addEventListener('click', () => onAction(b.dataset.action)));
$$('#insActions .act').forEach((b) => b.addEventListener('click', () => onInsurance(b.dataset.ins === 'yes')));
el.nextBtn.addEventListener('click', () => { if (!busy) newHand(); });
$$('#drillPicker [data-drill]').forEach((b) => b.addEventListener('click', () => {
  drillFocus = b.dataset.drill;
  $$('#drillPicker [data-drill]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  newHand();
}));

el.charts.addEventListener('click', (e) => {
  const td = e.target.closest('td[data-key]');
  if (td) showCellDetail(td.dataset.key, Number(td.dataset.up));
});
el.overlayToggle.addEventListener('change', renderChart);

$('#settingsBtn').addEventListener('click', () => { syncSettingsForm(); el.dialog.showModal(); });
el.preset.addEventListener('change', () => {
  if (PRESETS[el.preset.value]) settings.rules = { ...PRESETS[el.preset.value] };
  onRulesChanged();
});
$$('[data-rule]').forEach((s) => s.addEventListener('change', () => {
  settings.rules[s.dataset.rule] = parseRule(s.dataset.rule, s.value);
  onRulesChanged();
}));
$$('[data-opt]').forEach((s) => s.addEventListener('change', () => {
  settings.opts[s.dataset.opt] = s.value;
  saveSettings();
}));
el.dialog.addEventListener('close', () => {
  // Start a fresh hand so new rules apply cleanly.
  if (rulesDirty && (mode === 'play' || mode === 'drill') && !busy) newHand();
  rulesDirty = false;
});

$('#resetStats').addEventListener('click', () => {
  if (!confirm('Reset all stats and bankroll?')) return;
  stats = freshStats();
  history = [];
  saveStats();
  renderScore();
  renderStats();
});

/* ---------------- Keyboard ---------------- */
let capturing = null; // action id waiting for a new key

function renderKeyLabels() {
  $$('[data-key-for]').forEach((k) => { k.textContent = keyLabel(settings.keys[k.dataset.keyFor]); });
}

function renderKeyBinds() {
  $('#keyBinds').innerHTML = KEY_ACTIONS.map(({ id, label }) => `
    <div class="field"><span>${label}</span>
      <button type="button" class="key-btn${capturing === id ? ' capturing' : ''}" data-bind="${id}">${capturing === id ? 'Press a key…' : keyLabel(settings.keys[id])}</button>
    </div>`).join('');
}

function setKeys(keys) {
  settings.keys = keys;
  saveSettings();
  renderKeyLabels();
  renderKeyBinds();
}

$('#keyBinds').addEventListener('click', (e) => {
  const b = e.target.closest('[data-bind]');
  if (!b) return;
  capturing = capturing === b.dataset.bind ? null : b.dataset.bind;
  renderKeyBinds();
});
$('#resetKeys').addEventListener('click', () => { capturing = null; setKeys({ ...DEFAULT_KEYS }); });
el.dialog.addEventListener('cancel', (e) => {
  // Esc while rebinding cancels the rebind, not the dialog.
  if (capturing) { e.preventDefault(); capturing = null; renderKeyBinds(); }
});
el.dialog.addEventListener('close', () => { capturing = null; });

document.addEventListener('keydown', (e) => {
  if (capturing) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault();
    e.stopPropagation();
    const action = capturing;
    capturing = null;
    if (e.code === 'Escape' || RESERVED.has(e.code) || !e.code) renderKeyBinds();
    else setKeys(rebind(settings.keys, action, e.code));
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey || el.dialog.open) return;
  if (mode !== 'play' && mode !== 'drill') return;
  if (e.target.closest?.('input, select, textarea')) return;
  const action = actionForCode(settings.keys, e.code);
  if (action === 'hit' || action === 'stand' || action === 'double' || action === 'split') {
    e.preventDefault();
    onAction(action);
  } else if (action === 'insYes' || action === 'insNo') {
    e.preventDefault();
    onInsurance(action === 'insYes');
  } else if (action === 'next' || e.code === 'Enter' || e.code === 'NumpadEnter') {
    e.preventDefault();
    if (!el.nextActions.hidden && !busy) newHand();
  }
});

/* ---------------- Boot ---------------- */
updateRulesText();
renderKeyLabels();
renderKeyBinds();
setMode('play');
