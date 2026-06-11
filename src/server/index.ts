import { createApp } from "@mchen-lab/app-kit/backend";
import { GostManager } from "./gostManager.js";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import { HttpProxyAgent } from "http-proxy-agent";
import type { Request, Response } from "express";
import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Config Types ---

interface SystemSettings {
  noProxy: boolean;
  strategy: string; // round, random, fifo, slow-round
  maxRetries: number;
  timeout: number;
  proxyUsername?: string;
  proxyPassword?: string;
  slowRotateSeconds?: number;
}

interface GlobalConfig {
  system: SystemSettings;
  proxies: string[];
  testUrls: string[];
}

// Default config
const defaultConfig: GlobalConfig = {
  system: {
    noProxy: false,
    strategy: "round",
    maxRetries: 1,
    timeout: 10,
    slowRotateSeconds: 30
  },
  proxies: [],
  testUrls: [
    "https://api.ipify.org?format=json",
    "https://www.google.com"
  ]
};

// Initialize AppKit
const appKit = createApp({
  appName: "Gost Proxy Service",
  defaultConfig: defaultConfig,
  disableStatic: true, // We serve our own static files
  recreateMissingConfig: true,
});

const app = appKit.app;
let globalConfig = appKit.config as GlobalConfig;

// Environment Variables
const PORT = process.env.PORT || 31130;  // Web UI + Backend API
const GOST_API_URL = process.env.GOST_API_URL || "http://127.0.0.1:31132";  // GOST internal API
const GOST_PROXY_URL = process.env.GOST_PROXY_URL || "http://127.0.0.1:31131";  // GOST proxy server
const isProduction = process.env.NODE_ENV === "production";

// Parse GOST proxy URL
const proxyUrlParsed = new URL(GOST_PROXY_URL);
const GOST_PROXY_HOST = proxyUrlParsed.hostname;
const GOST_PROXY_PORT = parseInt(proxyUrlParsed.port) || 8080;

// --- Log Infrastructure ---

const logsDir = appKit.getLogsDir();
const logFilePath = path.resolve(logsDir, "app.log");

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  success?: boolean;
}

const logs: LogEntry[] = [];
const MAX_LOGS = 1000;
const wsClients: Set<WebSocket> = new Set();

function broadcastLog(log: LogEntry) {
  logs.push(log);
  if (logs.length > MAX_LOGS) {
    logs.splice(0, logs.length - MAX_LOGS);
  }

  // Write to log file if possible
  try {
    const logLine = `[${log.timestamp}] [${log.level}] ${log.message}${log.success !== undefined ? (log.success ? " ✅" : " ❌") : ""}\n`;
    fs.appendFileSync(logFilePath, logLine);
  } catch (err) {
    // Silently fail if log file writing fails
  }

  const message = JSON.stringify({ type: "log", data: log });
  wsClients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// Logger helper
export const logger = {
  info: (msg: string) => broadcastLog({ timestamp: new Date().toISOString(), level: "INFO", message: msg }),
  warn: (msg: string) => broadcastLog({ timestamp: new Date().toISOString(), level: "WARN", message: msg }),
  error: (msg: string) => broadcastLog({ timestamp: new Date().toISOString(), level: "ERROR", message: msg }),
  debug: (msg: string) => broadcastLog({ timestamp: new Date().toISOString(), level: "DEBUG", message: msg }),
};

// --- GOST Manager ---

const GOST_BINARY_PATH = process.env.GOST_BINARY_PATH || undefined;
const gostManager = new GostManager(GOST_BINARY_PATH);

function getGostEnv() { return {}; }

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, stopping...');
  await gostManager.stop();
  process.exit(0);
});

// --- GOST v3 Config Helpers ---

interface V3Node {
  name: string;
  addr: string;
  connector: {
    type: string;
  };
}

async function updateGostChain() {
  // If noProxy mode is enabled, force direct bypass regardless of proxy list
  const proxies = globalConfig.system.noProxy ? [] : (globalConfig.proxies || []);
  const nodes: V3Node[] = [];

  let auth;
  if (globalConfig.system.proxyUsername && globalConfig.system.proxyPassword) {
    auth = {
      username: globalConfig.system.proxyUsername,
      password: globalConfig.system.proxyPassword
    };
  }

  for (const line of proxies) {
    try {
      const parts = line.split("://");
      let protocol = "http";
      let remaining = line;

      if (parts.length > 1) {
        protocol = parts[0];
        remaining = parts[1];
      }

      if (!remaining || remaining.startsWith("#")) continue;

      let nodeAuth = auth;
      let nodeAddr = remaining;
      
      // Parse inline auth if present (e.g. user:pass@ip:port)
      if (remaining.includes('@')) {
        const atSplit = remaining.split('@');
        nodeAddr = atSplit[1];
        const authSplit = atSplit[0].split(':');
        if (authSplit.length >= 2) {
          nodeAuth = {
            username: authSplit[0],
            password: authSplit.slice(1).join(':')
          };
        }
      }

      nodes.push({
        name: `proxy-${nodes.length}`,
        addr: nodeAddr,
        connector: { 
          type: protocol,
          ...(nodeAuth && { auth: nodeAuth })
        }
      });
    } catch {
      console.warn("Failed to parse proxy line:", line);
    }
  }

  // Direct bypass mode - no upstream proxies, just passthrough
  if (nodes.length === 0) {
    const directServicePayload = {
      name: "proxy-service",
      addr: `:${GOST_PROXY_PORT}`,
      handler: { type: "http" },  // No chain = direct connection
      listener: { type: "tcp" }
    };

    try {
      // Remove any existing chain
      try { await axios.delete(`${GOST_API_URL}/config/chains/upstream-chain`); } catch { }
      // Remove and recreate service in direct mode
      try { await axios.delete(`${GOST_API_URL}/config/services/proxy-service`); } catch { }
      await axios.post(`${GOST_API_URL}/config/services`, directServicePayload);

      broadcastLog({
        timestamp: new Date().toISOString(),
        level: "INFO",
        message: "🔄 Running in DIRECT BYPASS mode (no upstream proxies)",
      });

      return 0;
    } catch (error) {
      console.error("Failed to setup direct bypass:", error);
      throw error;
    }
  }

  // Normal mode with upstream proxies
  const strategy = globalConfig.system.strategy || "round";
  let selectorStrategy = strategy;
  let activeNodes = nodes;

  if (strategy === "slow-round") {
    selectorStrategy = "round";
    if (nodes.length > 0) {
      const idx = currentProxyIndex % nodes.length;
      activeNodes = [nodes[idx]];
    }
  }

  const chainPayload = {
    name: "upstream-chain",
    hops: [{
      name: "hop-0",
      selector: {
        strategy: selectorStrategy,
        maxFails: globalConfig.system.maxRetries,
        failTimeout: `${globalConfig.system.timeout}s`
      },
      nodes: activeNodes
    }]
  };

  const servicePayload = {
    name: "proxy-service",
    addr: `:${GOST_PROXY_PORT}`,
    handler: {
      type: "http",
      chain: "upstream-chain"
    },
    listener: { type: "tcp" }
  };

  try {
    try { await axios.delete(`${GOST_API_URL}/config/chains/upstream-chain`); } catch { }
    await axios.post(`${GOST_API_URL}/config/chains`, chainPayload);
    try { await axios.delete(`${GOST_API_URL}/config/services/proxy-service`); } catch { }
    await axios.post(`${GOST_API_URL}/config/services`, servicePayload);

    if (strategy === "slow-round" && activeNodes.length > 0) {
      broadcastLog({
        timestamp: new Date().toISOString(),
        level: "INFO",
        message: `🔄 Active Proxy Node: ${activeNodes[0].addr} (Index ${currentProxyIndex % nodes.length})`,
      });
    } else {
      broadcastLog({
        timestamp: new Date().toISOString(),
        level: "INFO",
        message: `Updated GOST v3 config with ${nodes.length} proxies (Strategy: ${strategy})`,
      });
    }

    return nodes.length;
  } catch (error) {
    console.error("Failed to update GOST v3:", error);
    throw error;
  }
}

// --- Slow Rotation Timer State ---
let rotationInterval: NodeJS.Timeout | null = null;
let currentProxyIndex = 0;

function startSlowRotation() {
  if (rotationInterval) {
    clearInterval(rotationInterval);
    rotationInterval = null;
  }

  const strategy = globalConfig.system.strategy || "round";
  const noProxy = globalConfig.system.noProxy || false;
  const proxies = globalConfig.proxies || [];

  if (strategy === "slow-round" && !noProxy && proxies.length > 0) {
    const intervalSeconds = globalConfig.system.slowRotateSeconds || 30;
    broadcastLog({
      timestamp: new Date().toISOString(),
      level: "INFO",
      message: `⏱️ Starting Slow Rotation scheduler (every ${intervalSeconds} seconds)`,
    });
    rotationInterval = setInterval(async () => {
      currentProxyIndex++;
      try {
        await updateGostChain();
      } catch (error) {
        console.error("Failed to rotate proxy during slow rotation:", error);
      }
    }, intervalSeconds * 1000);
  }
}

// Setup proxy config (always runs - either with proxies or in direct bypass mode)
async function setupProxyConfig() {
  await new Promise(r => setTimeout(r, 2000));
  try {
    await updateGostChain();
    startSlowRotation();
  } catch (error) {
    console.error("❌ Failed to setup proxy config:", error);
  }
}

// --- GOST Log Handler ---
gostManager.setLogCallback((logLine: string) => {
  try {
    const parsed = JSON.parse(logLine);
    if (parsed.kind === "handler" && parsed.host) {
      const host = parsed.host || "unknown";
      const dst = parsed.dst || "direct";
      const msg = parsed.msg || "";
      if (msg.includes("<->")) {
        broadcastLog({
          timestamp: new Date().toISOString(),
          level: "GOST",
          message: `🔗 ${host} via ${dst}`,
        });
      }
    }
  } catch {
    if (logLine.includes("error") || logLine.includes("Error")) {
      broadcastLog({
        timestamp: new Date().toISOString(), level: "ERROR", message: `GOST: ${logLine}`,
      });
    }
  }
});

// =============================================================================
// API Routes
// =============================================================================

// Get current proxies
app.get("/api/proxies", (_req: Request, res: Response) => {
  res.json({ proxies: globalConfig.proxies });
});

// Update proxies
app.post("/api/proxies", async (req: Request, res: Response) => {
  try {
    const { proxyList } = req.body;
    if (!proxyList || typeof proxyList !== "string") {
      res.status(400).json({ error: "proxyList is required" });
      return;
    }

    const lines = proxyList.split("\n");
    globalConfig.proxies = lines.filter(line => line.trim() && !line.trim().startsWith("#"));

    await updateGostChain();
    startSlowRotation();

    // Save via AppKit
    await appKit.saveConfig();

    res.json({ success: true, count: globalConfig.proxies.length });
  } catch (error: unknown) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// GOST-specific settings
app.post("/api/gost-settings", async (req: Request, res: Response) => {
  try {
    const settings = req.body;
    globalConfig.system = { ...globalConfig.system, ...settings };

    // Always update gost chain — handles both direct bypass (noProxy) and upstream proxy modes
    updateGostChain().then(() => startSlowRotation()).catch(err => console.error(err));

    await appKit.saveConfig();
    res.json({ success: true, settings: globalConfig.system });
  } catch {
    res.status(500).json({ error: "Failed to save settings" });
  }
});

// Test URLs
app.get("/api/test-urls", (_req: Request, res: Response) => {
  res.json({ urls: globalConfig.testUrls });
});

app.post("/api/test-urls", async (req: Request, res: Response) => {
  try {
    const { urls } = req.body;
    globalConfig.testUrls = urls;
    await appKit.saveConfig();
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Failed to save test URLs" });
  }
});

// Service Controls
app.post("/api/service/restart", async (_req, res) => {
  try {
    await gostManager.restart(undefined, getGostEnv());
    setupProxyConfig();
    res.json({ success: true });
  } catch { res.status(500).json({ error: "Failed to restart" }); }
});

app.post("/api/service/start", async (_req, res) => {
  try {
    gostManager.start(undefined, getGostEnv());
    setupProxyConfig();
    res.json({ success: true });
  } catch { res.status(500).json({ error: "Failed to start" }); }
});

app.post("/api/service/stop", async (_req, res) => {
  try {
    await gostManager.stop();
    res.json({ success: true });
  } catch { res.status(500).json({ error: "Failed to stop" }); }
});

// GOST Status
app.get("/api/gost-status", async (_req, res) => {
  const gostStatus = gostManager.getStatus();
  let apiResponding = false;
  try {
    await axios.get(`${GOST_API_URL}/config`, { timeout: 1000 });
    apiResponding = true;
  } catch { }
  res.json({
    online: gostStatus.running,
    proxyServiceReady: apiResponding && !globalConfig.system.noProxy && globalConfig.proxies.length > 0,
    proxyCount: globalConfig.system.noProxy ? 0 : globalConfig.proxies.length,
    noProxy: globalConfig.system.noProxy,
    gost: gostStatus
  });
});

// Logs
app.get("/api/logs", (_req, res) => res.json({ logs }));
app.post("/api/logs", (req: Request, res: Response) => {
  const { message, level, success } = req.body;
  if (!message) {
    res.status(400).json({ error: "Message is required" });
    return;
  }
  broadcastLog({
    timestamp: new Date().toISOString(),
    level: level || "INFO",
    message,
    success
  });
  res.json({ success: true });
});
app.delete("/api/logs", (_req, res) => { logs.length = 0; res.json({ success: true }); });

// Proxy Test endpoint
app.get("/api/test", async (req: Request, res: Response) => {
  const url = req.query.url as string;
  if (!url) return res.status(400).json({ error: "URL required" });

  try {
    const proxyUrl = `http://${GOST_PROXY_HOST}:${GOST_PROXY_PORT}`;
    const isHttps = url.startsWith('https://');
    const agent = isHttps ? new HttpsProxyAgent(proxyUrl) : new HttpProxyAgent(proxyUrl);

    const response = await axios.get(url, {
      httpAgent: isHttps ? undefined : agent,
      httpsAgent: isHttps ? agent : undefined,
      timeout: 10000,
      validateStatus: (status) => status >= 200 && status < 400,
    });

    res.json({ success: true, status: response.status, data: response.data });
  } catch (error: any) {
    res.json({ success: false, error: error.message });
  }
});

// =============================================================================
// Server Startup & Frontend Integration
// =============================================================================

async function start() {
  await appKit.initialize();
  globalConfig = appKit.config as GlobalConfig;

  const server = createServer(app);

  // WebSocket server for real-time logs
  const wss = new WebSocketServer({ server, path: "/ws/logs" });
  wss.on("connection", (ws: WebSocket) => {
    wsClients.add(ws);
    ws.send(JSON.stringify({ type: "history", data: logs }));
    ws.on("close", () => wsClients.delete(ws));
  });

  // Start GOST and setup proxy config
  gostManager.start(undefined, getGostEnv());
  setupProxyConfig();

  // Frontend Serving Logic
  if (isProduction) {
    const distPath = path.join(__dirname, "../../dist");
    app.use(express.static(distPath));
    app.get("*", (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  } else {
    try {
      const vite = await import("vite");
      const frontendDir = path.resolve(__dirname, "../frontend");
      const viteServer = await vite.createServer({
        server: {
          middlewareMode: true,
          hmr: { server }
        },
        appType: "spa",
        root: frontendDir,
        configFile: path.resolve(frontendDir, "../../vite.config.ts"),
      });

      app.use((req, res, next) => {
        if (req.path.startsWith("/api") || req.path.startsWith("/ws")) {
          return next();
        }
        viteServer.middlewares(req, res, next);
      });

      console.log("🔥 Hot reload enabled via Vite Middleware");
    } catch (e) {
      console.error("Failed to start Vite middleware", e);
    }
  }

  server.on("error", (err: any) => {
    if (err.code === "EADDRINUSE") {
      console.error(`❌ Port ${PORT} is already in use.`);
    } else {
      console.error(`❌ Server error: ${err.message}`);
    }
  });

  server.listen(Number(PORT), "0.0.0.0", () => {
    console.log(`🚀 Gost Proxy Service running on http://localhost:${PORT}`);
    logger.info("Server started successfully");
  });
}

start().catch((err) => console.error("Startup failed", err));
