#ASYMQuant

`ASYM Quant` is a Node.js multi-timeframe trading system that:

- streams closed candles from Binance
- evaluates a population of simulated traders across multiple timeframes
- evolves the trader population based on performance
- persists trader state between restarts
- sends operational updates to Telegram
- can optionally mirror the current simulated leader into live Hyperliquid orders

The project is simulation-first. Live trading is disabled unless you explicitly enable it with the required environment variables and confirmation string.

## What This Project Does

The bot runs a pool of traders with slightly different "genetic" traits such as:

- preferred timeframe
- conviction threshold (`gThreshold`)
- trend-following vs contrarian behavior (`invert`)

For each configured timeframe, the bot:

1. warms historical candle data from Binance REST
2. subscribes to Binance WebSocket closed-candle streams
3. computes indicators such as EMA, ATR, RSI, and volume average
4. evaluates a strategy on every trader assigned to that timeframe
5. opens and closes simulated positions
6. updates scores and periodically evolves the population

If live trading is armed, the bot also mirrors the top simulated trader on the configured live timeframe into one live Hyperliquid position.

On restart, the bot now preserves evolved trader timeframes and uses `bot_runtime_state.json` to replay missed closed candles before attaching live streams again.

## Main Components

- `bot.js`: main runtime loop, Telegram batching, evolution loop, persistence, warm start, and stream attachment
- `config.js`: market, population, risk, evolution, and dashboard settings
- `exchange/binance.js`: Binance WebSocket market data stream
- `exchange/binanceKlines.js`: Binance REST candle warmup
- `exchange/hyperliquid.js`: Hyperliquid client setup and order helpers
- `engine/liveExecutionEngine.js`: live-trading safety checks and execution bridge
- `engine/telegramControl.js`: Telegram operator console for monitoring, confirmations, and live actions
- `engine/notifier.js`: Telegram alert delivery
- `engine/persistenceEngine.js`: saves and restores `traders_state.json` plus `bot_runtime_state.json`
- `engine/eventBuffer.js`: in-memory recent event tracking for Telegram and API consumers
- `engine/dashboard.js`: console dashboard and JSON snapshots in `engine/logs/`
- `api/server.js`: local read-only HTTP API for signals, status, leaders, and replay health
- `traders/traderPool.js`: initial trader population creation
- `strategies/strategyV2.js`: currently active signal logic used by `bot.js`
- `strategies/strategyV3.js`: alternate strategy implementation present in the repo but not currently wired into the main bot

## Requirements

- Node.js 18+ recommended
- npm
- Telegram bot token and chat ID for alerts/control
- Hyperliquid private key only if you plan to use live execution

## Installation

```bash
npm install
cp .env.example .env
```

Fill in the values inside `.env`.

## Environment Variables

### Required for Telegram notifications and control

- `TELEGRAM_TOKEN`: Telegram bot token
- `CHAT_ID`: chat ID that should receive alerts and be allowed to control the live panel

### Optional live-trading configuration

- `LIVE_TRADING`: set to `true` to allow live capability checks
- `LIVE_TRADING_CONFIRM`: must equal `I_UNDERSTAND_THIS_PLACES_REAL_ORDERS`
- `HYPERLIQUID_PRIVATE_KEY`: private key used for Hyperliquid signing
- `HYPERLIQUID_TESTNET`: `true` to use Hyperliquid testnet
- `HYPERLIQUID_COIN`: defaults to `BTC`
- `LIVE_TIMEFRAME`: timeframe whose simulated leader is mirrored live, defaults to `5m`
- `LIVE_LEVERAGE`: cross leverage, defaults to `3`
- `LIVE_MAX_NOTIONAL_USD`: max live order size in USD, defaults to `50`
- `LIVE_SLIPPAGE_BPS`: IOC price buffer in basis points, defaults to `20`
- `TEST_LONG_USD`: size used by `/testlong`, defaults to `12`
- `LIVE_STATUS_TTL_MS`: cache lifetime for exchange-backed live status snapshots
- `LIVE_FILLS_LOOKBACK_MS`: fill-history lookback window for live fills
- `LIVE_FILLS_LIMIT`: maximum number of live fills returned in snapshots

### Optional Telegram behavior

- `TELEGRAM_TRADES_MODE`: `summary`, `leader`, or `all`

### Optional deterministic simulation seed

- `SIM_SEED`: fixed seed string for deterministic trader generation/evolution on fresh seeded runs

### Optional local API

- `API_ENABLED`: enable the local HTTP signals API
- `API_HOST`: bind host, defaults to `127.0.0.1`
- `API_PORT`: bind port, defaults to `3000`
- `API_BEARER_TOKEN`: optional bearer token for the local API

### Optional Telegram safety / UX

- `TELEGRAM_CONFIRM_ACTIONS`: require confirmation prompts for risky live actions
- `TELEGRAM_CONFIRM_TTL_MS`: confirmation timeout window in milliseconds
- `EVENT_BUFFER_LIMIT`: number of recent in-memory events retained for Telegram/API views

## Usage

### Start the bot

```bash
npm start
```

### Check syntax quickly

```bash
npm run check
```

### Get your Telegram chat ID

Run the helper and message `/id` to your bot:

```bash
npm run chat-id
```

## Telegram Commands

- `/start`: show the bot control panel
- `/live`: show the bot control panel
- `/help`: show available Telegram commands
- `/refresh`: refresh the main control panel
- `/status`: show overall bot status
- `/summary`: show timeframe summary
- `/leader`: show the current live candidate trader
- `/positions`: show simulated open positions
- `/recent`: show recent bot and live activity
- `/livestate`: show exchange-backed live account and position data
- `/livefills`: show recent exchange-backed live fills
- `/top`: show top traders
- `/replay`: show the last downtime replay summary
- `/save`: save trader state and runtime replay metadata
- `/evolve`: force one evolution cycle
- `/testlong`: place a small test long when live mode is disarmed
- `/testflat`: flatten the tracked live position
- `/id`: available through `getId.js` helper to discover your chat ID

## Runtime Outputs

- `traders_state.json`: persisted trader population state
- `bot_runtime_state.json`: replay/evolution metadata used to resume more faithfully after downtime
- `engine/logs/`: dashboard snapshots written on refresh intervals
- terminal dashboard: top traders, timeframe stats, and population metrics

## Local Signals API

When `API_ENABLED=true`, the bot also exposes a local read-only HTTP API for status and signal consumers.

Recommended local-only setup:

```bash
API_ENABLED=true
API_HOST=127.0.0.1
API_PORT=3000
```

Available endpoints:

- `GET /healthz`
- `GET /status`
- `GET /summary`
- `GET /leader`
- `GET /top?limit=10`
- `GET /positions?limit=20`
- `GET /live`
- `GET /live/fills?limit=20`
- `GET /signals/current`
- `GET /signals/recent?limit=20`
- `GET /replay`

Sample usage:

```bash
curl http://127.0.0.1:3000/healthz
curl http://127.0.0.1:3000/status
curl http://127.0.0.1:3000/leader
curl http://127.0.0.1:3000/live
curl http://127.0.0.1:3000/live/fills?limit=10
curl http://127.0.0.1:3000/signals/recent?limit=10
```

If `API_BEARER_TOKEN` is set, send it as:

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" http://127.0.0.1:3000/status
```

The API is read-only in this phase. Admin actions such as live toggle, test orders, save, and evolve remain Telegram/operator-only.

## Restart Behavior

- restored traders keep their evolved timeframe assignments instead of being redistributed
- missed closed candles are fetched from Binance and replayed before live streams attach
- replay metadata is persisted so future restarts can continue from the last processed candle
- seeded RNG state is persisted so future evolutions can replay more faithfully after restart
- if `bot_runtime_state.json` does not exist yet, the first upgraded restart begins tracking from that point onward

## Operator vs Public Surface

- Telegram is the private operator console for save/evolve/live/test/flat and richer monitoring
- HTTP is the public local consumer surface for health, leaders, positions, replay status, and recent signals
- both surfaces read from the same in-process runtime state

## Live-Trading Safety

Live trading is intentionally hard to enable:

1. `LIVE_TRADING` must be set to `true`
2. `LIVE_TRADING_CONFIRM` must exactly match the required confirmation string
3. a valid `HYPERLIQUID_PRIVATE_KEY` must be present
4. you still need to arm live trading from the Telegram control panel

When live trading is turned off, the executor closes the tracked live position and disarms itself.

## Default Strategy Behavior

The active strategy in `bot.js` is `strategyV2`, which combines:

- EMA trend alignment
- pullback detection
- G-factor conviction threshold
- optional contrarian inversion per trader

There is also a more selective `strategyV3` in the repo, but it is not the default entry strategy at the moment.

## Current Limitations

- there are no automated tests yet
- `traders_state.json` is currently a tracked file, so simulation state changes will appear in git status
- strategy selection is hard-coded in `bot.js`
- persistence is file-based only
- exact deterministic replay is improved, but still depends on identical candle data, config, and restart metadata being present
- there is no formal process manager configuration included yet

## Suggested Next Improvements

- add automated tests for strategy evaluation, risk targets, and trader state transitions
- move runtime state into a dedicated data directory
- make strategy selection configurable through `config.js` or env
- add a process manager config such as `systemd`, `pm2`, or Docker

## Warning

This software can place live orders if you enable it. Use testnet first, keep size limits small, and review every live-trading setting before arming it.
