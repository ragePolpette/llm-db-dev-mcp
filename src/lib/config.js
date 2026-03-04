import path from "node:path";

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

export function getDevConfig() {
    const modelsDirRaw = process.env.MCP_MODELS_DIR || ".local/models";
    const modelsDir = path.isAbsolute(modelsDirRaw)
        ? modelsDirRaw
        : path.resolve(process.cwd(), modelsDirRaw);

    return {
        connectionString: process.env.DB_DEV_CONNECTION_STRING || "",
        maxRows: Math.max(1, Math.min(toInt(process.env.DB_DEV_MAX_ROWS, 500), 5000)),
        modelsDir,
        server: {
            host: process.env.MCP_DEV_HOST || "127.0.0.1",
            port: Math.max(1, Math.min(toInt(process.env.MCP_DEV_PORT, 8781), 65535)),
            path: process.env.MCP_DEV_PATH || "/mcp",
            sseEnabled: toBool(process.env.MCP_DEV_SSE_ENABLED, false),
            allowedHosts: parseCsvList(
                process.env.MCP_DEV_ALLOWED_HOSTS,
                ["localhost", "127.0.0.1", "[::1]"]
            ),
            allowedOrigins: parseCsvList(
                process.env.MCP_DEV_ALLOWED_ORIGINS,
                [
                    "http://localhost:*",
                    "http://127.0.0.1:*",
                    "https://localhost:*",
                    "https://127.0.0.1:*"
                ]
            )
        },
    };
}
