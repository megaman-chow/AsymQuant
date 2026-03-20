const crypto = require("crypto");
const {
  envBool,
  createHyperliquidClients,
  getMid,
  setCrossLeverage,
  placeIocMarketLikeOrder,
  fetchUserLiveSnapshot,
} = require("../exchange/hyperliquid");

function mustConfirmLiveTrading() {
  const enabled = envBool("LIVE_TRADING", false);
  if (!enabled) return false;

  const confirm = String(process.env.LIVE_TRADING_CONFIRM || "");
  return confirm === "I_UNDERSTAND_THIS_PLACES_REAL_ORDERS";
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function makeCloid(prefix = "bot") {
  return `${prefix}-${crypto.randomBytes(8).toString("hex")}`;
}

/**
 * Mirrors simulated open/close events into ONE live position.
 * Safety: requires LIVE_TRADING=true and LIVE_TRADING_CONFIRM exact string.
 */
async function createLiveExecutor() {
  const liveOk = mustConfirmLiveTrading();
  if (!liveOk) {
    return {
      capable: false,
      enabled: false,
      onOpened: async () => {},
      onClosed: async () => {},
      setEnabled: async () => {},
      syncFromSim: async () => {},
      testOpenLong: async () => {
        throw new Error("Live trading not configured");
      },
      flattenLive: async () => {},
      getLiveSnapshot: async () => null,
    };
  }

  const { info, exchange, coin, asset, isTestnet, szDecimals, walletAddress } =
    await createHyperliquidClients();

  const leverage = Number(process.env.LIVE_LEVERAGE || 3);
  await setCrossLeverage(exchange, asset, leverage);

  const maxNotionalUsd = Number(process.env.LIVE_MAX_NOTIONAL_USD || 50);
  const slippageBps = Number(process.env.LIVE_SLIPPAGE_BPS || 20); // 0.20%

  const state = {
    enabled: false, // armed via Telegram toggle
    isTestnet,
    coin,
    asset,
    walletAddress,
    havePosition: false,
    side: null, // "LONG" | "SHORT"
    sizeCoin: 0,
    lastExchangeSnapshot: null,
    lastExchangeSnapshotAt: null,
  };

  const snapshotTtlMs = Math.max(5000, Number(process.env.LIVE_STATUS_TTL_MS || 15000));
  const fillsLookbackMs = Math.max(
    60 * 60 * 1000,
    Number(process.env.LIVE_FILLS_LOOKBACK_MS || 24 * 60 * 60 * 1000)
  );
  const fillsLimit = Math.max(1, Math.min(50, Number(process.env.LIVE_FILLS_LIMIT || 10)));

  async function getLiveSnapshot(force = false) {
    const age = Date.now() - Number(state.lastExchangeSnapshotAt || 0);
    if (!force && state.lastExchangeSnapshot && age < snapshotTtlMs) {
      return state.lastExchangeSnapshot;
    }

    const snapshot = await fetchUserLiveSnapshot(info, walletAddress, coin, {
      fillsLookbackMs,
      fillsLimit,
    });

    state.lastExchangeSnapshot = snapshot;
    state.lastExchangeSnapshotAt = snapshot.fetchedAt;

    const livePos = snapshot?.currentPosition;
    state.havePosition = !!(livePos && Math.abs(Number(livePos.size || 0)) > 0);
    state.side = livePos ? livePos.side : null;
    state.sizeCoin = livePos ? Math.abs(Number(livePos.size || 0)) : 0;

    return snapshot;
  }

  async function open(side /* LONG|SHORT */, g /* 0..1ish */) {
    if (!state.enabled) return;
    if (state.havePosition) return;

    const mid = await getMid(info, coin);
    const gClamped = clamp(Number(g) || 0.25, 0.05, 1.0);

    // Size in USD is capped; never scale by sim equity.
    const notional = clamp(maxNotionalUsd * gClamped, 5, maxNotionalUsd);
    const sizeCoin = notional / mid;

    const isBuy = side === "LONG";
    const cloid = makeCloid("open");
    const { sizeCoin: filledSz } = await placeIocMarketLikeOrder({
      info,
      exchange,
      asset,
      coin,
      isBuy,
      sizeCoin,
      slippageBps,
      reduceOnly: false,
      cloid,
      szDecimals,
    });

    state.havePosition = true;
    state.side = side;
    state.sizeCoin = filledSz;
    await getLiveSnapshot(true).catch(() => {});
  }

  async function close(forceDisarm = false) {
    if (!state.havePosition) return;
    if (!forceDisarm && !state.enabled) return;

    const isBuy = state.side === "SHORT"; // close short by buying, close long by selling
    const cloid = makeCloid("close");
    await placeIocMarketLikeOrder({
      info,
      exchange,
      asset,
      coin,
      isBuy,
      sizeCoin: state.sizeCoin,
      slippageBps,
      reduceOnly: true,
      cloid,
      szDecimals,
    });

    state.havePosition = false;
    state.side = null;
    state.sizeCoin = 0;
    await getLiveSnapshot(true).catch(() => {});
  }

  async function setEnabled(enabled) {
    if (!enabled) {
      await close(true);
    }
    state.enabled = !!enabled;
  }

  async function flattenLive() {
    await close(true);
    await getLiveSnapshot(true).catch(() => {});
  }

  /**
   * Open a small LONG immediately (IOC) to verify Hyperliquid wiring.
   * Requires LIVE disarmed. Min ~$12 notional (HL floor ~$10).
   */
  async function testOpenLong() {
    if (state.enabled) {
      throw new Error("Turn LIVE OFF first (panel), then run test long.");
    }
    const testUsd = Math.max(
      12,
      Math.min(maxNotionalUsd, Number(process.env.TEST_LONG_USD || 12))
    );
    if (state.havePosition) {
      await close(true);
    }
    const mid = await getMid(info, coin);
    const sizeCoin = testUsd / mid;
    const cloid = makeCloid("testlong");
    const { sizeCoin: filledSz, price } = await placeIocMarketLikeOrder({
      info,
      exchange,
      asset,
      coin,
      isBuy: true,
      sizeCoin,
      slippageBps,
      reduceOnly: false,
      cloid,
      szDecimals,
    });
    state.havePosition = true;
    state.side = "LONG";
    state.sizeCoin = filledSz;
    await getLiveSnapshot(true).catch(() => {});
    return { coin, mid, limitPx: price, sizeCoin: filledSz, usd: testUsd };
  }

  /**
   * Brings live position in sync with the sim leader immediately.
   * - If sim has no open pos -> ensure live is flat.
   * - If sim has open pos -> ensure live matches side (re-open if needed).
   */
  async function syncFromSim(simOpenPosition) {
    if (!state.enabled) return;

    const simSide = simOpenPosition?.side || null; // "LONG" | "SHORT"
    const simG = simOpenPosition?.g;

    if (!simSide) {
      await close();
      return;
    }

    if (state.havePosition && state.side === simSide) return;

    // If side differs, flatten then open new side.
    await close();
    await open(simSide, simG);
  }

  return {
    capable: true,
    enabled: false,
    state,
    onOpened: async ({ side, g }) => {
      await open(side, g);
    },
    onClosed: async () => {
      await close();
    },
    setEnabled,
    syncFromSim,
    testOpenLong,
    flattenLive,
    getLiveSnapshot,
  };
}

module.exports = { createLiveExecutor };

