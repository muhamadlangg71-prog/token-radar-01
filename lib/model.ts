// Token Radar — the radar-2 scoring model.
//
// The entry reads a sealed snapshot of DeFi protocols (as published by the
// competition kit) and ranks the protocols that have no token yet by an
// implied value: how much a token would be worth if it launched today, as
// implied by the protocol's locked value and a few quality adjustments.
// Every number on the board comes from this file, so the dashboard can
// recompute any row from the snapshot alone and land on the same figure.
//
// The model, in one paragraph: a protocol's implied value is its TVL times a
// category multiple, times a growth multiple from its 7-day change, times a
// maturity multiple from its age, times a chain multiple from how many chains
// it runs on. The watchlist the kit ships is a floor, never a ceiling: the
// board holds all forty watchlist protocols plus every other protocol that
// qualifies as pre-token. Each row also carries a six-step farm plan that
// tells a reader how to build a position in that protocol.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ModelBreakdown {
  base_multiple: number;
  category_multiple: number;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  age_days: number | null;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: string;
  age_days: number | null;
  implied_value_usd: number;
  model: ModelBreakdown;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

export interface Radar {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  live: LiveRow[];
}

// The model's constants, kept in one place so the dashboard's data file can
// print them verbatim. The growth multiple is 1 plus the clamped weekly
// change times the growth weight over a hundred; the maturity multiple runs
// from its floor up to 1 over the maturity window; an unknown listing date
// counts as the unknown-age default. The chain multiple adds one step per
// extra chain, capped.
export const MODEL = {
  base_multiple: 0.25,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  chain_step: 0.03,
  chain_cap: 5,
  category_multiples: {
    rwa: 0.4,
    derivatives: 0.35,
    perpetual: 0.35,
    'basis trading': 0.35,
    lending: 0.3,
    cdp: 0.3,
    'collateral markets': 0.3,
    'risk curators': 0.3,
    'onchain capital allocator': 0.3,
    restaking: 0.3,
    'restaked btc': 0.3,
    payments: 0.3,
    yield: 0.25,
    'yield aggregator': 0.25,
    dexs: 0.2,
    default: 0.25,
  },
} as const;

export const MODEL_VERSION = 'radar-2';

// Categories the board never ranks, however large their TVL: exchanges and
// bridges move other people's tokens instead of holding a farmable position,
// liquid staking and restaking wrappers already have a token by definition,
// and the rest are either custodial, private, or a token locker.
const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'CEX',
  'Canonical Bridge',
  'Liquid Restaking',
  'Liquid Staking',
  'Options Vault',
  'Privacy',
  'Restaked BTC',
]);

// A protocol counts as pre-token when the snapshot carries no market cap, no
// price-tracker id and no ticker for it. On top of that, versioned
// redeployments (a name ending in " V2" or " V3") and staking-vault listings
// (a name carrying " Staking") are skipped: they are re-issues of a protocol
// the board already ranks, not fresh launches of their own.
export function isRankable(p: SnapshotProtocol): boolean {
  if (p.mcap_usd !== null || p.gecko_id !== null || p.symbol !== null) return false;
  if (EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (/ V\d+$/.test(p.name)) return false;
  if (p.name.includes(' Staking')) return false;
  return true;
}

// The category multiple: an exact match on the lowercased category first,
// then the first table entry the category name contains (so "CDP Manager"
// picks up the CDP multiple and "Uncollateralized Lending" the lending one),
// then the table's default.
export function categoryMultiple(category: string): number {
  const key = category.toLowerCase();
  const table = MODEL.category_multiples as Record<string, number>;
  for (const name of Object.keys(table)) {
    if (name !== 'default' && name === key) return table[name];
  }
  for (const name of Object.keys(table)) {
    if (name !== 'default' && key.includes(name)) return table[name];
  }
  return table['default'];
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

// Round to six decimals for display. The implied value itself is always
// computed from the unrounded multipliers; only the breakdown a reader sees
// is rounded.
function round6(value: number): number {
  return Math.round(value * 1000000) / 1000000;
}

function daysBetween(asOf: string, listedAt: string): number {
  const [ay, am, ad] = asOf.split('-').map(Number);
  const [ly, lm, ld] = listedAt.split('-').map(Number);
  const span = Date.UTC(ay, am - 1, ad) - Date.UTC(ly, lm - 1, ld);
  return Math.round(span / 86400000);
}

export function ageDays(snapshot: Snapshot, p: SnapshotProtocol): number | null {
  if (p.listed_at === null) return null;
  return daysBetween(snapshot.as_of, p.listed_at);
}

// Score one protocol. The base multiple is recorded in the breakdown for
// honesty about the model's scale, but it is not part of the product: the
// implied value is TVL times category, growth, maturity and chain multiples.
export function scoreProtocol(
  snapshot: Snapshot,
  p: SnapshotProtocol,
): { implied: number; breakdown: ModelBreakdown; age: number | null } {
  const age = ageDays(snapshot, p);
  const effectiveAge = age === null ? MODEL.unknown_age_days : age;
  const growthPct = clamp(
    p.change_7d === null ? 0 : p.change_7d,
    MODEL.growth_floor,
    MODEL.growth_cap,
  );
  const growth = 1 + (growthPct * MODEL.growth_weight) / 100;
  const maturity = Math.min(
    1,
    MODEL.maturity_floor + (effectiveAge * MODEL.maturity_range) / MODEL.maturity_days,
  );
  const chain = 1 + MODEL.chain_step * Math.min(p.chains.length - 1, MODEL.chain_cap);
  const category = categoryMultiple(p.category);
  const implied = Math.round(p.tvl_usd * category * growth * maturity * chain);
  return {
    implied,
    age,
    breakdown: {
      base_multiple: MODEL.base_multiple,
      category_multiple: category,
      growth_pct: growthPct,
      growth_multiplier: round6(growth),
      maturity_multiplier: round6(maturity),
      chain_multiplier: round6(chain),
      age_days: age,
    },
  };
}

// How much capital a farm position uses: the bigger the protocol, the bigger
// the position the board suggests — $150 for a billion-dollar TVL, $100 past
// a hundred million, $50 below that.
export function farmAmount(tvlUsd: number): number {
  if (tvlUsd >= 1_000_000_000) return 150;
  if (tvlUsd >= 100_000_000) return 100;
  return 50;
}

// How long to hold: a protocol listed a year or more ago has already proven
// it can survive, so thirty days of activity is enough; younger protocols
// need a longer look — forty-five days past six months, sixty before that.
// An unknown listing date counts as a year old, like the maturity rule.
export function holdDays(age: number | null): number {
  const effective = age === null ? MODEL.unknown_age_days : age;
  if (effective >= 365) return 30;
  if (effective >= 180) return 45;
  return 60;
}

type StepFn = (name: string, chain: string, amount: number) => string;

// Step two, the opening move, depends on what the protocol actually does:
// vaults take a deposit, debt protocols mint against collateral, pools take
// liquidity, staking takes a stake, and so on down the list.
const STEP_TWO: Record<string, StepFn> = {
  'Risk Curators': (name, chain, amount) =>
    `Deposit $${amount} into a ${name} vault on ${chain} and keep the shares.`,
  'Onchain Capital Allocator': (name, chain, amount) =>
    `Deposit $${amount} into a ${name} vault on ${chain} and keep the shares.`,
  CDP: (name, chain, amount) =>
    `Mint ${name} against $${amount} of collateral on ${chain} and keep the loan open.`,
  'CDP Manager': (name, chain, amount) =>
    `Mint ${name} against $${amount} of collateral on ${chain} and keep the loan open.`,
  RWA: (name, chain, amount) =>
    `Mint $${amount} of the protocol's yield asset on ${chain} and hold it.`,
  Lending: (name, chain, amount) =>
    `Supply $${amount} of USDC to ${name} on ${chain} and keep the position open.`,
  'Collateral Markets': (name, chain, amount) =>
    `Supply $${amount} of USDC to ${name} on ${chain} and keep the position open.`,
  'Uncollateralized Lending': (name, chain, amount) =>
    `Supply $${amount} of USDC to ${name} on ${chain} and keep the position open.`,
  Dexs: (name, chain, amount) =>
    `Provide $${amount} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`,
  Yield: (name, chain, amount) =>
    `Provide $${amount} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`,
  'Yield Aggregator': (name, chain, amount) =>
    `Provide $${amount} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`,
  'Leveraged Farming': (name, chain, amount) =>
    `Provide $${amount} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`,
  Indexes: (name, chain, amount) =>
    `Provide $${amount} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`,
  Restaking: (name, chain, amount) =>
    `Stake $${amount} of the chain's staking asset through ${name} and keep the receipt.`,
  'Staking Pool': (name, chain, amount) =>
    `Stake $${amount} of the chain's staking asset through ${name} and keep the receipt.`,
  Derivatives: (name, chain, amount) =>
    `Deposit $${amount} of USDC as margin on ${name} and open one small hedge.`,
  'Interest Rate Derivatives': (name, chain, amount) =>
    `Deposit $${amount} of USDC as margin on ${name} and open one small hedge.`,
  'Prediction Market': (name, _chain, amount) =>
    `Fund $${amount} and place one market position on ${name}.`,
  'Cross Chain Bridge': (name, chain, amount) =>
    `Bridge $${amount} of USDC to ${chain} through ${name} and use the bridged funds in its app.`,
  'Stablecoin Wrapper': (name, chain, amount) =>
    `Mint or deposit $${amount} of the stable asset through ${name} on ${chain}.`,
  'Dual-Token Stablecoin': (name, chain, amount) =>
    `Mint or deposit $${amount} of the stable asset through ${name} on ${chain}.`,
  Insurance: (name, chain, amount) =>
    `Buy $${amount} of cover from ${name} on ${chain} and keep the policy.`,
  // Revision: every remaining category on the board gets its own opening
  // move, so no row falls back to the generic deposit. BTC-anchored and
  // BTC-native protocols take BTC, a basis desk opens a basis trade, a
  // chain takes funds onto the chain itself, a card issuer is loaded and
  // spent, a farm takes a farm deposit, a governance protocol takes a
  // deposit plus a vote, a liquidity manager takes a managed-vault deposit,
  // an OTC desk takes one trade, and a payments protocol opens a channel.
  'Anchor BTC': (name, chain, amount) =>
    `Deposit $${amount} of BTC into ${name} on ${chain} and keep the receipt.`,
  'Basis Trading': (name, chain, amount) =>
    `Deposit $${amount} of USDC as margin on ${name} and open one small basis trade.`,
  CeDeFi: (name, chain, amount) =>
    `Deposit $${amount} of USDC into ${name}'s vault on ${chain} and keep the position open.`,
  Chain: (name, chain, amount) =>
    `Move $${amount} of USDC onto ${chain} through ${name} and use it in the chain's main app.`,
  'Crypto Card Issuer': (name, chain, amount) =>
    `Order a ${name} card and load $${amount} on ${chain}, then use it for everyday spending.`,
  'Decentralized BTC': (name, chain, amount) =>
    `Deposit $${amount} of BTC into ${name} on ${chain} and keep the receipt.`,
  Farm: (name, chain, amount) =>
    `Deposit $${amount} of USDC into ${name}'s farm on ${chain} and keep the position open.`,
  'Governance Incentives': (name, chain, amount) =>
    `Deposit $${amount} into ${name} on ${chain} and take part in its governance votes.`,
  'Liquidity Manager': (name, chain, amount) =>
    `Deposit $${amount} into a ${name} managed vault on ${chain} and keep the shares.`,
  'OTC Marketplace': (name, chain, amount) =>
    `Fund $${amount} and place one OTC trade on ${name} on ${chain}.`,
  Payments: (name, chain, amount) =>
    `Open a $${amount} payment channel on ${chain} through ${name} and keep it funded.`,
};

const STEP_TWO_DEFAULT: StepFn = (name, chain, amount) =>
  `Deposit $${amount} of USDC into ${name} on ${chain} and keep the position open.`;

// Step three, the weekly habit that keeps the position alive in snapshots:
// vaults get rebalanced, loans get topped up, pools get a small swap, stakes
// get their rewards restaked, and the rest get one qualifying action a week.
const STEP_THREE: Record<string, StepFn> = {
  'Risk Curators': (name) =>
    `Check ${name}'s rebalance and add or remove a small amount each week.`,
  'Onchain Capital Allocator': (name) =>
    `Check ${name}'s rebalance and add or remove a small amount each week.`,
  'Liquidity Manager': (name) =>
    `Check ${name}'s rebalance and add or remove a small amount each week.`,
  CDP: (name) =>
    `Top up collateral or repay a small amount of the loan on ${name} once a week.`,
  'CDP Manager': (name) =>
    `Top up collateral or repay a small amount of the loan on ${name} once a week.`,
  'Collateral Markets': (name) =>
    `Top up collateral or repay a small amount of the loan on ${name} once a week.`,
  Lending: (name) =>
    `Top up collateral or repay a small amount of the loan on ${name} once a week.`,
  'Uncollateralized Lending': (name) =>
    `Top up collateral or repay a small amount of the loan on ${name} once a week.`,
  Dexs: (name) => `Swap a small amount through ${name}'s pool each week.`,
  Yield: (name) => `Swap a small amount through ${name}'s pool each week.`,
  'Yield Aggregator': (name) => `Swap a small amount through ${name}'s pool each week.`,
  'Leveraged Farming': (name) => `Swap a small amount through ${name}'s pool each week.`,
  Indexes: (name) => `Swap a small amount through ${name}'s pool each week.`,
  Restaking: (name) =>
    `Top up the stake or claim and restake the rewards on ${name} once a week.`,
  'Staking Pool': (name) =>
    `Top up the stake or claim and restake the rewards on ${name} once a week.`,
  Derivatives: (name) => `Open and close one small hedge on ${name} each week.`,
  'Interest Rate Derivatives': (name) =>
    `Open and close one small hedge on ${name} each week.`,
  'Basis Trading': (name) => `Open and close one small hedge on ${name} each week.`,
  'Prediction Market': (name) => `Place one small market position on ${name} each week.`,
  RWA: (name) =>
    `Check the yield accrual on ${name} and mint or redeem a small amount each week.`,
  'Stablecoin Wrapper': (name) =>
    `Mint or redeem a small amount of the stable asset through ${name} each week.`,
  'Dual-Token Stablecoin': (name) =>
    `Mint or redeem a small amount of the stable asset through ${name} each week.`,
  Insurance: (name) =>
    `Check the cover terms on ${name} and renew or adjust a small amount each week.`,
  // Revision: every remaining category on the board gets its own weekly
  // habit, so no row falls back to the generic action. BTC protocols check
  // yield and restake, a chain's app is used weekly, a bridge bridges, a
  // card is spent and topped up, a farm harvests and restakes, a governance
  // position votes, an OTC desk trades, and a payment channel routes.
  'Anchor BTC': (name) =>
    `Check the BTC yield accrual on ${name} and add or restake a small amount each week.`,
  CeDeFi: (name) =>
    `Check the yield on ${name} and add or withdraw a small amount each week.`,
  Chain: (name, chain) =>
    `Use ${name}'s main app on ${chain} once a week so the activity is recorded.`,
  'Cross Chain Bridge': (name) =>
    `Bridge a small amount through ${name} to another chain each week.`,
  'Crypto Card Issuer': (name) =>
    `Spend a small amount with the ${name} card each week and top it up.`,
  'Decentralized BTC': (name) =>
    `Check the BTC yield on ${name} and add or restake a small amount each week.`,
  Farm: (name) =>
    `Harvest and restake the farm rewards on ${name} once a week.`,
  'Governance Incentives': (name) =>
    `Vote with the ${name} position once a week and claim any incentives.`,
  'OTC Marketplace': (name) =>
    `Place one small OTC trade on ${name} each week.`,
  Payments: (name) =>
    `Route one small payment through the ${name} channel each week.`,
};

const STEP_THREE_DEFAULT: StepFn = (name) =>
  `Make one qualifying action on ${name} each week, such as a deposit, a borrow, a swap or a vote.`;

// Step five, what to check before claiming anything: each kind of protocol
// publishes its rewards in a different place, and the step names the place —
// a vault points page, a borrow dashboard, an LP rewards page, a perps
// points page, a staking rewards page, a yield dashboard, or a rewards page.
// Anything else falls back to the protocol's own points page.
const STEP_FIVE: Record<string, StepFn> = {
  'Risk Curators': (name) =>
    `Before you withdraw, open ${name}'s vault points page and claim only from the link it publishes.`,
  'Onchain Capital Allocator': (name) =>
    `Before you withdraw, open ${name}'s vault points page and claim only from the link it publishes.`,
  'Liquidity Manager': (name) =>
    `Before you withdraw, open ${name}'s vault points page and claim only from the link it publishes.`,
  CDP: (name) =>
    `Before you withdraw, open ${name}'s borrow dashboard and check the loan health, then claim only from the link it publishes.`,
  'CDP Manager': (name) =>
    `Before you withdraw, open ${name}'s borrow dashboard and check the loan health, then claim only from the link it publishes.`,
  'Collateral Markets': (name) =>
    `Before you withdraw, open ${name}'s borrow dashboard and check the loan health, then claim only from the link it publishes.`,
  Lending: (name) =>
    `Before you withdraw, open ${name}'s borrow dashboard and check the loan health, then claim only from the link it publishes.`,
  'Uncollateralized Lending': (name) =>
    `Before you withdraw, open ${name}'s borrow dashboard and check the loan health, then claim only from the link it publishes.`,
  Dexs: (name) =>
    `Before you withdraw, open ${name}'s LP rewards page and claim only from the link it publishes.`,
  Yield: (name) =>
    `Before you withdraw, open ${name}'s LP rewards page and claim only from the link it publishes.`,
  'Yield Aggregator': (name) =>
    `Before you withdraw, open ${name}'s LP rewards page and claim only from the link it publishes.`,
  'Leveraged Farming': (name) =>
    `Before you withdraw, open ${name}'s LP rewards page and claim only from the link it publishes.`,
  Indexes: (name) =>
    `Before you withdraw, open ${name}'s LP rewards page and claim only from the link it publishes.`,
  Restaking: (name) =>
    `Before you withdraw, open ${name}'s staking rewards page and claim only from the link it publishes.`,
  'Staking Pool': (name) =>
    `Before you withdraw, open ${name}'s staking rewards page and claim only from the link it publishes.`,
  Derivatives: (name) =>
    `Before you withdraw, open ${name}'s perps points page and claim only from the link it publishes.`,
  'Interest Rate Derivatives': (name) =>
    `Before you withdraw, open ${name}'s perps points page and claim only from the link it publishes.`,
  'Basis Trading': (name) =>
    `Before you withdraw, open ${name}'s perps points page and claim only from the link it publishes.`,
  'Prediction Market': (name) =>
    `Before you withdraw, open ${name}'s rewards page and claim only from the link it publishes.`,
  RWA: (name) =>
    `Before you withdraw, open ${name}'s yield dashboard and claim only from the link it publishes.`,
  // Revision: every remaining category on the board names the place its
  // rewards are published, so no row falls back to the generic points page.
  'Anchor BTC': (name) =>
    `Before you withdraw, open ${name}'s BTC rewards page and claim only from the link it publishes.`,
  CeDeFi: (name) =>
    `Before you withdraw, open ${name}'s rewards page and claim only from the link it publishes.`,
  Chain: (name) =>
    `Before you withdraw, open ${name}'s rewards page and claim only from the link it publishes.`,
  'Cross Chain Bridge': (name) =>
    `Before you withdraw, open ${name}'s bridge rewards page and claim only from the link it publishes.`,
  'Crypto Card Issuer': (name) =>
    `Before you withdraw, open ${name}'s card rewards page and claim only from the link it publishes.`,
  'Decentralized BTC': (name) =>
    `Before you withdraw, open ${name}'s BTC rewards page and claim only from the link it publishes.`,
  'Dual-Token Stablecoin': (name) =>
    `Before you withdraw, open ${name}'s stable rewards page and claim only from the link it publishes.`,
  Farm: (name) =>
    `Before you withdraw, open ${name}'s farm rewards page and claim only from the link it publishes.`,
  'Governance Incentives': (name) =>
    `Before you withdraw, open ${name}'s incentives page and claim only from the link it publishes.`,
  Insurance: (name) =>
    `Before you withdraw, open ${name}'s rewards page and claim only from the link it publishes.`,
  'OTC Marketplace': (name) =>
    `Before you withdraw, open ${name}'s trading rewards page and claim only from the link it publishes.`,
  Payments: (name) =>
    `Before you withdraw, open ${name}'s rewards page and claim only from the link it publishes.`,
  'Stablecoin Wrapper': (name) =>
    `Before you withdraw, open ${name}'s stable rewards page and claim only from the link it publishes.`,
};

const STEP_FIVE_DEFAULT: StepFn = (_name) =>
  `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`;

// Steps one and six are the same for every row: start from a fresh wallet,
// and keep a log so the position can be repeated or unwound.
const FRESH_WALLET_STEP =
  'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. ' +
  'Cost: under $3 of gas for the first transaction. Time: 5 minutes.';

const FARM_LOG_STEP =
  'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it. ' +
  'Cost: nothing but the log. Time: 5 minutes.';

export function farmPlan(
  snapshot: Snapshot,
  p: SnapshotProtocol,
  scored: { implied: number; breakdown: ModelBreakdown; age: number | null },
): string[] {
  const amount = farmAmount(p.tvl_usd);
  const days = holdDays(scored.age);
  const gas = amount === 150 ? 8 : 4;
  const chain = p.chains[0] ?? 'Ethereum';
  const second =
    (STEP_TWO[p.category] ?? STEP_TWO_DEFAULT)(p.name, chain, amount) +
    ` Cost: $${amount} of capital and about $${gas} of gas. Time: 15 minutes to set up.`;
  const third =
    (STEP_THREE[p.category] ?? STEP_THREE_DEFAULT)(p.name, chain, amount) +
    ' Cost: about $2 of gas a week. Time: 10 minutes a week.';
  const fourth =
    `Hold the position for at least ${days} days so the activity is counted in more than one snapshot. ` +
    `Cost: the $${amount} stays in the position. Time: ${days} days.`;
  const fifth =
    (STEP_FIVE[p.category] ?? STEP_FIVE_DEFAULT)(p.name, chain, amount) +
    ' Cost: no fee to check, and never pay to claim. Time: 10 minutes.';
  return [FRESH_WALLET_STEP, second, third, fourth, fifth, FARM_LOG_STEP];
}

// Build the board: every watchlist protocol, then every other rankable one,
// scored and sorted by implied value, ranks assigned in order.
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const watchlisted = new Set(snapshot.watchlist);
  const picked: SnapshotProtocol[] = [];
  for (const slug of snapshot.watchlist) {
    const p = bySlug.get(slug);
    if (p !== undefined) picked.push(p);
  }
  for (const p of snapshot.protocols) {
    if (!watchlisted.has(p.slug) && isRankable(p)) picked.push(p);
  }
  const scored = picked.map((p) => {
    const result = scoreProtocol(snapshot, p);
    const row: BoardRow = {
      rank: 0,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      token_status: 'pre-token',
      age_days: result.age,
      implied_value_usd: result.implied,
      model: result.breakdown,
      farm_steps: farmPlan(snapshot, p, result),
    };
    return row;
  });
  scored.sort((a, b) => b.implied_value_usd - a.implied_value_usd);
  // A board that rises is a broken board: refuse it here, at the point of
  // construction, instead of leaving the validator to catch it later.
  for (let i = 1; i < scored.length; i++) {
    if (scored[i].implied_value_usd > scored[i - 1].implied_value_usd) {
      throw new Error(
        `board is not sorted at rank ${i + 1}: ${scored[i].slug} above ${scored[i - 1].slug}`,
      );
    }
  }
  scored.forEach((row, index) => {
    row.rank = index + 1;
  });
  return scored;
}

// Build the whole radar: the board plus the live side of the market — the
// protocols that already have a token, ranked by market cap, exchanges set
// aside, so a reader can compare a pre-token protocol against what launched
// tokens actually trade at.
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: Radar } {
  const board = buildBoard(snapshot);
  const watchlisted = new Set(snapshot.watchlist);
  const earlySize = board.filter((row) => !watchlisted.has(row.slug)).length;
  const live = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0))
    .slice(0, 24)
    .map((p): LiveRow => {
      return {
        slug: p.slug,
        name: p.name,
        category: p.category,
        chains: p.chains,
        tvl_usd: p.tvl_usd,
        mcap_usd: p.mcap_usd,
        change_7d: p.change_7d,
      };
    });
  return {
    board,
    radar: {
      watchlist_size: snapshot.watchlist.length,
      board_size: board.length,
      early_size: earlySize,
      live_size: live.length,
      live,
    },
  };
}

// Read and check a snapshot document. Anything malformed is a hard error:
// a board built from a half-parsed snapshot would be worse than no board.
export function parseSnapshot(data: unknown): Snapshot {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('snapshot must be a JSON object');
  }
  const doc = data as Record<string, unknown>;
  if (typeof doc['as_of'] !== 'string') throw new Error('snapshot.as_of must be a string');
  if (typeof doc['source'] !== 'string') throw new Error('snapshot.source must be a string');
  if (typeof doc['floor_usd'] !== 'number') throw new Error('snapshot.floor_usd must be a number');
  if (!Array.isArray(doc['protocols'])) throw new Error('snapshot.protocols must be an array');
  if (!Array.isArray(doc['watchlist'])) throw new Error('snapshot.watchlist must be an array');
  for (const raw of doc['protocols'] as unknown[]) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new Error('snapshot.protocols entries must be objects');
    }
    const p = raw as Record<string, unknown>;
    const text = ['slug', 'name', 'category'];
    for (const key of text) {
      if (typeof p[key] !== 'string') throw new Error(`protocol.${key} must be a string`);
    }
    if (!Array.isArray(p['chains']) || p['chains'].some((c) => typeof c !== 'string')) {
      throw new Error('protocol.chains must be an array of strings');
    }
    if (typeof p['tvl_usd'] !== 'number') throw new Error('protocol.tvl_usd must be a number');
    const nullableNumber = ['change_7d', 'mcap_usd'];
    for (const key of nullableNumber) {
      if (p[key] !== null && typeof p[key] !== 'number') {
        throw new Error(`protocol.${key} must be a number or null`);
      }
    }
    const nullableText = ['listed_at', 'gecko_id', 'symbol'];
    for (const key of nullableText) {
      if (p[key] !== null && typeof p[key] !== 'string') {
        throw new Error(`protocol.${key} must be a string or null`);
      }
    }
  }
  return data as Snapshot;
}

// Validate a finished board against the snapshot it came from. Returns a
// human-readable problem, or null when the board is sound. The entrypoint
// refuses to write anything when this is not null.
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100) return `board has ${board.length} rows, fewer than 100`;
  const seen = new Set<string>();
  for (const row of board) {
    if (seen.has(row.slug)) return `duplicate slug on the board: ${row.slug}`;
    seen.add(row.slug);
  }
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist protocol missing from the board: ${slug}`;
  }
  for (const p of snapshot.protocols) {
    if (!snapshot.watchlist.includes(p.slug) && isRankable(p) && !seen.has(p.slug)) {
      return `rankable protocol missing from the board: ${p.slug}`;
    }
  }
  for (let i = 0; i < board.length; i++) {
    if (board[i].rank !== i + 1) {
      return `rank ${board[i].rank} sits at position ${i + 1}, ranks must run 1..${board.length}`;
    }
    if (i > 0 && board[i].implied_value_usd > board[i - 1].implied_value_usd) {
      return `implied value rises at rank ${board[i].rank}, the board must not increase`;
    }
    if (!Number.isInteger(board[i].implied_value_usd) || board[i].implied_value_usd <= 0) {
      return `row ${board[i].slug} has no positive whole implied value`;
    }
  }
  for (const row of board) {
    if (!Array.isArray(row.farm_steps) || row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `row ${row.slug} has ${row.farm_steps?.length ?? 0} farm steps, need 3 to 12`;
    }
    for (const step of row.farm_steps) {
      const trimmed = step.trim();
      if (trimmed.length < 20 || trimmed.length > 600) {
        return `row ${row.slug} has a farm step of ${trimmed.length} characters, need 20 to 600`;
      }
      if (!trimmed.includes('Cost:') || !trimmed.includes('Time:')) {
        return `row ${row.slug} has a farm step without a cost and a time`;
      }
    }
  }
  return null;
}

// The dashboard's data file: the snapshot's facts, the model's constants,
// the board in its slim display form, and the live list, as one script the
// page can load. The key order here is the file's order.
//
// The payload also carries a calibration table: for every category on the
// board that already has launched tokens, the median market cap and the
// median market-cap-per-dollar-of-TVL of those live tokens, next to the
// model multiple the board credits the category. It is display-only —
// nothing in it feeds back into the ranking — and it is computed from the
// full live set in the snapshot, not from the top-24 the live tab shows.
export interface CalibrationRow {
  category: string;
  live_n: number;
  median_mcap_usd: number;
  median_mcap_tvl: number;
  model_multiple: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function buildCalibration(snapshot: Snapshot, board: BoardRow[]): CalibrationRow[] {
  const boardCategories = new Set(board.map((row) => row.category));
  const ratios = new Map<string, number[]>();
  const mcaps = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.category === 'CEX' || p.tvl_usd <= 0) continue;
    if (!boardCategories.has(p.category)) continue;
    const r = ratios.get(p.category) ?? [];
    r.push(p.mcap_usd / p.tvl_usd);
    ratios.set(p.category, r);
    const m = mcaps.get(p.category) ?? [];
    m.push(p.mcap_usd);
    mcaps.set(p.category, m);
  }
  const rows: CalibrationRow[] = [];
  for (const category of [...ratios.keys()].sort()) {
    const ratioList = ratios.get(category) as number[];
    const mcapList = mcaps.get(category) as number[];
    rows.push({
      category,
      live_n: ratioList.length,
      median_mcap_usd: Math.round(median(mcapList)),
      median_mcap_tvl: round6(median(ratioList)),
      model_multiple: categoryMultiple(category),
    });
  }
  rows.sort((a, b) => b.live_n - a.live_n || (a.category < b.category ? -1 : 1));
  return rows;
}

export function dataScript(snapshot: Snapshot, board: BoardRow[], radar: Radar): string {
  const watchlisted = new Set(snapshot.watchlist);
  const rows = board.map((row) => {
    return {
      rank: row.rank,
      slug: row.slug,
      name: row.name,
      category: row.category,
      chains: row.chains,
      tvl_usd: row.tvl_usd,
      change_7d: row.change_7d,
      mcap_usd: row.mcap_usd,
      listed_at: row.listed_at,
      age_days: row.age_days,
      implied_value_usd: row.implied_value_usd,
      category_multiple: row.model.category_multiple,
      growth_multiplier: row.model.growth_multiplier,
      maturity_multiplier: row.model.maturity_multiplier,
      chain_multiplier: row.model.chain_multiplier,
      watchlist: watchlisted.has(row.slug),
    };
  });
  const payload = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: MODEL,
    model_version: MODEL_VERSION,
    watchlist_size: radar.watchlist_size,
    board_size: radar.board_size,
    early_size: radar.early_size,
    live_size: radar.live_size,
    calibration: buildCalibration(snapshot, board),
    rows,
    live: radar.live,
  };
  return `window.RADAR=${JSON.stringify(payload)};\n`;
}
