const { Telegraf, Markup } = require("telegraf");

function envStr(name) {
  const v = process.env[name];
  return v === undefined ? "" : String(v);
}

function sameChat(ctx, allowedChatId) {
  if (!allowedChatId) return true;
  const fromChat = ctx?.chat?.id;
  return String(fromChat) === String(allowedChatId);
}

function renderKeyboard(isEnabled) {
  const label = isEnabled ? "🟢 LIVE: ON" : "⚪ LIVE: OFF";
  return Markup.inlineKeyboard([
    Markup.button.callback(label, "LIVE_TOGGLE"),
    Markup.button.callback("ℹ️ Status", "LIVE_STATUS"),
  ]);
}

/**
 * Telegram inline-button controller for live trading.
 *
 * Env:
 * - TELEGRAM_TOKEN (required)
 * - CHAT_ID (optional; if set, only accept controls from this chat)
 */
function createTelegramControl({ getState, onToggle }) {
  const token = envStr("TELEGRAM_TOKEN");
  if (!token) return { enabled: false, bot: null };

  const allowedChatId = envStr("CHAT_ID");
  const bot = new Telegraf(token);

  async function sendPanel(ctx) {
    const s = getState();
    const text =
      `🎛 *Live Trading Control*\n\n` +
      `Capable: *${s.capable ? "YES" : "NO"}*\n` +
      `Armed: *${s.enabled ? "ON" : "OFF"}*\n` +
      `Exchange: *Hyperliquid*\n` +
      `Coin: *${s.coin || "—"}*\n` +
      `Testnet: *${s.isTestnet ? "YES" : "NO"}*\n`;

    return await ctx.reply(text, {
      parse_mode: "Markdown",
      ...renderKeyboard(!!s.enabled),
    });
  }

  bot.start(async (ctx) => {
    if (!sameChat(ctx, allowedChatId)) return;
    await sendPanel(ctx);
  });

  bot.command("live", async (ctx) => {
    if (!sameChat(ctx, allowedChatId)) return;
    await sendPanel(ctx);
  });

  bot.action("LIVE_STATUS", async (ctx) => {
    if (!sameChat(ctx, allowedChatId)) return;
    await ctx.answerCbQuery();
    await sendPanel(ctx);
  });

  bot.action("LIVE_TOGGLE", async (ctx) => {
    if (!sameChat(ctx, allowedChatId)) return;
    const s = getState();

    await ctx.answerCbQuery();

    // Toggle only when capable; otherwise keep OFF.
    const next = s.capable ? !s.enabled : false;
    await onToggle(next);
    await sendPanel(ctx);
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

