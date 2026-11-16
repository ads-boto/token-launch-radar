// Token Radar's launch-value model.
//
// One sealed DefiLlama snapshot in, one ranked board out. The board is a claim about what a protocol's
// token could be worth if it launched, built only from the snapshot's own figures: TVL, the seven-day
// change, how long the protocol has run while recording no token, its sector and its chain reach.
// Nothing here knows any protocol by name; the same arithmetic scores every row.
//
// Units. TVL, market cap and implied value are whole US dollars. Change is per cent. Age is whole days.
// The implied value is a launch-value estimate, an FDV in dollars, never a price per token: the snapshot
// records no supply, so a per-token price would be invented rather than derived.

/** The ten fields the sealed snapshot carries for one protocol, and no others. */
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

/** The whole sealed snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants: the whole of its opinion, stated in the page and changeable in one place. */
export interface ModelConstants {
  default_multiple: number;
  growth_elasticity: number;
  growth_floor: number;
  growth_cap: number;
  age_floor: number;
  age_range: number;
  age_scale_days: number;
  unknown_age_days: number;
  chain_step: number;
  chain_cap: number;
}

export const MODEL: ModelConstants = {
  default_multiple: 0.24,
  growth_elasticity: 0.28,
  growth_floor: -50,
  growth_cap: 100,
  age_floor: 0.72,
  age_range: 0.42,
  age_scale_days: 640,
  unknown_age_days: 365,
  chain_step: 0.025,
  chain_cap: 0.1,
};

/** The model's public label: the dashboard prints it beside every value it explains. */
export const MODEL_VERSION = 'launch-value v2';

/** FDV / TVL benchmarks by DefiLlama sector. A sector, never a protocol name, picks the multiple. */
const SECTOR_MULTIPLE: Record<string, number> = {
  Dexs: 0.34,
  Lending: 0.3,
  CDP: 0.28,
  'CDP Manager': 0.28,
  'Collateral Management': 0.27,
  'Collateral Markets': 0.3,
  Derivatives: 0.4,
  'Interest Rate Derivatives': 0.26,
  Options: 0.3,
  'Options Vault': 0.22,
  Synthetics: 0.28,
  RWA: 0.48,
  Launchpad: 0.55,
  'Prediction Market': 0.5,
  Restaking: 0.32,
  'Risk Curators': 0.14,
  'Onchain Capital Allocator': 0.14,
  'Liquidity Manager': 0.18,
  Yield: 0.22,
  'Yield Aggregator': 0.22,
  'Leveraged Farming': 0.2,
  Farm: 0.2,
  Bridge: 0.24,
  'Cross Chain Bridge': 0.24,
  'Canonical Bridge': 0.2,
  'Liquid Staking': 0.25,
  'Liquid Restaking': 0.28,
  'Restaked BTC': 0.26,
  'Stablecoin Issuer': 0.3,
  'Algo-Stables': 0.22,
  'Dual-Token Stablecoin': 0.22,
  Insurance: 0.2,
  Indexes: 0.25,
  'Decentralized AI': 0.45,
  'AI Agents': 0.45,
  Privacy: 0.35,
  Payments: 0.3,
  'OTC Marketplace': 0.24,
  'Token Locker': 0.16,
  'NFT Marketplace': 0.2,
  'Basis Trading': 0.18,
  'Anchor BTC': 0.3,
  'Decentralized BTC': 0.34,
  'Uncollateralized Lending': 0.24,
  'CeDeFi': 0.18,
  'Crypto Card Issuer': 0.22,
  'DOR': 0.2,
  'Reserve Currency': 0.25,
  'Stablecoin Wrapper': 0.2,
};

/** Sectors the board leaves out of the launch radar, because they are a product of a token that trades. */
const NOT_A_LAUNCH: ReadonlySet<string> = new Set([
  'CEX',
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'Stablecoin Wrapper',
  'Dual-Token Stablecoin',
]);

/** A name ending in a version marker is a pool of another protocol, not a launch candidate. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whole words that mark a wrapped or staked product of an asset that already trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Exchange names a product starts with when it is an exchange's own wrapper. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;

const DAY_MS = 86_400_000;

/** A finite number, else the fallback. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function round4(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}

/** Whole days from the snapshot's date back to the day DefiLlama began tracking the protocol. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const now = Date.parse(`${asOf}T00:00:00Z`);
  const then = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(now) || !Number.isFinite(then)) return null;
  return Math.max(0, Math.floor((now - then) / DAY_MS));
}

/** The sector's FDV / TVL benchmark. */
export function sectorMultiple(category: string | null): number {
  if (category !== null && SECTOR_MULTIPLE[category] !== undefined) return SECTOR_MULTIPLE[category]!;
  return MODEL.default_multiple;
}

/** Seven-day change, clipped so one parabolic week cannot own the board. */
export function clippedGrowth(change: number | null, model: ModelConstants = MODEL): number {
  return clamp(finite(change, 0), model.growth_floor, model.growth_cap);
}

/** The growth multiplier: exponential in the clipped seven-day change, symmetric around flat. */
export function growthMultiplier(change: number | null, model: ModelConstants = MODEL): number {
  return Math.exp((model.growth_elasticity * clippedGrowth(change, model)) / 100);
}

/** The age multiplier: a protocol that has run for years without a token earns more than a new one. */
export function ageMultiplier(age: number | null, model: ModelConstants = MODEL): number {
  const days = age === null ? model.unknown_age_days : Math.max(0, age);
  return model.age_floor + model.age_range * (1 - Math.exp(-days / model.age_scale_days));
}

/** The chain-reach multiplier: a small premium for counting TVL on more than one chain. */
export function chainMultiplier(chains: string[], model: ModelConstants = MODEL): number {
  return 1 + Math.min(model.chain_cap, model.chain_step * Math.max(0, chains.length - 1));
}

export interface ValueBreakdown {
  implied: number;
  base_usd: number;
  sector_multiple: number;
  growth_pct: number;
  growth_multiplier: number;
  age_multiplier: number;
  chain_multiplier: number;
  age_days: number | null;
  fdv_tvl_multiple: number;
}

/** The whole model for one protocol: three multipliers over a sector multiple of TVL. */
export function impliedValue(protocol: SnapshotProtocol, asOf: string, model: ModelConstants = MODEL): ValueBreakdown {
  const age = ageDays(asOf, protocol.listed_at);
  const sector = sectorMultiple(protocol.category);
  const growth = clippedGrowth(protocol.change_7d, model);
  const growthMult = growthMultiplier(protocol.change_7d, model);
  const ageMult = ageMultiplier(age, model);
  const chainMult = chainMultiplier(protocol.chains, model);
  const implied = Math.max(1_000, Math.round(protocol.tvl_usd * sector * growthMult * ageMult * chainMult));
  return {
    implied,
    base_usd: Math.round(protocol.tvl_usd * sector),
    sector_multiple: sector,
    growth_pct: round4(growth),
    growth_multiplier: round4(growthMult),
    age_multiplier: round4(ageMult),
    chain_multiplier: round4(chainMult),
    age_days: age,
    fdv_tvl_multiple: round4(implied / protocol.tvl_usd),
  };
}

/** Whether the record shows no token at all. */
export function isPreToken(protocol: SnapshotProtocol): boolean {
  return protocol.mcap_usd === null && protocol.gecko_id === null && protocol.symbol === null;
}

/**
 * Whether a protocol belongs on the launch radar: no token recorded, and not a wrapped, staked, bridged,
 * exchange-issued or versioned product of an asset that already trades.
 */
export function isLaunchCandidate(protocol: SnapshotProtocol): boolean {
  if (!isPreToken(protocol)) return false;
  if (protocol.category !== null && NOT_A_LAUNCH.has(protocol.category)) return false;
  if (VERSIONED.test(protocol.name)) return false;
  if (WRAPPED_WORD.test(protocol.name)) return false;
  if (EXCHANGE_PREFIX.test(protocol.name)) return false;
  return true;
}

/** A 0 to 100 reading of how loud the launch signal is, before any dollar value is applied. */
export function signalScore(protocol: SnapshotProtocol, asOf: string): number {
  const tvl = Math.max(1, protocol.tvl_usd);
  const tvlPart = clamp(((Math.log10(tvl) - Math.log10(5e6)) / (Math.log10(5e9) - Math.log10(5e6))) * 100, 0, 100);
  const growthPart = clamp((clippedGrowth(protocol.change_7d) + 50) / 1.5, 0, 100);
  const age = ageDays(asOf, protocol.listed_at);
  const agePart = clamp(((age === null ? 365 : age) / 1095) * 100, 0, 100);
  const chainPart = clamp(((protocol.chains.length - 1) / 5) * 100, 0, 100);
  return Math.round(0.46 * tvlPart + 0.24 * growthPart + 0.2 * agePart + 0.1 * chainPart);
}

export type RiskBand = 'low' | 'medium' | 'high';

/** A coarse risk band from age, week-to-week swing, size and how opaque the sector's value is. */
export function riskBand(protocol: SnapshotProtocol, asOf: string): RiskBand {
  const age = ageDays(asOf, protocol.listed_at);
  const swing = Math.abs(finite(protocol.change_7d, 0));
  let points = 0;
  if (age === null || age < 180) points += 2;
  else if (age < 365) points += 1;
  if (swing > 25) points += 2;
  else if (swing > 10) points += 1;
  if (protocol.tvl_usd < 100_000_000) points += 1;
  if (protocol.category === 'Risk Curators' || protocol.category === 'Onchain Capital Allocator') points += 1;
  if (protocol.chains.length <= 1) points += 1;
  return points >= 4 ? 'high' : points >= 2 ? 'medium' : 'low';
}

/** One row of board.json. Extra keys are allowed and the page uses them; the gate reads the core ones. */
export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  fdv_tvl_multiple: number;
  signal: number;
  risk: RiskBand;
  base_usd: number;
  sector_multiple: number;
  growth_multiplier: number;
  age_multiplier: number;
  chain_multiplier: number;
  farm_steps: string[];
}

/** The dashboard's row: the board row, with the model's inputs already unwound for the detail card. */
export type RadarRow = BoardRow;

/** A protocol whose token already trades: shown as the market's own value, never scored as a launch. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  mcap_tvl_multiple: number | null;
}

export interface GroupStat {
  name: string;
  count: number;
  implied_usd: number;
  tvl_usd: number;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  total_implied_usd: number;
  rows: RadarRow[];
  live: LiveRow[];
  sectors: GroupStat[];
  networks: GroupStat[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/** How many launch candidates below the watchlist floor the early radar adds. */
export const EARLY_ROWS = 260;

/** How many live-token protocols the market view carries. */
export const LIVE_ROWS = 48;

/** The first chain a protocol names, or a neutral phrase. */
function primaryChain(protocol: SnapshotProtocol): string {
  return protocol.chains.length > 0 ? protocol.chains[0]! : 'its main chain';
}

/** How much capital one position needs, scaled by the protocol's own size. */
function capitalFor(protocol: SnapshotProtocol): number {
  if (protocol.tvl_usd >= 5_000_000_000) return 250;
  if (protocol.tvl_usd >= 1_000_000_000) return 150;
  if (protocol.tvl_usd >= 100_000_000) return 100;
  return 50;
}

function gasFor(protocol: SnapshotProtocol): number {
  if (protocol.tvl_usd >= 1_000_000_000) return 8;
  if (protocol.tvl_usd >= 100_000_000) return 6;
  return 4;
}

/** How long to keep the position open: younger protocols need a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  if (age < 730) return 30;
  return 21;
}

/** The sector's one concrete position, in the words a farmer can follow. */
function actionFor(protocol: SnapshotProtocol, capital: number, chain: string): string {
  const sector = (protocol.category ?? '').toLowerCase();
  const name = protocol.name;
  if (sector.includes('lend') || sector.includes('cdp') || sector.includes('collateral')) {
    return `Supply $${capital} of USDC on ${name}'s ${chain} market, borrow a small amount against it, and repay on schedule.`;
  }
  if (sector.includes('dex') || sector.includes('yield') || sector.includes('farm') || sector.includes('liquidity')) {
    return `Add $${capital} of liquidity to ${name}'s deepest pool on ${chain} and stake the LP receipt if the protocol offers it.`;
  }
  if (sector.includes('perpetual') || sector.includes('derivative') || sector.includes('synthetic') || sector.includes('option')) {
    return `Deposit $${capital} of USDC as margin on ${name} on ${chain} and open one small, collateralised position with a stop.`;
  }
  if (sector.includes('restak') || sector.includes('staking')) {
    return `Restake $${capital} of the chain's liquid staking token through ${name} on ${chain} and keep the receipt token.`;
  }
  if (sector.includes('rwa') || sector.includes('real world')) {
    return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold the receipt in the fresh wallet.`;
  }
  if (sector.includes('launchpad')) {
    return `Fund $${capital} on ${name} on ${chain}, take part in one launch, and keep the position for the qualifying window.`;
  }
  if (sector.includes('prediction')) {
    return `Fund $${capital} on ${name} on ${chain} and place one position in a liquid market, then leave it open.`;
  }
  if (sector.includes('insurance')) {
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active through the qualifying window.`;
  }
  if (sector.includes('privacy')) {
    return `Shield $${capital} through ${name} on ${chain} and use the private balance for one qualifying action.`;
  }
  if (sector.includes('ai')) {
    return `Deposit $${capital} into ${name}'s ${chain} product and use the service once a week so the wallet stays active.`;
  }
  if (sector.includes('stable') || sector.includes('reserve')) {
    return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and keep the receipt.`;
  }
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The weekly qualifying action, by sector. */
function cadenceFor(protocol: SnapshotProtocol): string {
  const sector = (protocol.category ?? '').toLowerCase();
  if (sector.includes('lend') || sector.includes('cdp') || sector.includes('collateral')) {
    return `Each week, borrow a little more, repay part of the loan, or supply a second asset so the position stays active.`;
  }
  if (sector.includes('dex') || sector.includes('yield') || sector.includes('liquidity')) {
    return `Each week, rebalance or add a small amount of liquidity, and vote on a pool if the protocol has governance.`;
  }
  if (sector.includes('restak') || sector.includes('staking')) {
    return `Each week, check the receipt's exchange rate and add a small restake so the wallet records fresh activity.`;
  }
  return `Each week, make one qualifying action such as a deposit, a borrow, a swap or a vote, and keep a note of it.`;
}

/** A farm plan: six steps, each with what it costs and how long it takes. Derived, never name-listed. */
export function farmPlan(protocol: SnapshotProtocol, age: number | null): string[] {
  const chain = primaryChain(protocol);
  const capital = capitalFor(protocol);
  const gas = gasFor(protocol);
  const hold = holdDaysFor(age);
  return [
    `Create a fresh wallet for this position only, fund it with $${capital} plus gas, and keep the recovery phrase offline; never reuse a wallet that holds other funds. Cost: no fee to create, about $${gas} of gas to start. Time: 10 minutes.`,
    `${actionFor(protocol, capital, chain)} Cost: $${capital} of capital and about $${gas} of gas. Time: 15 to 30 minutes.`,
    `${cadenceFor(protocol)} Cost: about $2 to $${gas} of gas a week. Time: 10 minutes a week.`,
    `Keep the position open for at least ${hold} days and touch it weekly, so the activity spans several snapshots instead of one. Cost: the $${capital} stays deployed. Time: ${hold} days.`,
    `Before claiming anything, open ${protocol.name}'s own rewards page from its official app, check the address, and never pay to claim or sign a blind transaction. Cost: no fee to check; a claim costs only gas. Time: 10 minutes.`,
    `Record the wallet address, every deposit, borrow, swap or vote, and the dates in a farm log so you can repeat the position or unwind it cleanly. Cost: nothing but the log. Time: 5 minutes.`,
  ];
}

/** Whether a name is one the snapshot lists, for the board's own guard. */
function indexProtocols(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((protocol) => [protocol.slug, protocol]));
}

/** Every row the board ranks, strongest implied value first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = indexProtocols(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();

  // The watchlist is the floor: all of it, even where a sector rule would otherwise leave a row out.
  for (const slug of snapshot.watchlist) {
    const protocol = index.get(slug);
    if (protocol !== undefined) chosen.set(slug, protocol);
  }

  // The early radar: launch candidates below the floor, by TVL, capped. It never replaces a watchlist row.
  const early = snapshot.protocols
    .filter((protocol) => !chosen.has(protocol.slug) && isLaunchCandidate(protocol) && protocol.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const protocol of early) chosen.set(protocol.slug, protocol);

  const scored = [...chosen.values()].map((protocol) => ({
    protocol,
    value: impliedValue(protocol, snapshot.as_of, model),
    signal: signalScore(protocol, snapshot.as_of),
    risk: riskBand(protocol, snapshot.as_of),
  }));

  scored.sort(
    (a, b) =>
      b.value.implied - a.value.implied ||
      b.signal - a.signal ||
      (a.protocol.slug < b.protocol.slug ? -1 : a.protocol.slug > b.protocol.slug ? 1 : 0),
  );

  return scored.map((entry, position) => ({
    rank: position + 1,
    slug: entry.protocol.slug,
    name: entry.protocol.name,
    category: entry.protocol.category,
    chains: entry.protocol.chains,
    tvl_usd: entry.protocol.tvl_usd,
    change_7d: entry.protocol.change_7d,
    mcap_usd: entry.protocol.mcap_usd,
    listed_at: entry.protocol.listed_at,
    gecko_id: entry.protocol.gecko_id,
    symbol: entry.protocol.symbol,
    token_status: 'pre-token',
    watchlist: snapshot.watchlist.includes(entry.protocol.slug),
    age_days: entry.value.age_days,
    implied_value_usd: entry.value.implied,
    fdv_tvl_multiple: entry.value.fdv_tvl_multiple,
    signal: entry.signal,
    risk: entry.risk,
    base_usd: entry.value.base_usd,
    sector_multiple: entry.value.sector_multiple,
    growth_multiplier: entry.value.growth_multiplier,
    age_multiplier: entry.value.age_multiplier,
    chain_multiplier: entry.value.chain_multiplier,
    farm_steps: farmPlan(entry.protocol, entry.value.age_days),
  }));
}

/** The protocols whose token already trades, by market cap, for the page's market view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((protocol) => !isPreToken(protocol))
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((protocol) => ({
      slug: protocol.slug,
      name: protocol.name,
      category: protocol.category,
      chains: protocol.chains,
      tvl_usd: protocol.tvl_usd,
      mcap_usd: protocol.mcap_usd,
      change_7d: protocol.change_7d,
      mcap_tvl_multiple:
        protocol.mcap_usd === null || protocol.tvl_usd <= 0 ? null : Math.round((protocol.mcap_usd / protocol.tvl_usd) * 100) / 100,
    }));
}

/** One aggregate per sector or chain, for the page's summary strip. */
function groupStats(rows: BoardRow[], key: (row: BoardRow) => string[]): GroupStat[] {
  const groups = new Map<string, GroupStat>();
  for (const row of rows) {
    for (const name of key(row)) {
      const current = groups.get(name) ?? { name, count: 0, implied_usd: 0, tvl_usd: 0 };
      current.count += 1;
      current.implied_usd += row.implied_value_usd;
      current.tvl_usd += row.tvl_usd;
      groups.set(name, current);
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** Everything the page renders, in one object: the board, the market view and the model it runs. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((row) => !row.watchlist).length,
    live_size: live.length,
    total_implied_usd: board.reduce((sum, row) => sum + row.implied_value_usd, 0),
    rows: board,
    live,
    sectors: groupStats(board, (row) => [row.category ?? 'Unclassified']),
    networks: groupStats(board, (row) => (row.chains.length > 0 ? row.chains : ['Unlisted'])),
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const document = raw as Record<string, unknown>;
  if (typeof document.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(document.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof document.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof document.floor_usd !== 'number' || !Number.isSafeInteger(document.floor_usd) || document.floor_usd <= 0) {
    throw new SnapshotError('snapshot.json has no floor_usd');
  }
  if (!Array.isArray(document.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(document.watchlist) || document.watchlist.some((slug) => typeof slug !== 'string')) {
    throw new SnapshotError('snapshot.json has no watchlist of slugs');
  }
  const protocols = document.protocols.map((value, index) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new SnapshotError(`snapshot.json's protocol ${index} is not an object`);
    }
    const protocol = value as Record<string, unknown>;
    if (typeof protocol.slug !== 'string' || typeof protocol.name !== 'string' || typeof protocol.tvl_usd !== 'number' || !Number.isFinite(protocol.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${index} lacks a slug, a name or a TVL`);
    }
    return {
      slug: protocol.slug,
      name: protocol.name,
      category: typeof protocol.category === 'string' ? protocol.category : null,
      chains: Array.isArray(protocol.chains) ? protocol.chains.filter((chain): chain is string => typeof chain === 'string') : [],
      tvl_usd: protocol.tvl_usd,
      change_7d: typeof protocol.change_7d === 'number' && Number.isFinite(protocol.change_7d) ? protocol.change_7d : null,
      mcap_usd: typeof protocol.mcap_usd === 'number' && Number.isFinite(protocol.mcap_usd) ? protocol.mcap_usd : null,
      listed_at: typeof protocol.listed_at === 'string' ? protocol.listed_at : null,
      gecko_id: typeof protocol.gecko_id === 'string' ? protocol.gecko_id : null,
      symbol: typeof protocol.symbol === 'string' ? protocol.symbol : null,
    };
  });
  return {
    as_of: document.as_of,
    source: document.source,
    floor_usd: document.floor_usd,
    protocols,
    watchlist: document.watchlist as string[],
  };
}

/** Why the board is not one the gate will take, or null: coverage, ranks, order, steps and value bounds. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100) return `the board holds ${board.length} rows and the gate needs at least 100`;
  if (board.length > 4000) return `the board holds ${board.length} rows and the gate takes at most 4,000`;
  const slugs = new Set(board.map((row) => row.slug));
  if (slugs.size !== board.length) return 'the board repeats a slug';
  const known = new Set(snapshot.protocols.map((protocol) => protocol.slug));
  const invented = board.find((row) => !known.has(row.slug));
  if (invented !== undefined) return `${invented.slug} is not a protocol in the snapshot`;
  const missing = snapshot.watchlist.filter((slug) => !slugs.has(slug));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((row) => row.rank).sort((a, b) => a - b);
  for (let index = 0; index < ranks.length; index += 1) if (ranks[index] !== index + 1) return `rank ${index + 1} is ${ranks[index]}`;
  for (let index = 1; index < board.length; index += 1) {
    if (board[index]!.implied_value_usd > board[index - 1]!.implied_value_usd) return `row ${index + 1} outranks row ${index} on implied value`;
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share one implied value: a board that ranks nothing by value is not a ranking`;
  }
  for (const row of board) {
    if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd <= 0 || row.implied_value_usd > 100_000_000_000_000) {
      return `${row.slug} has an implied value outside the gate's range`;
    }
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `${row.slug} has ${row.farm_steps.length} farm steps`;
    for (const step of row.farm_steps) {
      if (step.length < 20 || step.length > 600) return `${row.slug} has a farm step of ${step.length} characters`;
    }
  }
  return null;
}

/** The page's dataset as one script: no fetch, no network, every byte local. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
