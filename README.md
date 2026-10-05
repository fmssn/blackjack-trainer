# Blackjack Trainer

Train perfect basic strategy for **German casino blackjack**, right in the browser.

**Live demo:** https://fmssn.github.io/blackjack-trainer/

## Rules (default: German casino)

- 6 decks, **automatic shuffler** (every round starts from a full shoe, so counting is useless)
- **No hole card** (European): the dealer takes the second card after you act, and a dealer blackjack takes **all** bets, doubles and splits included
- Dealer **stands on soft 17**
- Double down on **hard 9, 10, 11** only
- Double after split allowed, resplit up to 4 hands, split aces get one card
- Blackjack pays 3:2, insurance pays 2:1, no surrender

All rules are configurable in the settings (presets for "double on any two" and US hole-card games).

## Features

- **Play**: deal real hands; each decision is graded against the optimal move, with the EV of every option
- **Drill**: flashcard-style spots (hard, soft, pairs, or your weak spots)
- **Chart**: the complete basic strategy chart for the current rules, with an overlay of your accuracy per cell
- **Stats**: accuracy by category, EV given away, most missed spots (stored locally in your browser)
- Keyboard: `H` hit, `S` stand, `D` double, `P` split, `Y`/`N` insurance, `Space` next hand

## How the strategy is computed

`js/strategy.js` calculates exact expected values with the infinite-deck model (a very close fit
for a continuous shuffler) for whatever rules are selected. That reproduces the known ENHC
deviations, e.g. hit 11 vs 10/A, don't split 8,8 or A,A against 10/A.

## Development

No build step: it's static HTML, CSS and ES modules.

```sh
python3 -m http.server   # then open http://localhost:8000
npm test                 # strategy + game logic tests (Node 20+)
```

Deployed to GitHub Pages by `.github/workflows/pages.yml` on every push to the default branch.

Remember: the house always wins in the long run. This is for fun.
