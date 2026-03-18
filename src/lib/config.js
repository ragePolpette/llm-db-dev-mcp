import path from "node:path";
import os from "node:os";
import fs from "node:fs";

function toInt(value, fallback) {
    const parsed = parseInt(value, 10);
    return Number.isNaN(parsed) ? fallback : parsed;
}

function parseSessionTtlMs(value, fallback) {
    const parsed = toInt(value, fallback);
    if (parsed <= 0) {
        return 0;
    }
    return Math.max(60000, Math.min(parsed, 86400000));
}

function toBool(value, fallback = false) {
    if (value === undefined || value === null || value === "") return fallback;
    return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function parseCsvList(value, fallback) {
    if (value === undefined || value === null || value === "") return [...fallback];
    const list = String(value)
        .split(",")
        .map(item => item.trim())
        .filter(Boolean);
    return list.length ? uniqueLower(list) : [...fallback];
}

function uniqueLower(items) {
    const seen = new Set();
    const out = [];
    for (const item of items) {
        const raw = String(item || "").trim();
        if (!raw) continue;
        const lower = raw.toLowerCase();
        if (seen.has(lower)) continue;
        seen.add(lower);
        out.push(lower);
    }
    return out;
}

function getLocalHostFallback() {
    const hostname = String(os.hostname() || "").trim().toLowerCase();
    const hostCandidates = uniqueLower([
        "localhost",
        "127.0.0.1",
        "[::1]",
        hostname
    ]);

    const originCandidates = [];
    for (const host of hostCandidates) {
        if (!host || host === "[::1]") continue;
        originCandidates.push(`http://${host}:*`, `https://${host}:*`);
    }

    return {
        allowedHosts: hostCandidates,
        allowedOrigins: uniqueLower(originCandidates)
    };
}

let envLoaded = false;

function loadDotEnvFromCwd({ skipKeys = [], forbiddenKeys = [] } = {}) {
    if (envLoaded) return;
    envLoaded = true;
    const skipped = new Set(
        skipKeys.map(key => String(key || "").trim().toLowerCase()).filter(Boolean)
    );
    const forbidden = new Set(
        forbiddenKeys.map(key => String(key || "").trim().toLowerCase()).filter(Boolean)
    );

    const envPath = path.resolve(process.cwd(), ".env");
    if (!fs.existsSync(envPath)) return;

    const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
    for (const rawLine of lines) {
        const line = String(rawLine || "").trim();
        if (!line || line.startsWith("#")) continue;
        const idx = line.indexOf("=");
        if (idx <= 0) continue;

        const key = line.slice(0, idx).trim();
        const normalizedKey = key.toLowerCase();
        if (forbidden.has(normalizedKey)) {
            throw new Error(
                `Il file .env non puo' contenere ${key}: usa solo variabili runtime/process env per i segreti DB DEV.`
            );
        }
        if (skipped.has(normalizedKey)) {
            continue;
        }
        let value = line.slice(idx + 1);
        if (
            (value.startsWith("\"") && value.endsWith("\"")) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }

        if (!Object.prototype.hasOwnProperty.call(process.env, key) || process.env[key] === "") {
            process.env[key] = value;
        }
    }
}

export function getDevConfig() {
    loadDotEnvFromCwd({
        skipKeys: ["DB_DEV_CONNECTION_STRING"],
        forbiddenKeys: ["DB_DEV_CONNECTION_STRING"]
    });
    const localFallback = getLocalHostFallback();
    const modelsDirRaw = process.env.MCP_MODELS_DIR || ".local/models";
    const modelsDir = path.isAbsolute(modelsDirRaw)
        ? modelsDirRaw
        : path.resolve(process.cwd(), modelsDirRaw);
    const connectionString = String(process.env.DB_DEV_CONNECTION_STRING || "").trim();
    if (!connectionString) {
        throw new Error("DB_DEV_CONNECTION_STRING deve essere fornita a runtime; non viene letta da .env.");
    }

    return {
        connectionString,
        maxRows: Math.max(1, Math.min(toInt(process.env.DB_DEV_MAX_ROWS, 500), 5000)),
        queryTimeoutMs: Math.max(1000, Math.min(toInt(process.env.DB_DEV_QUERY_TIMEOUT_MS, 9000), 60000)),
        sessionTtlMs: parseSessionTtlMs(process.env.MCP_DEV_SESSION_TTL_MS, 0),
        modelsDir,
        server: {
            host: process.env.MCP_DEV_HOST || "127.0.0.1",
            port: Math.max(1, Math.min(toInt(process.env.MCP_DEV_PORT, 8781), 65535)),
            path: process.env.MCP_DEV_PATH || "/mcp",
            sseEnabled: toBool(process.env.MCP_DEV_SSE_ENABLED, false),
            allowedHosts: parseCsvList(
                process.env.MCP_DEV_ALLOWED_HOSTS,
                localFallback.allowedHosts
            ),
            allowedOrigins: parseCsvList(
                process.env.MCP_DEV_ALLOWED_ORIGINS,
                localFallback.allowedOrigins
            )
        },
    };
}

export function __resetEnvLoaderForTests() {
    envLoaded = false;
}
