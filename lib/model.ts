// Token Radar: the model that turns one sealed DefiLlama snapshot into a ranked board of
// protocols that record no token yet, what a launch would be worth, and how to farm each one.
//
// The board is built in three moves, all from the snapshot's own figures:
//
//   1. Coverage. Every watchlist slug is on the board (the floor, never the ceiling), plus every
//      other protocol that records no token and is not itself a product of a token that already
//      trades (no wrapped/staked names, no bridge or staking-wrapper categories, no CEX, no
//      versioned pools of another protocol).
//   2. Value. impliedValue() below prices each protocol as
//        tvl_usd x categoryMultiple x growthFactor x ageFactor x breadthFactor
//      — a multiple of TVL set by the protocol's category, tilted by its 7-day TVL momentum,
//      by how many years it has run with no token, and by how many chains it runs on.
//      No protocol is ever priced or ranked by name: one function scores every row.
//   3. Plans. farmSteps() derives each protocol's steps from its own record — its category's
//      core action, its main chain, a capital tier from its TVL and a holding window from
//      its age — each step carrying an estimated cost and time.
//
// Protocols that already record a token never enter the ranking: liveRows() keeps the largest
// of them apart, at the market's own market cap, for the dashboard's "Already launched" view.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

// ------------------------------------------------------------------ the value model

/**
 * What a launched token tends to be worth against the TVL of the protocol behind it, by
 * category: trading venues re-rate highest, bridges and wrappers lowest. A category the table
 * does not name, or none, takes DEFAULT_MULTIPLE.
 */
export const CATEGORY_MULTIPLE: Record<string, number> = {
  'Dexs': 1.0,
  'Derivatives': 1.05,
  'Options': 0.9,
  'Interest Rate Derivatives': 0.85,
  'Synthetics': 0.85,
  'Lending': 0.85,
  'Uncollateralized Lending': 0.75,
  'Collateral Markets': 0.75,
  'CDP': 0.8,
  'CDP Manager': 0.8,
  'Payments': 0.8,
  'Restaking': 0.75,
  'Onchain Capital Allocator': 0.7,
  'Risk Curators': 0.7,
  'Liquid Staking': 0.7,
  'NFT Marketplace': 0.7,
  'Privacy': 0.7,
  'Crypto Card Issuer': 0.7,
  'OTC Marketplace': 0.7,
  'Yield Aggregator': 0.65,
  'Staking Pool': 0.65,
  'CeDeFi': 0.65,
  'Collateral Management': 0.65,
  'Yield': 0.6,
  'Liquidity Manager': 0.6,
  'Basis Trading': 0.6,
  'Indexes': 0.6,
  'Insurance': 0.6,
  'DOR': 0.6,
  'Launchpad': 0.9,
  'Prediction Market': 0.95,
  'AI Agents': 0.9,
  'Decentralized AI': 0.9,
  'Leveraged Farming': 0.55,
  'Farm': 0.55,
  'RWA': 0.55,
  'Stablecoin Issuer': 0.55,
  'Algo-Stables': 0.5,
  'Dual-Token Stablecoin': 0.6,
  'Options Vault': 0.7,
  'Token Locker': 0.5,
  'Governance Incentives': 0.5,
  'Reserve Currency': 0.5,
  'Bridge': 0.45,
  'Cross Chain Bridge': 0.45,
  'Canonical Bridge': 0.4,
};
export const DEFAULT_MULTIPLE = 0.62;

/** The model's tilts, named so the dashboard can state them and a reader can re-run them. */
export const TILTS = {
  growth_floor_pct: -50, // 7-day TVL change is clamped into [floor, cap] before it tilts value
  growth_cap_pct: 100,
  growth_weight: 0.6, // +100% in a week multiplies value by 1.6; -50% by 0.7
  age_base: 0.72, // a protocol listed today still earns 72% of its multiple
  age_span: 0.28, // the remaining 28% is earned over AGE_FULL_YEARS years with no token
  age_full_years: 5,
  unknown_age_years: 1.5, // a protocol with no listed_at is priced as a year and a half old
  breadth_step: 0.025, // each chain past the first adds 2.5%, up to BREADTH_MAX_EXTRA chains
  breadth_max_extra: 6,
};

const DAY_MS = 86_400_000;

/** Whole days from listed_at to the snapshot's as_of; null when either date is missing or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The four factors and the implied value they give one protocol. */
export interface ValueBreakdown {
  category_multiple: number;
  growth_factor: number;
  age_factor: number;
  breadth_factor: number;
  implied_value_usd: number;
}

/**
 * The radar's price for one pre-token protocol: what its token would be worth if the record
 * stayed as it is. TVL is the anchor; the category says what a launched peer's token tends to
 * fetch against TVL; the 7-day change tilts for momentum; the years run with no token tilt
 * for a track record that has had time to be worth launching; the chain count tilts for reach.
 * The same function prices every protocol on the board — no name is ever special-cased.
 */
export function impliedValue(p: SnapshotProtocol, asOf: string): ValueBreakdown {
  const categoryMultiple = CATEGORY_MULTIPLE[p.category ?? ''] ?? DEFAULT_MULTIPLE;
  const rawGrowth = typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : 0;
  const growthPct = Math.min(TILTS.growth_cap_pct, Math.max(TILTS.growth_floor_pct, rawGrowth));
  const growthFactor = 1 + (growthPct / 100) * TILTS.growth_weight;
  const days = ageDays(asOf, p.listed_at);
  const years = days === null ? TILTS.unknown_age_years : days / 365.25;
  const ageFactor = TILTS.age_base + TILTS.age_span * (Math.min(years, TILTS.age_full_years) / TILTS.age_full_years);
  const breadthFactor = 1 + TILTS.breadth_step * Math.min(Math.max(p.chains.length - 1, 0), TILTS.breadth_max_extra);
  const implied = Math.max(1, Math.round(p.tvl_usd * categoryMultiple * growthFactor * ageFactor * breadthFactor));
  return {
    category_multiple: categoryMultiple,
    growth_factor: round3(growthFactor),
    age_factor: round3(ageFactor),
    breadth_factor: round3(breadthFactor),
    implied_value_usd: implied,
  };
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

// ------------------------------------------------------------------ coverage

/** Whether a protocol records no token at all: no market cap, no CoinGecko id, no symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that are a product of another protocol's asset, not a launch of their own. */
const PRODUCT_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'Anchor BTC',
  'Decentralized BTC',
  'Stablecoin Wrapper',
  'CEX',
  'Chain',
]);

/** A whole word wrapped, staked or staking in a name marks a product of a token that trades. */
const PRODUCT_NAME = /(^|\s)(wrapped|staked|staking)(\s|$)/i;

/** Names that begin with an exchange's name are that exchange's product, not a new launch. */
const EXCHANGE_NAME = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/**
 * Whether a pre-token protocol belongs on the ranked board beside the watchlist: it records no
 * token, and it is not a wrapped, staked or bridged product of one that already trades — the
 * same exclusions the house's watchlist states, applied below its floor.
 */
export function isBoardCandidate(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !PRODUCT_CATEGORIES.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !PRODUCT_NAME.test(p.name) &&
    !EXCHANGE_NAME.test(p.name)
  );
}

// ------------------------------------------------------------------ farm plans

/** A tiny deterministic hash of a slug, so plan phrasing varies by protocol, never by run. */
function slugHash(slug: string): number {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return h;
}

/** The chain a plan works on: the first the protocol names, or Ethereum when it names none. */
function mainChain(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'Ethereum';
}

/** The capital one farm position needs, tiered by the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 250_000_000) return 150;
  if (p.tvl_usd >= 50_000_000) return 100;
  if (p.tvl_usd >= 10_000_000) return 50;
  return 25;
}

/** A realistic gas figure for one transaction on the protocol's main chain. */
function gasFor(chain: string): string {
  if (chain === 'Ethereum') return 'about $10 of gas';
  if (chain === 'Solana' || chain === 'Base' || chain === 'Arbitrum' || chain === 'Optimism') return 'under $1 of gas';
  if (chain === 'BSC' || chain === 'Polygon' || chain === 'Avalanche') return 'about $1 of gas';
  return 'about $2 of gas';
}

/** How long a position should be held, from the protocol's age: younger, longer to qualify. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 75;
  if (age < 365) return 60;
  if (age < 730) return 45;
  return 30;
}

/** The category's core action and its follow-up, in words a farmer can follow. */
function actionsFor(p: SnapshotProtocol): { core: string; follow: string } {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  const chain = mainChain(p);
  const cap = capitalFor(p);
  if (c.includes('lend') || c.includes('collateral'))
    return {
      core: `Supply $${cap} of USDC as collateral in ${n} on ${chain} so the lending market counts your wallet as a supplier.`,
      follow: `Borrow about $${Math.round(cap / 3)} of ETH against the position and re-supply it once, then leave the loop untouched so your health factor stays comfortable.`,
    };
  if (c.includes('cdp'))
    return {
      core: `Deposit $${cap} of ETH as collateral in ${n} on ${chain} and mint a small amount of its stablecoin against it.`,
      follow: `Hold the minted stablecoin in the same wallet and repay a slice after a week, so the vault records borrowing activity in two separate weeks.`,
    };
  if (c.includes('dex') || c.includes('liquidity'))
    return {
      core: `Provide $${cap} split between USDC and ETH in ${n}'s busiest pool on ${chain} and keep the LP position in your wallet.`,
      follow: `Make two small swaps through ${n} on different days, one each way, so the wallet shows trading volume as well as liquidity.`,
    };
  if (c.includes('derivative') || c.includes('option') || c.includes('synthetic'))
    return {
      core: `Deposit $${cap} of USDC as margin in ${n} on ${chain} and open one small position you are happy to hold for a week.`,
      follow: `Close the position after at least seven days and open a second, smaller one, so your history spans two trading weeks.`,
    };
  if (c.includes('bridge'))
    return {
      core: `Bridge $${cap} of USDC from Ethereum to ${chain} through ${n}, then use the bridged funds in one app on the far side.`,
      follow: `Bridge a second, smaller amount back a week later, so the wallet shows round-trip use rather than a single hop.`,
    };
  if (c.includes('stak') || c.includes('restak'))
    return {
      core: `Stake $${cap} of the chain's staking asset through ${n} and keep the receipt token in the same wallet.`,
      follow: `Claim or compound the staking rewards once, after the first reward period, and keep the receipt rather than selling it.`,
    };
  if (c.includes('curator') || c.includes('allocator') || c.includes('yield'))
    return {
      core: `Deposit $${cap} of USDC into a ${n} vault on ${chain} and keep the vault shares in your wallet.`,
      follow: `Add a second deposit of about $${Math.round(cap / 2)} after two weeks, so the position grows in steps instead of landing in one transaction.`,
    };
  if (c.includes('rwa') || c.includes('stable') || c.includes('algo'))
    return {
      core: `Mint or deposit $${cap} of the yield-bearing asset ${n} issues on ${chain} and hold it in your wallet.`,
      follow: `Redeem a tenth of the position after a month and mint it back a week later, so the wallet shows both sides of the product.`,
    };
  if (c.includes('prediction'))
    return {
      core: `Fund $${cap} on ${n} and take one position in its most liquid market.`,
      follow: `Take a second position in a different market a week later, and let at least one position settle before you withdraw.`,
    };
  if (c.includes('insurance'))
    return {
      core: `Buy $${cap} of cover from ${n} on ${chain} for a position you actually hold, and keep the policy NFT in your wallet.`,
      follow: `Renew or extend the cover once before it lapses, so the wallet shows two separate policy periods.`,
    };
  if (c.includes('launchpad'))
    return {
      core: `Register the wallet with ${n} on ${chain} and complete its participation steps for the next sale, staking the $${cap} minimum if it asks for one.`,
      follow: `Take part in one sale or claim round, however small, so the wallet appears in its participant history.`,
    };
  return {
    core: `Deposit $${cap} of USDC into ${n} on ${chain} through its own app and keep the position open in your wallet.`,
    follow: `Repeat a smaller deposit of about $${Math.round(cap / 2)} two weeks later, so the wallet shows returning use rather than one visit.`,
  };
}

/** One step as a single string: the action, then what it costs and how long it takes. */
function step(text: string, cost: string, time: string): string {
  let s = `${text} Cost: ${cost}. Time: ${time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Keep the position open and check the protocol's own page weekly.`;
  return s;
}

/**
 * A protocol's farm plan: six steps derived from its own record. The wallet and funding steps
 * name its main chain; the two middle steps are its category's actions at a capital tier set
 * by its TVL; the holding window comes from its age; the wording rotates deterministically
 * by slug so no two protocols read as the same slogan.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = mainChain(p);
  const cap = capitalFor(p);
  const gas = gasFor(chain);
  const hold = holdDaysFor(age);
  const pick = slugHash(p.slug) % 2;
  const { core, follow } = actionsFor(p);
  const walletLine =
    pick === 0
      ? `Create a fresh wallet for ${p.name} alone, back up its seed phrase offline, and never mix it with your main funds.`
      : `Use a dedicated wallet for ${p.name} that holds only what you plan to farm, and keep its seed phrase written down offline.`;
  const fundLine =
    chain === 'Ethereum'
      ? `Fund the wallet with about $${cap + 25} of USDC and a little ETH on Ethereum, bought or withdrawn to the wallet's own address.`
      : `Bridge about $${cap + 25} of USDC from Ethereum to ${chain} with the chain's canonical bridge, and keep a little of ${chain}'s gas token in the wallet.`;
  const weeklyLine =
    pick === 0
      ? `Return once a week to make one small qualifying action in ${p.name} — a deposit, a claim, a vote or a rebalance — and open its own points or rewards page to confirm the activity registered.`
      : `Check ${p.name}'s own points or rewards page once a week and make one small action — a claim, a vote or a top-up — so the wallet is active in several weekly snapshots, not one.`;
  return [
    step(walletLine, 'nothing but the wallet itself', '10 minutes'),
    step(fundLine, `$${cap + 25} of capital moved, plus ${gas}`, '15 minutes'),
    step(core, `$${cap} of capital in the position, plus ${gas}`, '15 minutes to set up'),
    step(follow, 'about $2 of gas a week while it runs', '10 minutes a week'),
    step(weeklyLine, 'about $2 of gas a week', '10 minutes a week'),
    step(
      `Hold the main position for at least ${hold} days, then log every transaction hash, date and balance in a farm log before you unwind, so the whole campaign can be repeated or closed out cleanly.`,
      `the $${cap} stays in the position until you unwind`,
      `${hold} days, then 10 minutes to log`,
    ),
  ];
}

// ------------------------------------------------------------------ the board

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  on_watchlist: boolean;
  implied_value_usd: number;
  model: ValueBreakdown;
  farm_steps: string[];
}

/** A protocol whose token already trades: the market's own figures, never ranked. */
export interface LiveRow {
  slug: string;
  name: string;
  symbol: string | null;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
}

/** How many already-launched protocols the dashboard's comparison view carries. */
export const LIVE_ROWS = 24;

/** The board: every watchlist protocol plus every other board candidate, priced and ranked. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const watch = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const p of snapshot.protocols) {
    if (watch.has(p.slug) || isBoardCandidate(p)) chosen.set(p.slug, p);
  }
  const scored = [...chosen.values()].map((p) => ({ p, value: impliedValue(p, snapshot.as_of), age: ageDays(snapshot.as_of, p.listed_at) }));
  scored.sort(
    (a, b) =>
      b.value.implied_value_usd - a.value.implied_value_usd ||
      b.p.tvl_usd - a.p.tvl_usd ||
      (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0),
  );
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    age_days: s.age,
    on_watchlist: watch.has(s.p.slug),
    implied_value_usd: s.value.implied_value_usd,
    model: s.value,
    farm_steps: farmSteps(s.p, s.age),
  }));
}

/** The largest already-launched protocols by market cap, kept apart from the ranking. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      symbol: p.symbol,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd ?? 0,
      change_7d: p.change_7d,
    }));
}

/** Everything the dashboard renders: the ranked board, the live set, and the model stated. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  category_multiple: Record<string, number>;
  default_multiple: number;
  tilts: typeof TILTS;
  rows: BoardRow[];
  live: LiveRow[];
}

/** Board and dashboard data from one snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const live = liveRows(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !r.on_watchlist).length,
    live_size: live.length,
    category_multiple: CATEGORY_MULTIPLE,
    default_multiple: DEFAULT_MULTIPLE,
    tilts: TILTS,
    rows: board,
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape this model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not an object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string' || o.source.length === 0) throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist');
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: str(p.category),
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: num(p.change_7d),
      mcap_usd: num(p.mcap_usd),
      listed_at: str(p.listed_at),
      gecko_id: str(p.gecko_id),
      symbol: str(p.symbol),
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/**
 * Why a board is not one the gate will take, or null. Mirrors the gate's own rows: coverage of
 * the watchlist, ranks exactly 1..N, implied value never rising as rank ascends and never all
 * equal, farm steps of 3..12 strings of 20..600 trimmed characters, slugs the snapshot knows.
 */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (const r of board) {
    if (!known.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
    if (seen.has(r.slug)) return `${r.slug} appears twice`;
    seen.add(r.slug);
    if (r.name.trim().length === 0) return `${r.slug} has an empty name`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} trimmed characters`;
    }
  }
  const missing = snapshot.watchlist.filter((s) => !seen.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 0; i < byRank.length; i++) {
    if (byRank[i]!.rank !== i + 1) return `rank ${i + 1} is ${byRank[i]!.rank}`;
    if (i > 0 && byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  }
  if (board.length >= 2 && byRank[0]!.implied_value_usd === byRank[byRank.length - 1]!.implied_value_usd) {
    return 'every row shares one implied value: a board that ranks nothing by value is not a ranking';
  }
  return null;
}

/** The dashboard's data as one script: no fetch, no network, the page reads window.RADAR. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
