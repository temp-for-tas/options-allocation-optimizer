/**
 * optimizer.js
 * Pure logic module — no DOM dependencies.
 * Used by both the HTML app (via <script type="module">) and the test suite.
 */

import solver from 'javascript-lp-solver';

// ── Constants ────────────────────────────────────────────────────────────────
export const COMMISSION   = 0.65;
export const EXCHANGE_FEE = 0.01;
export const TOTAL_FEE    = COMMISSION + EXCHANGE_FEE; // 0.66

// ── Cost model ───────────────────────────────────────────────────────────────
/**
 * Returns the net cash cost of ONE contract.
 *
 * Basic mode:
 *   put  → strike × 100
 *   call → 0  (no cash collateral required)
 *
 * Enhanced mode:
 *   put  → (strike × 100) - (premium × 100) + TOTAL_FEE
 *   call → -(premium × 100) + TOTAL_FEE  (net inflow)
 */
export function computeCost(type, strike, premium, isEnhanced) {
  const s = parseFloat(strike)  || 0;
  const p = parseFloat(premium) || 0;
  const isPut = type === 'put';

  if (!isEnhanced) {
    return isPut ? s * 100 : 0;
  }

  return isPut
    ? (s * 100) - (p * 100) + TOTAL_FEE
    : -(p * 100) + TOTAL_FEE;
}

// ── ILP Optimizer ────────────────────────────────────────────────────────────
/**
 * Solves the bounded integer knapsack exactly using jsLPSolver.
 *
 * Objective : maximize  Σ c_i · n_i          (cash utilization)
 * Subject to: Σ c_i · n_i ≤ availableCash    (budget)
 *             n_i ≥ 0, integer               (integrality)
 *
 * Evenness is encoded as a secondary objective by penalizing
 * (maxN - minN) with a tiny epsilon weight so utilization always dominates.
 *
 * Rows with c_i ≤ 0 (calls whose premium inflow exceeds fees) are
 * pre-assigned 1 contract and excluded from the ILP.
 *
 * @param  {Array<{cost: number}>} rows
 * @param  {number}                availableCash
 * @param  {object|null}           solverOverride  – inject a mock solver in tests
 * @returns {number[]}             integer contract counts, one per row
 */
export function optimize(rows, availableCash, solverOverride = null) {
  const counts = new Array(rows.length).fill(0);
  if (!availableCash || availableCash <= 0) return counts;

  // Pre-assign free rows (calls with net inflow)
  const freeIdx = [];
  rows.forEach((r, i) => {
    if (r.cost <= 0) { counts[i] = 1; freeIdx.push(i); }
  });

  const activeIdx = rows
    .map((_, i) => i)
    .filter(i => !freeIdx.includes(i) && rows[i].cost > 0);

  if (activeIdx.length === 0) return counts;

  // Budget after accounting for free-row inflows
  const freeCost = freeIdx.reduce((s, i) => s + rows[i].cost, 0);
  const budget   = availableCash - freeCost;
  if (budget <= 0) return counts;

  // Check whether we can afford at least 1 contract of every active row.
  // If not, fall back to best-effort (no minimum guarantee possible).
  const minCost = activeIdx.reduce((s, i) => s + rows[i].cost, 0);
  const enforceMin = minCost <= budget;

  const s = solverOverride ?? solver;

  if (s) {
    try {
      const EPS = 1e-4;
      const ub  = activeIdx.map(i => Math.floor(budget / rows[i].cost));

      const model = {
        optimize:    'obj',
        opType:      'max',
        constraints: {},
        variables:   {},
        ints:        {}
      };

      model.constraints['budget']  = { max: budget };
      model.variables['maxN']      = { obj: -EPS, budget: 0 };
      model.variables['minN']      = { obj:  EPS, budget: 0 };
      model.ints['maxN']           = 1;
      model.ints['minN']           = 1;

      activeIdx.forEach((rowIdx, j) => {
        const v = `x${j}`;
        const c = rows[rowIdx].cost;

        model.variables[v] = { obj: c, budget: c };
        model.ints[v]      = 1;

        // Lower bound: at least 1 contract per ticker (if affordable)
        if (enforceMin) {
          const lbKey = `lb${j}`;
          model.constraints[lbKey]  = { min: 1 };
          model.variables[v][lbKey] = 1;
        }

        // Upper bound
        const ubKey = `ub${j}`;
        model.constraints[ubKey]  = { max: ub[j] };
        model.variables[v][ubKey] = 1;

        // maxN >= x_j
        const maxKey = `max${j}`;
        model.constraints[maxKey]       = { min: 0 };
        model.variables['maxN'][maxKey] = 1;
        model.variables[v][maxKey]      = -1;

        // minN <= x_j
        const minKey = `min${j}`;
        model.constraints[minKey]       = { min: 0 };
        model.variables[v][minKey]      = 1;
        model.variables['minN'][minKey] = -1;
      });

      const result = s.Solve(model);

      if (result.feasible) {
        activeIdx.forEach((rowIdx, j) => {
          counts[rowIdx] = Math.round(result[`x${j}`] || 0);
        });
        return counts;
      }
    } catch (e) {
      // fall through to greedy
    }
  }

  // ── Greedy fallback ─────────────────────────────────────────────────────
  // Pre-seed 1 contract per active row if the budget allows it
  if (enforceMin) {
    activeIdx.forEach(i => { counts[i] = 1; });
  }

  const eligible  = activeIdx.map(i => ({ idx: i, cost: rows[i].cost }));
  const totalCost = () => rows.reduce((sum, r, i) => sum + r.cost * counts[i], 0);

  let changed = true;
  while (changed) {
    changed = false;
    const used       = totalCost();
    const remaining  = availableCash - used;
    const candidates = eligible.filter(r => r.cost <= remaining);
    if (candidates.length === 0) break;

    const minCount       = Math.min(...candidates.map(r => counts[r.idx]));
    const evenCandidates = candidates.filter(r => counts[r.idx] === minCount);

    let best = null, bestDelta = Infinity;
    for (const r of evenCandidates) {
      const delta = Math.abs(availableCash - (used + r.cost));
      if (delta < bestDelta) { bestDelta = delta; best = r; }
    }
    if (best) { counts[best.idx]++; changed = true; }
  }

  return counts;
}
