const crypto = require("crypto");
const {
  envBool,
  createHyperliquidClients,
  getMid,
  setCrossLeverage,
  placeIocMarketLikeOrder,
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
    };
  }

  const { info, exchange, coin, asset, isTestnet } = await createHyperliquidClients();

  const leverage = Number(process.env.LIVE_LEVERAGE || 3);
  await setCrossLeverage(exchange, asset, leverage);

  const maxNotionalUsd = Number(process.env.LIVE_MAX_NOTIONAL_USD || 50);
  const slippageBps = Number(process.env.LIVE_SLIPPAGE_BPS || 20); // 0.20%

  const state = {
    enabled: false, // armed via Telegram toggle
    isTestnet,
    coin,
    asset,
    havePosition: false,
    side: null, // "LONG" | "SHORT"
    sizeCoin: 0,
  };

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
    await placeIocMarketLikeOrder({
      info,
      exchange,
      asset,
      coin,
      isBuy,
      sizeCoin,
      slippageBps,
      reduceOnly: false,
      cloid,
    });

    state.havePosition = true;
    state.side = side;
    state.sizeCoin = sizeCoin;
  }

  async function close() {
    if (!state.enabled) return;
    if (!state.havePosition) return;

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
    });

    state.havePosition = false;
    state.side = null;
    state.sizeCoin = 0;
  }

  async function setEnabled(enabled) {
    state.enabled = !!enabled;
    if (!state.enabled) {
      // Safety: when disarming, close any existing live position.
      await close();
    }
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
  };
}

module.exports = { createLiveExecutor };

