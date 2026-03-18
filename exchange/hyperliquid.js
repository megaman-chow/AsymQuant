const {
  HttpTransport,
  InfoClient,
  ExchangeClient,
} = require("@nktkas/hyperliquid");

const { privateKeyToAccount } = require("viem/accounts");

function envBool(name, fallback = false) {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return String(v).toLowerCase() === "true" || v === "1" || v === "yes";
}

function mustGetEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

async function getPerpAssetIndex(info, coin) {
  const meta = await info.meta();
  const universe = meta?.universe || [];
  const idx = universe.findIndex((u) => u?.name === coin);
  if (idx < 0) {
    const known = universe.slice(0, 20).map((u) => u?.name).filter(Boolean);
    throw new Error(
      `Unknown Hyperliquid perp coin '${coin}'. Example coins: ${known.join(", ")}`
    );
  }
  return idx;
}

async function getMid(info, coin) {
  const mids = await info.allMids();
  const px = mids?.[coin];
  const n = Number(px);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Unable to fetch mid price for '${coin}' (got: ${px})`);
  }
  return n;
}

function roundToStep(x, step) {
  if (!Number.isFinite(step) || step <= 0) return x;
  return Math.floor(x / step) * step;
}

function numToPxString(x) {
  // Hyperliquid accepts strings; avoid exponential notation
  if (!Number.isFinite(x)) throw new Error("Invalid number");
  return x.toFixed(8).replace(/\.?0+$/, "");
}

async function createHyperliquidClients() {
  const isTestnet = envBool("HYPERLIQUID_TESTNET", false);
  const transport = new HttpTransport({ isTestnet });

  const info = new InfoClient({ transport });

  const privateKey = mustGetEnv("HYPERLIQUID_PRIVATE_KEY");
  const wallet = privateKeyToAccount(privateKey);
  const exchange = new ExchangeClient({ transport, wallet });

  const coin = (process.env.HYPERLIQUID_COIN || "BTC").toUpperCase();
  const asset = await getPerpAssetIndex(info, coin);

  return { info, exchange, coin, asset, isTestnet };
}

async function setCrossLeverage(exchange, asset, leverage) {
  if (!Number.isFinite(leverage) || leverage <= 0) return;
  await exchange.updateLeverage({
    asset,
    isCross: true,
    leverage: Math.round(leverage),
  });
}

async function placeIocMarketLikeOrder({
  info,
  exchange,
  asset,
  coin,
  isBuy,
  sizeCoin,
  slippageBps,
  reduceOnly,
  cloid,
}) {
  const mid = await getMid(info, coin);
  const slip = (Number(slippageBps) || 0) / 10_000;
  const px = isBuy ? mid * (1 + slip) : mid * (1 - slip);

  const s = Number(sizeCoin);
  if (!Number.isFinite(s) || s <= 0) throw new Error(`Invalid sizeCoin: ${sizeCoin}`);

  const order = {
    a: asset,
    b: !!isBuy,
    p: numToPxString(px),
    s: numToPxString(s),
    r: !!reduceOnly,
    t: { limit: { tif: "Ioc" } },
  };
  if (cloid) order.cloid = String(cloid);

  return await exchange.order({
    orders: [order],
    grouping: "na",
  });
}

module.exports = {
  envBool,
  createHyperliquidClients,
  getMid,
  roundToStep,
  setCrossLeverage,
  placeIocMarketLikeOrder,
};

