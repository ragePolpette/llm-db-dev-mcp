import path from "node:path";
import os from "node:os";

function toInt(value, fallback) {
    const parsed = parseInt(value, 10);
    return Number.isNaN(parsed) ? fallback : parsed;
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
    return list.length ? list : [...fallback];
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
        out.push(raw);
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

export function getDevConfig() {
    const localFallback = getLocalHostFallback();
    const modelsDirRaw = process.env.MCP_MODELS_DIR || ".local/models";
    const modelsDir = path.isAbsolute(modelsDirRaw)
        ? modelsDirRaw
        : path.resolve(process.cwd(), modelsDirRaw);

    return {
        connectionString: process.env.DB_DEV_CONNECTION_STRING || "",
        maxRows: Math.max(1, Math.min(toInt(process.env.DB_DEV_MAX_ROWS, 500), 5000)),
        queryTimeoutMs: Math.max(1000, Math.min(toInt(process.env.DB_DEV_QUERY_TIMEOUT_MS, 9000), 60000)),
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
