// Keyboard bindings. Bound by physical key (KeyboardEvent.code) so the
// one-handed layout stays in place on QWERTZ/AZERTY keyboards too.

export const KEY_ACTIONS = [
  { id: 'hit', label: 'Hit' },
  { id: 'stand', label: 'Stand' },
  { id: 'double', label: 'Double' },
  { id: 'split', label: 'Split' },
  { id: 'insYes', label: 'Insurance: yes' },
  { id: 'insNo', label: 'Insurance: no' },
  { id: 'next', label: 'Next hand' },
];

// Left hand on the home row, thumb on Space.
export const DEFAULT_KEYS = {
  hit: 'KeyA',
  stand: 'KeyS',
  double: 'KeyD',
  split: 'KeyF',
  insYes: 'KeyQ',
  insNo: 'KeyW',
  next: 'Space',
};

const NAMED = {
  Space: 'Space', Enter: 'Enter', NumpadEnter: 'Num Enter', Tab: 'Tab', Backspace: 'Bksp',
  ShiftLeft: 'L Shift', ShiftRight: 'R Shift', CapsLock: 'Caps',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\',
  BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', Backquote: '`',
  NumpadAdd: 'Num +', NumpadSubtract: 'Num −', NumpadMultiply: 'Num ×', NumpadDivide: 'Num ÷',
  NumpadDecimal: 'Num .',
};

export function keyLabel(code) {
  if (!code) return '—';
  if (NAMED[code]) return NAMED[code];
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1];
  m = /^Digit(\d)$/.exec(code);
  if (m) return m[1];
  m = /^Numpad(\d)$/.exec(code);
  if (m) return `Num ${m[1]}`;
  return code;
}

// Keys that can't be bound (they'd break the dialog or the browser).
export const RESERVED = new Set(['Escape', 'MetaLeft', 'MetaRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'ContextMenu']);

export function normalizeKeys(saved) {
  const keys = { ...DEFAULT_KEYS };
  if (saved && typeof saved === 'object') {
    for (const { id } of KEY_ACTIONS) if (typeof saved[id] === 'string') keys[id] = saved[id];
  }
  return keys;
}

export function actionForCode(keys, code) {
  return KEY_ACTIONS.find(({ id }) => keys[id] === code)?.id ?? null;
}

// Bind `code` to `action`; an action that already had that key takes over the old one.
export function rebind(keys, action, code) {
  const next = { ...keys };
  const other = actionForCode(keys, code);
  if (other && other !== action) next[other] = keys[action];
  next[action] = code;
  return next;
}
