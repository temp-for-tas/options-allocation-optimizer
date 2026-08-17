# Options Allocation Optimizer

A client-side tool for sizing options positions across multiple brokerage accounts. It uses an Integer Linear Programming (ILP) solver to recommend how many contracts of each ticker to sell, balancing dollar exposure evenly while maximizing cash utilization.

## How to Use

1. **Add accounts** — Name each brokerage account and enter its available cash. Each account is optimized independently against the same set of tickers. The 8–12% position size hint updates automatically per account.

2. **Enter positions** — For each ticker, enter the type (put/call), strike price, and premium. The cost per contract updates in real time.

3. **Read results** — The table shows recommended contracts, total cost, and percentage of cash per ticker for each account. Summary cards below the table show allocation, remaining cash, and utilization percentage.

4. **Funds needed** — Below the summaries, the app shows the minimum dollar amount you'd need to add to each account to reach full utilization (where remaining cash can't buy another contract). It re-runs the optimizer at the higher budget and shows the resulting allocation change.

### Modes

- **Enhanced** (default) — Cost per contract accounts for premium received and trading fees: `(strike × 100) - (premium × 100) + $0.66` for puts, `-(premium × 100) + $0.66` for calls.
- **Basic** — Puts cost `strike × 100`; calls cost $0 (no premium offset).

## Solver Logic

The optimizer is a bounded integer knapsack solved via [jsLPSolver](https://github.com/JWally/jsLPSolver).

### Objective

Maximize total dollar allocation across all tickers:

```
maximize  Σ (cost_i × n_i)
```

where `cost_i` is the net cash cost of one contract of ticker `i` and `n_i` is the number of contracts.

### Constraints

| Constraint | Formula | Purpose |
|---|---|---|
| Budget | `Σ (cost_i × n_i) ≤ available_cash` | Don't exceed account cash |
| Minimum 1 | `n_i ≥ 1` for all i (when affordable) | Every ticker gets at least one contract |
| Upper bound | `n_i ≤ floor(budget / cost_i)` | No single ticker can exceed what the budget could theoretically support |
| Dollar evenness | `maxD - minD ≤ dollarTolerance` | Positions must stay within a tight dollar spread of each other (see below) |
| Integrality | `n_i ∈ integers` | Can't buy fractional contracts |

### Dollar Balance

The solver tracks two continuous auxiliary variables:

- `maxD` — the largest dollar allocation across all tickers (`≥ cost_i × n_i` for all i)
- `minD` — the smallest dollar allocation across all tickers (`≤ cost_i × n_i` for all i)

The hard constraint `maxD - minD ≤ dollarTolerance` forces positions to stay balanced. The tolerance is computed as:

```
idealShare   = budget / numTickers
baseTolerance = min(avgCost, idealShare × 0.5)
dollarTolerance = max(baseTolerance, maxCost × 0.25)
```

This targets an even split of the budget across positions, while ensuring the tolerance never drops below 25% of the most expensive contract's cost (to stay feasible with integer constraints).

If the tight tolerance produces an infeasible model, the solver progressively relaxes through `[dollarTolerance, maxCost × 0.5, maxCost × 0.75, maxCost, budget]` until a feasible solution is found.

A balance penalty scaled as `1 / (budget + 1)` is applied to the spread (`-ε × maxD + ε × minD` in the objective) so the solver actively minimizes position imbalance rather than treating it as a pure tiebreaker.

### Phase 2: Greedy Fill

The tight balance constraint in phase 1 may leave budget unspent (remaining cash can still afford contracts, but adding them would violate the evenness tolerance). Phase 2 greedily fills that gap:

1. Compute remaining cash after the balanced ILP solution.
2. Among tickers whose contract cost fits in the remaining cash, pick the one with the **lowest current dollar allocation**.
3. Add one contract to that ticker and repeat until no contract fits.

This two-phase design keeps the bulk of the allocation balanced while maximizing utilization. The imbalance introduced by phase 2 is naturally bounded by how little budget remains after the balanced pass.

### Greedy Fallback

If the ILP solver is unavailable or produces an infeasible result, a greedy algorithm takes over:

1. Pre-assign 1 contract per ticker (if the budget allows).
2. Repeatedly add one more contract to whichever ticker has the **lowest current dollar allocation**, until no more contracts fit in the remaining budget.

### Free Rows

Calls in Enhanced mode often have negative cost (premium inflow exceeds the $0.66 fee). These are pre-assigned 1 contract and excluded from the ILP since they don't consume cash.

### Funds Needed Calculation

For each account, the app finds the minimum additional cash where:

1. Utilization improves over the current allocation, AND
2. Remaining cash after optimization is less than the cheapest available contract (the optimizer literally can't do better)

It generates candidate amounts from both single-row cost thresholds and a dense $1 sweep, evaluates them in ascending order, and stops at the first qualifying result.

## Deployment

The app is a single `index.html` file with no build step. It loads the LP solver from a CDN. Host it anywhere that serves static files — GitHub Pages, Netlify, or just open the file locally in a browser.

## Fees

Built-in constants:
- Commission: $0.65 per contract
- Exchange fee: $0.01 per contract
- Total fee: $0.66 per contract (applied in Enhanced mode only)
