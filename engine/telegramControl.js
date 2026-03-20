const { Telegraf, Markup } = require("telegraf");

function envStr(name) {
  const v = process.env[name];
  return v === undefined ? "" : String(v);
}

function envBool(name, fallback = true) {
  const v = process.env[name];
  if (v === undefined) return fallback;
  const s = String(v).toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function sameChat(ctx, allowedChatId) {
  if (!allowedChatId) return true;
  const fromChat = ctx?.chat?.id;
  return String(fromChat) === String(allowedChatId);
}

function renderKeyboard(state) {
  const liveLabel = state?.enabled ? "🟢 LIVE: ON" : "⚪ LIVE: OFF";
  return Markup.inlineKeyboard([
    [Markup.button.callback(liveLabel, "LIVE_TOGGLE"), Markup.button.callback("🔄 Refresh", "BOT_REFRESH")],
    [Markup.button.callback("ℹ️ Status", "BOT_STATUS"), Markup.button.callback("🧭 Summary", "BOT_SUMMARY")],
    [Markup.button.callback("🥇 Leader", "BOT_LEADER"), Markup.button.callback("📂 Positions", "BOT_POSITIONS")],
    [Markup.button.callback("💹 Live", "BOT_LIVE"), Markup.button.callback("🧾 Fills", "BOT_LIVE_FILLS")],
    [Markup.button.callback("🏆 Top", "BOT_TOP"), Markup.button.callback("🕒 Recent", "BOT_RECENT")],
    [Markup.button.callback("⏪ Replay", "BOT_REPLAY"), Markup.button.callback("🧬 Evolve", "BOT_EVOLVE")],
    [Markup.button.callback("💾 Save", "BOT_SAVE"), Markup.button.callback("❓ Help", "BOT_HELP")],
    [Markup.button.callback("🧪 Test LONG", "TEST_LONG"), Markup.button.callback("🧹 Flat (close)", "TEST_FLAT")],
  ]);
}

function confirmKeyboard(actionKey) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("✅ Confirm", `CONFIRM_${actionKey}`), Markup.button.callback("✖ Cancel", `CANCEL_${actionKey}`)],
  ]);
}

function chatKey(ctx) {
  return String(ctx?.chat?.id || "unknown");
}

/**
 * Telegram inline-button controller for live trading and bot operations.
 */
function createTelegramControl({
  getState,
  getStatusText,
  getSummaryText,
  getTopText,
  getReplayText,
  getHelpText,
  getLeaderText,
  getPositionsText,
  getRecentText,
  getLiveText,
  getLiveFillsText,
  onToggle,
  onSave,
  onEvolve,
  onTestLong,
  onTestFlat,
}) {
  const token = envStr("TELEGRAM_TOKEN");
  if (!token) return { enabled: false, bot: null };

  const allowedChatId = envStr("CHAT_ID");
  const requireConfirm = envBool("TELEGRAM_CONFIRM_ACTIONS", true);
  const confirmTtlMs = Math.max(10_000, Number(envStr("TELEGRAM_CONFIRM_TTL_MS") || 60_000));
  const bot = new Telegraf(token);
  const pendingActions = new Map();

  function formatUsd(n) {
    return Number.isFinite(n) ? `$${Number(n).toFixed(2)}` : "—";
  }

  function setPending(ctx, actionKey, payload = {}) {
    pendingActions.set(`${chatKey(ctx)}:${actionKey}`, {
      actionKey,
      payload,
      expiresAt: Date.now() + confirmTtlMs,
    });
  }

  function consumePending(ctx, actionKey) {
    const key = `${chatKey(ctx)}:${actionKey}`;
    const pending = pendingActions.get(key);
    pendingActions.delete(key);
    if (!pending) return null;
    if (pending.expiresAt < Date.now()) return null;
    return pending;
  }

  function clearPending(ctx, actionKey) {
    pendingActions.delete(`${chatKey(ctx)}:${actionKey}`);
  }

  async function resolveMaybe(valueOrFn, fallback) {
    if (!valueOrFn) return fallback;
    const resolved = typeof valueOrFn === "function" ? valueOrFn() : valueOrFn;
    const value = await Promise.resolve(resolved);
    return value ?? fallback;
  }

  async function sendPanel(ctx) {
    const s = await resolveMaybe(getState, {});
    const text =
      `🎛 *Bot Control Panel*\n\n` +
      `Symbol: *${s.symbol || "—"}*\n` +
      `Population: *${s.population ?? "—"}*\n` +
      `Sim Open Positions: *${s.activePositions ?? "—"}*\n` +
      `Total Equity: *${formatUsd(s.totalEquity)}*\n` +
      `Queue: *${s.telegramQueue ?? 0}*\n` +
      `Replaying: *${s.replaying ? "YES" : "NO"}*\n` +
      `Sim Seed: *${s.simSeed || "—"}*\n` +
      `Evolution Cycles: *${s.evolutionCount ?? 0}*\n` +
      `Leader: \`${String(s.leaderId || "—").slice(0, 12)}\`\n` +
      `Leader Score: *${Number(s.leaderScore || 0).toFixed(2)}*\n` +
      `Last Candles: *${s.lastProcessedPreview || "—"}*\n\n` +
      `*Live Execution*\n` +
      `Capable: *${s.capable ? "YES" : "NO"}*\n` +
      `Armed: *${s.enabled ? "ON" : "OFF"}*\n` +
      `Exchange: *Hyperliquid*\n` +
      `Live TF: *${s.liveTimeframe || "—"}*\n` +
      `Coin: *${s.coin || "—"}*\n` +
      `Testnet: *${s.isTestnet ? "YES" : "NO"}*\n` +
      `Tracked Position: *${s.side || "FLAT"}*\n` +
      `Live Size: *${s.sizeCoin || 0}*\n` +
      `Exchange Account: *${formatUsd(s.liveAccountValue)}*\n` +
      `Withdrawable: *${formatUsd(s.liveWithdrawable)}*\n` +
      `Open Orders: *${s.liveOpenOrders ?? 0}*\n` +
      `Entry Px: *${s.liveEntryPx ? `$${Number(s.liveEntryPx).toFixed(2)}` : "—"}*\n` +
      `Unrealized PnL: *${Number.isFinite(Number(s.liveUnrealizedPnl)) ? formatUsd(s.liveUnrealizedPnl) : "—"}*\n`;

    return await ctx.reply(text, {
      parse_mode: "Markdown",
      ...renderKeyboard(s),
    });
  }

  async function replyMarkdown(ctx, text, extra = {}) {
    try {
      return await ctx.reply(text, { parse_mode: "Markdown", ...extra });
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      if (!message.includes("can't parse entities")) {
        throw err;
      }
      const fallback = { ...extra };
      delete fallback.parse_mode;
      return await ctx.reply(text, fallback);
    }
  }

  async function requestConfirmation(ctx, actionKey, text) {
    setPending(ctx, actionKey);
    return await replyMarkdown(ctx, text, confirmKeyboard(actionKey));
  }

  async function executeToggle(ctx, nextEnabled) {
    if (requireConfirm) {
      setPending(ctx, "LIVE_TOGGLE", { nextEnabled });
      return await replyMarkdown(
        ctx,
        `Confirm live trading *${nextEnabled ? "ARM" : "DISARM"}*?`,
        confirmKeyboard("LIVE_TOGGLE")
      );
    }
    await onToggle(nextEnabled);
    return await sendPanel(ctx);
  }

  async function executeTestLong(ctx) {
    if (!onTestLong) return;
    if (requireConfirm) {
      return await requestConfirmation(
        ctx,
        "TEST_LONG",
        `Confirm sending a *live test LONG* while LIVE is OFF?`
      );
    }
    const r = await onTestLong();
    return await replyMarkdown(
      ctx,
      `✅ *Test LONG sent*\n\nCoin: *${r.coin}*\n~$${r.usd} notional\nSize: \`${r.sizeCoin}\`\nLimit px: \`${r.limitPx}\``
    );
  }

  async function executeTestFlat(ctx) {
    if (!onTestFlat) return;
    if (requireConfirm) {
      return await requestConfirmation(
        ctx,
        "TEST_FLAT",
        `Confirm *flattening* the tracked live position?`
      );
    }
    await onTestFlat();
    return await ctx.reply("✅ Flatten sent (reduce-only close if bot had a tracked position).");
  }

  async function executeEvolve(ctx) {
    if (!onEvolve) return;
    const message = await onEvolve();
    return await replyMarkdown(ctx, message || "🧬 Evolution complete.");
  }

  bot.start(async (ctx) => {
    if (!sameChat(ctx, allowedChatId)) return;
    await sendPanel(ctx);
  });

  bot.command("live", async (ctx) => {
    if (!sameChat(ctx, allowedChatId)) return;
    await sendPanel(ctx);
  });

  bot.command("refresh", async (ctx) => {
    if (!sameChat(ctx, allowedChatId)) return;
    await sendPanel(ctx);
  });

  bot.command("help", async (ctx) => {
    if (!sameChat(ctx, allowedChatId)) return;
    await replyMarkdown(ctx, await resolveMaybe(getHelpText, "No help text configured."));
  });

  bot.command("status", async (ctx) => {
    if (!sameChat(ctx, allowedChatId)) return;
    await replyMarkdown(ctx, await resolveMaybe(getStatusText, "No status text configured."));
  });

  bot.command("summary", async (ctx) => {
    if (!sameChat(ctx, allowedChatId)) return;
    await replyMarkdown(ctx, await resolveMaybe(getSummaryText, "No summary text configured."));
  });

  bot.command("leader", async (ctx) => {
    if (!sameChat(ctx, allowedChatId)) return;
    await replyMarkdown(ctx, await resolveMaybe(getLeaderText, "No leader text configured."));
  });

  bot.command("positions", async (ctx) => {
    if (!sameChat(ctx, allowedChatId)) return;
    await replyMarkdown(ctx, await resolveMaybe(getPositionsText, "No positions text configured."));
  });

  bot.command("recent", async (ctx) => {
    if (!sameChat(ctx, allowedChatId)) return;
    await replyMarkdown(ctx, await resolveMaybe(getRecentText, "No recent text configured."));
  });

  bot.command("livestate", async (ctx) => {
    if (!sameChat(ctx, allowedChatId)) return;
    await replyMarkdown(ctx, await resolveMaybe(getLiveText, "No live exchange text configured."));
  });

  bot.command("livefills", async (ctx) => {
    if (!sameChat(ctx, allowedChatId)) return;
    await replyMarkdown(ctx, await resolveMaybe(getLiveFillsText, "No live fill text configured."));
  });

  bot.command("top", async (ctx) => {
    if (!sameChat(ctx, allowedChatId)) return;
    await replyMarkdown(ctx, await resolveMaybe(getTopText, "No top-trader text configured."));
  });

  bot.command("replay", async (ctx) => {
    if (!sameChat(ctx, allowedChatId)) return;
    await replyMarkdown(ctx, await resolveMaybe(getReplayText, "No replay text configured."));
  });

  bot.command("save", async (ctx) => {
    if (!sameChat(ctx, allowedChatId)) return;
    if (!onSave) return;
    try {
      const message = await onSave();
      await replyMarkdown(ctx, message || "💾 Save complete.");
    } catch (e) {
      await ctx.reply(`❌ ${e.message || e}`);
    }
  });

  bot.command("evolve", async (ctx) => {
    if (!sameChat(ctx, allowedChatId)) return;
    try {
      await executeEvolve(ctx);
    } catch (e) {
      await ctx.reply(`❌ ${e.message || e}`);
    }
  });

  bot.command("testlong", async (ctx) => {
    if (!sameChat(ctx, allowedChatId)) return;
    try {
      await executeTestLong(ctx);
    } catch (e) {
      await ctx.reply(`❌ ${e.message || e}`);
    }
  });

  bot.command("testflat", async (ctx) => {
    if (!sameChat(ctx, allowedChatId)) return;
    try {
      await executeTestFlat(ctx);
    } catch (e) {
      await ctx.reply(`❌ ${e.message || e}`);
    }
  });

  bot.action("BOT_REFRESH", async (ctx) => {
    if (!sameChat(ctx, allowedChatId)) return;
    await ctx.answerCbQuery();
    await sendPanel(ctx);
  });

  bot.action("BOT_STATUS", async (ctx) => {
    if (!sameChat(ctx, allowedChatId)) return;
    await ctx.answerCbQuery();
    await replyMarkdown(ctx, await resolveMaybe(getStatusText, "No status text configured."));
  });

  bot.action("BOT_SUMMARY", async (ctx) => {
    if (!sameChat(ctx, allowedChatId)) return;
    await ctx.answerCbQuery();
    await replyMarkdown(ctx, await resolveMaybe(getSummaryText, "No summary text configured."));
  });

  bot.action("BOT_LEADER", async (ctx) => {
    if (!sameChat(ctx, allowedChatId)) return;
    await ctx.answerCbQuery();
    await replyMarkdown(ctx, await resolveMaybe(getLeaderText, "No leader text configured."));
  });

  bot.action("BOT_POSITIONS", async (ctx) => {
    if (!sameChat(ctx, allowedChatId)) return;
    await ctx.answerCbQuery();
    await replyMarkdown(ctx, await resolveMaybe(getPositionsText, "No positions text configured."));
  });

  bot.action("BOT_RECENT", async (ctx) => {
    if (!sameChat(ctx, allowedChatId)) return;
    await ctx.answerCbQuery();
    await replyMarkdown(ctx, await resolveMaybe(getRecentText, "No recent text configured."));
  });

  bot.action("BOT_LIVE", async (ctx) => {
    if (!sameChat(ctx, allowedChatId)) return;
    await ctx.answerCbQuery();
    await replyMarkdown(ctx, await resolveMaybe(getLiveText, "No live exchange text configured."));
  });

  bot.action("BOT_LIVE_FILLS", async (ctx) => {
    if (!sameChat(ctx, allowedChatId)) return;
    await ctx.answerCbQuery();
    await replyMarkdown(ctx, await resolveMaybe(getLiveFillsText, "No live fill text configured."));
  });

  bot.action("BOT_TOP", async (ctx) => {
    if (!sameChat(ctx, allowedChatId)) return;
    await ctx.answerCbQuery();
    await replyMarkdown(ctx, await resolveMaybe(getTopText, "No top-trader text configured."));
  });

  bot.action("BOT_REPLAY", async (ctx) => {
    if (!sameChat(ctx, allowedChatId)) return;
    await ctx.answerCbQuery();
    await replyMarkdown(ctx, await resolveMaybe(getReplayText, "No replay text configured."));
  });

  bot.action("BOT_HELP", async (ctx) => {
    if (!sameChat(ctx, allowedChatId)) return;
    await ctx.answerCbQuery();
    await replyMarkdown(ctx, await resolveMaybe(getHelpText, "No help text configured."));
  });

  bot.action("BOT_SAVE", async (ctx) => {
    if (!sameChat(ctx, allowedChatId)) return;
    await ctx.answerCbQuery();
    if (!onSave) return;
    try {
      const message = await onSave();
      await replyMarkdown(ctx, message || "💾 Save complete.");
    } catch (e) {
      await ctx.reply(`❌ ${e.message || e}`);
    }
  });

  bot.action("BOT_EVOLVE", async (ctx) => {
    if (!sameChat(ctx, allowedChatId)) return;
    await ctx.answerCbQuery();
    try {
      await executeEvolve(ctx);
    } catch (e) {
      await ctx.reply(`❌ ${e.message || e}`);
    }
  });

  bot.action("TEST_LONG", async (ctx) => {
    if (!sameChat(ctx, allowedChatId)) return;
    await ctx.answerCbQuery();
    try {
      await executeTestLong(ctx);
    } catch (e) {
      await ctx.reply(`❌ ${e.message || e}`);
    }
  });

  bot.action("TEST_FLAT", async (ctx) => {
    if (!sameChat(ctx, allowedChatId)) return;
    await ctx.answerCbQuery();
    try {
      await executeTestFlat(ctx);
    } catch (e) {
      await ctx.reply(`❌ ${e.message || e}`);
    }
  });

  bot.action("LIVE_TOGGLE", async (ctx) => {
    if (!sameChat(ctx, allowedChatId)) return;
    const s = await resolveMaybe(getState, {});
    await ctx.answerCbQuery();
    try {
      await executeToggle(ctx, s.capable ? !s.enabled : false);
    } catch (e) {
      await ctx.reply(`❌ ${e.message || e}`);
    }
  });

  bot.action("CONFIRM_LIVE_TOGGLE", async (ctx) => {
    if (!sameChat(ctx, allowedChatId)) return;
    await ctx.answerCbQuery();
    const pending = consumePending(ctx, "LIVE_TOGGLE");
    if (!pending) {
      return await ctx.reply("Confirmation expired. Try again.");
    }
    try {
      await onToggle(!!pending.payload.nextEnabled);
      await sendPanel(ctx);
    } catch (e) {
      await ctx.reply(`❌ ${e.message || e}`);
    }
  });

  bot.action("CONFIRM_TEST_LONG", async (ctx) => {
    if (!sameChat(ctx, allowedChatId)) return;
    await ctx.answerCbQuery();
    const pending = consumePending(ctx, "TEST_LONG");
    if (!pending) {
      return await ctx.reply("Confirmation expired. Try again.");
    }
    try {
      const r = await onTestLong();
      await replyMarkdown(
        ctx,
        `✅ *Test LONG sent*\n\nCoin: *${r.coin}*\n~$${r.usd} notional\nSize: \`${r.sizeCoin}\`\nLimit px: \`${r.limitPx}\``
      );
    } catch (e) {
      await ctx.reply(`❌ ${e.message || e}`);
    }
  });

  bot.action("CONFIRM_TEST_FLAT", async (ctx) => {
    if (!sameChat(ctx, allowedChatId)) return;
    await ctx.answerCbQuery();
    const pending = consumePending(ctx, "TEST_FLAT");
    if (!pending) {
      return await ctx.reply("Confirmation expired. Try again.");
    }
    try {
      await onTestFlat();
      await ctx.reply("✅ Flatten sent (reduce-only close if bot had a tracked position).");
    } catch (e) {
      await ctx.reply(`❌ ${e.message || e}`);
    }
  });

  bot.action(/CANCEL_.+/, async (ctx) => {
    if (!sameChat(ctx, allowedChatId)) return;
    await ctx.answerCbQuery("Cancelled");
    const data = String(ctx.callbackQuery?.data || "");
    const actionKey = data.replace(/^CANCEL_/, "");
    clearPending(ctx, actionKey);
    await ctx.reply("Cancelled.");
  });

  bot.catch((err) => {
    console.error("Telegram control error:", err && err.stack ? err.stack : err);
  });

  bot.launch();

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));

  return { enabled: true, bot };
}

module.exports = { createTelegramControl };

