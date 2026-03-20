const http = require("http");
const { URL } = require("url");

function json(res, statusCode, body) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body, null, 2));
}

function unauthorized(res) {
  json(res, 401, { ok: false, error: "Unauthorized" });
}

function normalizeToken(headerValue) {
  if (!headerValue) return "";
  const [scheme, token] = String(headerValue).split(" ");
  if (String(scheme).toLowerCase() !== "bearer") return "";
  return token || "";
}

function startApiServer({ runtime, host = "127.0.0.1", port = 3000, bearerToken = "" }) {
  if (!runtime) {
    throw new Error("startApiServer requires a runtime object");
  }

  const requireAuth = !!bearerToken;

  const server = http.createServer(async (req, res) => {
    try {
      if (requireAuth) {
        const token = normalizeToken(req.headers.authorization);
        if (token !== bearerToken) {
          return unauthorized(res);
        }
      }

      const url = new URL(req.url, `http://${req.headers.host || `${host}:${port}`}`);
      const path = url.pathname;
      const limit = Number(url.searchParams.get("limit") || 10);

      if (req.method !== "GET") {
        return json(res, 405, { ok: false, error: "Method not allowed" });
      }

      if (path === "/healthz") {
        return json(res, 200, {
          ok: true,
          name: "tradingbot-signals-api",
          uptimeSec: Math.round(process.uptime()),
          status: await runtime.getHealth(),
        });
      }

      if (path === "/status") {
        return json(res, 200, { ok: true, data: await runtime.getStatus() });
      }

      if (path === "/summary") {
        return json(res, 200, { ok: true, data: await runtime.getSummary() });
      }

      if (path === "/leader") {
        return json(res, 200, { ok: true, data: await runtime.getCurrentLeader() });
      }

      if (path === "/top") {
        return json(res, 200, { ok: true, data: await runtime.getTopTraders(limit) });
      }

      if (path === "/positions") {
        return json(res, 200, { ok: true, data: await runtime.getOpenPositions(limit) });
      }

      if (path === "/live") {
        return json(res, 200, { ok: true, data: await runtime.getLiveState(false) });
      }

      if (path === "/live/fills") {
        return json(res, 200, { ok: true, data: await runtime.getLiveFills(limit, false) });
      }

      if (path === "/signals/current") {
        return json(res, 200, { ok: true, data: await runtime.getCurrentSignals() });
      }

      if (path === "/signals/recent") {
        return json(res, 200, { ok: true, data: await runtime.getRecentTradeEvents(limit) });
      }

      if (path === "/replay") {
        return json(res, 200, { ok: true, data: await runtime.getReplayStatus() });
      }

      return json(res, 404, {
        ok: false,
        error: "Not found",
        endpoints: [
          "/healthz",
          "/status",
          "/summary",
          "/leader",
          "/top?limit=10",
          "/positions?limit=20",
          "/live",
          "/live/fills?limit=20",
          "/signals/current",
          "/signals/recent?limit=20",
          "/replay",
        ],
      });
    } catch (err) {
      return json(res, 500, {
        ok: false,
        error: err.message || String(err),
      });
    }
  });

  server.listen(Number(port), host, () => {
    console.log(`API listening on http://${host}:${port}`);
  });

  return {
    server,
    stop() {
      return new Promise((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
  };
}

module.exports = { startApiServer };
