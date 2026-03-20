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

/** Perp price rules: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/tick-and-lot-size */
function formatPerpPrice(px, szDecimals) {
  const maxDecimals = Math.max(0, 6 - Number(szDecimals));
  let p = Number(px);
  if (!Number.isFinite(p) || p <= 0) throw new Error(`Invalid raw price: ${px}`);

  // Integers always valid regardless of sig figs
  if (p > 100_000) {
    return Math.round(p);
  }

  p = parseFloat(p.toPrecision(5));
  const factor = 10 ** maxDecimals;
  return Math.round(p * factor) / factor;
}

function formatPerpSize(size, szDecimals) {
  const d = Math.max(0, Math.min(8, Number(szDecimals)));
  const factor = 10 ** d;
  const raw = Number(size);
  if (!Number.isFinite(raw) || raw <= 0) throw new Error(`Invalid size: ${size}`);
  const floored = Math.floor(raw * factor) / factor;
  if (floored <= 0) {
    throw new Error(
      `Order size rounds to 0 (need larger notional or smaller szDecimals asset). raw=${raw}`
    );
  }
  return floored;
}

/** Wire string: no trailing zeros (signing / API) */
function numToWireString(n, maxFracDigits) {
  if (!Number.isFinite(n)) throw new Error("Invalid number");
  const cap =
    maxFracDigits !== undefined
      ? n.toFixed(maxFracDigits)
      : String(n);
  return cap.replace(/\.?0+$/, "") || "0";
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

function toNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizePosition(position) {
  if (!position) return null;
  return {
    coin: position.coin,
    size: toNum(position.szi),
    entryPx: toNum(position.entryPx),
    positionValue: toNum(position.positionValue),
    unrealizedPnl: toNum(position.unrealizedPnl),
    returnOnEquity: toNum(position.returnOnEquity),
    liquidationPx: position.liquidationPx === null ? null : toNum(position.liquidationPx),
    marginUsed: toNum(position.marginUsed),
    leverage: {
      type: position.leverage?.type || null,
      value: Number(position.leverage?.value || 0),
      rawUsd:
        position.leverage && "rawUsd" in position.leverage
          ? toNum(position.leverage.rawUsd)
          : null,
    },
    funding: {
      allTime: toNum(position.cumFunding?.allTime),
      sinceOpen: toNum(position.cumFunding?.sinceOpen),
      sinceChange: toNum(position.cumFunding?.sinceChange),
    },
    side: toNum(position.szi) > 0 ? "LONG" : toNum(position.szi) < 0 ? "SHORT" : "FLAT",
  };
}

function normalizeFill(fill) {
  return {
    coin: fill.coin,
    price: toNum(fill.px),
    size: toNum(fill.sz),
    side: fill.side === "B" ? "BUY" : "SELL",
    dir: fill.dir || null,
    time: fill.time,
    closedPnl: toNum(fill.closedPnl),
    fee: toNum(fill.fee),
    startPosition: toNum(fill.startPosition),
    hash: fill.hash,
    oid: fill.oid,
    crossed: !!fill.crossed,
    tid: fill.tid,
    feeToken: fill.feeToken || null,
    cloid: fill.cloid || null,
  };
}

async function fetchUserLiveSnapshot(info, user, coin, options = {}) {
  const fillsLookbackMs = Math.max(
    60 * 60 * 1000,
    Number(options.fillsLookbackMs || 24 * 60 * 60 * 1000)
  );
  const fillsLimit = Math.max(1, Math.min(100, Number(options.fillsLimit || 20)));

  const [webData, fills] = await Promise.all([
    info.webData2({ user }),
    info.userFillsByTime({
      user,
      startTime: Date.now() - fillsLookbackMs,
      reversed: true,
      aggregateByTime: false,
    }),
  ]);

  const clearinghouseState = webData?.clearinghouseState || {};
  const allPositions = (clearinghouseState.assetPositions || [])
    .map((item) => normalizePosition(item?.position))
    .filter(Boolean);

  const currentPosition =
    allPositions.find((pos) => String(pos.coin).toUpperCase() === String(coin).toUpperCase()) ||
    null;

  const recentFills = (Array.isArray(fills) ? fills : [])
    .filter((fill) => String(fill.coin).toUpperCase() === String(coin).toUpperCase())
    .slice(0, fillsLimit)
    .map(normalizeFill);

  const openOrders = (webData?.openOrders || [])
    .filter((order) => String(order.coin).toUpperCase() === String(coin).toUpperCase())
    .map((order) => ({
      coin: order.coin,
      side: order.side === "B" ? "BUY" : "SELL",
      limitPx: toNum(order.limitPx),
      size: toNum(order.sz),
      originalSize: toNum(order.origSz),
      orderId: order.oid,
      timestamp: order.timestamp,
      reduceOnly: !!order.reduceOnly,
      trigger: !!order.isTrigger,
      orderType: order.orderType || null,
      tif: order.tif || null,
      cloid: order.cloid || null,
    }));

  return {
    user,
    coin,
    fetchedAt: Date.now(),
    serverTime: Number(webData?.serverTime || clearinghouseState?.time || Date.now()),
    account: {
      accountValue: toNum(clearinghouseState?.marginSummary?.accountValue),
      totalNotionalPosition: toNum(clearinghouseState?.marginSummary?.totalNtlPos),
      totalRawUsd: toNum(clearinghouseState?.marginSummary?.totalRawUsd),
      totalMarginUsed: toNum(clearinghouseState?.marginSummary?.totalMarginUsed),
      withdrawable: toNum(clearinghouseState?.withdrawable),
      crossAccountValue: toNum(clearinghouseState?.crossMarginSummary?.accountValue),
      crossMarginUsed: toNum(clearinghouseState?.crossMarginSummary?.totalMarginUsed),
      crossMaintenanceMarginUsed: toNum(clearinghouseState?.crossMaintenanceMarginUsed),
    },
    currentPosition,
    allPositions,
    openOrders,
    recentFills,
  };
}

async function createHyperliquidClients() {
  const isTestnet = envBool("HYPERLIQUID_TESTNET", false);
  const transport = new HttpTransport({ isTestnet });

  const info = new InfoClient({ transport });

  const privateKey = mustGetEnv("HYPERLIQUID_PRIVATE_KEY");
  const wallet = privateKeyToAccount(privateKey);
  const exchange = new ExchangeClient({ transport, wallet });
  const walletAddress = wallet.address;

  const coin = (process.env.HYPERLIQUID_COIN || "BTC").toUpperCase();
  const meta = await info.meta();
  const universe = meta?.universe || [];
  const asset = universe.findIndex((u) => u?.name === coin);
  if (asset < 0) {
    const known = universe.slice(0, 20).map((u) => u?.name).filter(Boolean);
    throw new Error(
      `Unknown Hyperliquid perp coin '${coin}'. Example coins: ${known.join(", ")}`
    );
  }
  const szDecimals = Number(universe[asset]?.szDecimals ?? 4);

  return { info, exchange, coin, asset, isTestnet, szDecimals, walletAddress };
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
  szDecimals,
}) {
  const mid = await getMid(info, coin);
  const slip = (Number(slippageBps) || 0) / 10_000;
  const rawPx = isBuy ? mid * (1 + slip) : mid * (1 - slip);
  const px = formatPerpPrice(rawPx, szDecimals);
  const s = formatPerpSize(sizeCoin, szDecimals);

  const maxPxDecimals = Math.max(0, 6 - Number(szDecimals));

  const order = {
    a: asset,
    b: !!isBuy,
    p: numToWireString(px, maxPxDecimals),
    s: numToWireString(s, szDecimals),
    r: !!reduceOnly,
    t: { limit: { tif: "Ioc" } },
  };
  if (cloid) order.cloid = String(cloid);

  const res = await exchange.order({
    orders: [order],
    grouping: "na",
  });
  return { result: res, sizeCoin: s, price: px };
}

module.exports = {
  envBool,
  createHyperliquidClients,
  getMid,
  roundToStep,
  setCrossLeverage,
  placeIocMarketLikeOrder,
  formatPerpPrice,
  formatPerpSize,
  fetchUserLiveSnapshot,
};

