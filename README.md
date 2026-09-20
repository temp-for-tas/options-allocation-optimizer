# Options Allocation Optimizer

A client-side tool for sizing options positions across multiple brokerage accounts. It recommends how many contracts of each ticker to sell, sizing each position to a target band of the account value (8–12%) and preferring fewer, properly-sized positions over many tiny ones.

## How to Use

1. **Add accounts** — Name each brokerage account and enter its available cash. Each account is optimized independently against the same set of tickers. The 8–12% position size hint updates automatically per account.

2. **Enter positions** — For each ticker, enter the type (put/call), strike price, and premium. The cost per contract updates in real time. Use the **On** toggle at the start of each row to include or exclude that ticker from the optimization without deleting it — handy for quickly comparing scenarios. Excluded rows are dimmed and get no contract suggestions.

   The **Premium %** column shows the net premium (after commissions and fees in Enhanced mode) as a percentage of the collateral (`strike × 100`). For example, a $10 strike collecting $0.10 premium yields `($10.00 − $0.66) / $1,000 = 0.93%` — a touch under 1% because the per-contract fee is deducted. In Basic mode no fees are subtracted, so the same position reads a clean 1.00%.

3. **Read results** — The table shows recommended contracts, total cost, and percentage of cash per ticker for each account. Summary cards below the table show allocation, remaining cash, and utilization percentage.

   Cost-per-contract cells update instantly as you type. The heavier optimizer solve is debounced (~300 ms after you stop typing), so the app stays responsive even with many tickers and accounts. Discrete actions like adding a row, adding an account, or toggling modes recalculate immediately.

4. **Funds needed** — Below the summaries, click **Calculate** to find the minimum dollar amount you'd need to add to each account to reach full utilization (where remaining cash can't buy another contract). It re-runs the optimizer at the higher budget and shows the resulting allocation change. This runs on demand (not on every edit) since transferred funds often take days to settle — and because the sweep is the heaviest computation in the app. If you change any inputs after calculating, the results dim and the button relabels to **Recalculate** to signal they may be stale.

### Modes

- **Enhanced** (default) — Cost per contract accounts for premium received and trading fees: `(strike × 100) - (premium × 100) + $0.66` for puts, `-(premium × 100) + $0.66` for calls.
- **Basic** — Puts cost `strike × 100`; calls cost $0 (no premium offset).

## Solver Logic

The optimizer sizes each position to a **target band of the account value** and prefers fewer, properly-sized positions over many small ones.

### Target Band

The band is derived from the account **value** (the Value field, not available cash — some of that value may be locked in rolled contracts, but positions are still sized against the full account):

```
targetLow  = value × 0.08
targetMid  = value × 0.10
targetHigh = value × 0.12
```

Sizing is absolute (against account value), so a ticker that ends up with **0 contracts never influences the sizing of any other ticker**. Toggling an unfunded ticker on or off leaves the rest of the allocation unchanged.

### Algorithm (per account)

1. **Free rows** — Tickers with non-positive cost (e.g. premium-inflow calls in Enhanced mode) get 1 contract and are excluded from sizing since they don't consume cash.

2. **Band count** — For each remaining ticker, find the contract count whose dollar allocation lands closest to `targetMid`. A ticker is *oversized* if even a single contract exceeds `targetHigh` (funding it would create a concentrated position).

3. **Rank candidates** — by, in order: not-oversized first, then in-band achievable, then net premium yield (yield ÷ cost, best first), then closeness to the band midpoint, then cheaper cost.

4. **Pass 1 — disciplined sizing** — Walk the ranked list and fund each non-oversized ticker to its band count, if available cash allows. Capped at **one target-band position per ticker**, so cash isn't concentrated by doubling up.

5. **Pass 2 — soak up leftover cash** — If cash remains, add a **single** extra position rather than leaving it idle: first an unfunded, non-oversized ticker (an underweight position is acceptable); only as a last resort an oversized ticker.

This delivers the intended behavior: given two tickers that would each only reach ~4% of value at one contract, the higher-yielding one is funded with two contracts to reach ~8% (in-band) and the other is skipped — a properly-sized position beats two underweight halves. Diversification is preserved by capping each ticker at one band position and allowing only a single underweight fill.

### Ranking by Yield

Candidates are ranked by net premium % (`(premium × 100 − fees) ÷ cost` in Enhanced mode). Higher-yielding tickers are funded first, so selection is meaningful and deterministic rather than arbitrary.

### Funds Needed Calculation

For each account, the app finds the minimum additional cash where:

1. Utilization improves over the current allocation, AND
2. Remaining cash after optimization is less than the cheapest available contract (the optimizer literally can't do better)

It generates candidate amounts from both single-row cost thresholds and a dense $1 sweep, evaluates them in ascending order, and stops at the first qualifying result. This sweep runs only when you click **Calculate** (or **Recalculate**), keeping the main allocation solve fast.

## Deployment

The app is a single `index.html` file with no build step and no external dependencies. Host it anywhere that serves static files — GitHub Pages, Netlify, or just open the file locally in a browser.

## Fees

Built-in constants:
- Commission: $0.65 per contract
- Exchange fee: $0.01 per contract
- Total fee: $0.66 per contract (applied in Enhanced mode only)
