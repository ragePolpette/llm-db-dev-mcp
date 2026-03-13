import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
    CallToolRequestSchema,
    ErrorCode,
    isInitializeRequest,
    ListToolsRequestSchema,
    McpError
} from "@modelcontextprotocol/sdk/types.js";
import { getDevConfig } from "./lib/config.js";
import { runReadQuery, runWriteQuery } from "./lib/db-client.js";
import { createSessionStore } from "./lib/session-store.js";
import { assertReadOnlySql, assertWriteSql } from "./lib/sql-guard.js";

const CORS_ALLOW_HEADERS = "Content-Type, Accept, MCP-Session-Id, MCP-Protocol-Version, Last-Event-ID";
const CORS_ALLOW_METHODS = "POST, GET, DELETE, OPTIONS";
const CORS_EXPOSE_HEADERS = "MCP-Session-Id";
const SUPPORTED_TOOL_NAMES = new Set(["db_dev_read", "db_dev_write", "db_dev_info"]);

function asTextResult(payload) {
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify(payload, null, 2)
            }
        ]
    };
}

function asToolError(message) {
    return {
        content: [
            {
                type: "text",
                text: message
            }
        ],
        isError: true
    };
}

function isAllowedParameterValue(value) {
    if (value === null) return true;
    if (value === undefined) return false;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
        return true;
    }
    if (value instanceof Date) return true;
    if (Buffer.isBuffer(value)) return true;
    return false;
}

function sanitizeParameters(input) {
    if (input === undefined || input === null) return undefined;
    if (typeof input !== "object" || Array.isArray(input)) {
        throw new Error("Parametro parameters non valido: oggetto key/value atteso.");
    }

    const entries = Object.entries(input);
    if (entries.length > 100) {
        throw new Error("Parametro parameters non valido: massimo 100 parametri.");
    }

    const out = {};
    for (const [key, value] of entries) {
        if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key)) {
            throw new Error(`Nome parametro SQL non valido: ${key}`);
        }
        if (!isAllowedParameterValue(value)) {
            throw new Error(`Valore parametro non supportato per '${key}'.`);
        }
        out[key] = value;
    }
    return out;
}

function parseMaxRows(value, fallback) {
    if (value === undefined || value === null || value === "") {
        return fallback;
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || !Number.isInteger(numeric)) {
        throw new Error("Parametro maxRows non valido: intero atteso.");
    }
    return Math.max(1, Math.min(numeric, 5000));
}

function createToolDefinitions(config) {
    return [
        {
            name: "db_dev_read",
            description: "DB DEV: sola lettura SQL (SELECT/WITH). Usare per analisi e verifica dati in ambiente di sviluppo.",
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false
            },
            inputSchema: {
                type: "object",
                additionalProperties: false,
                properties: {
                    sql: { type: "string", description: "Query SQL di lettura." },
                    parameters: {
                        type: "object",
                        description: "Parametri query (key/value).",
                        additionalProperties: true
                    },
                    maxRows: {
                        type: "integer",
                        description: `Numero massimo righe restituite (default ${config.maxRows}).`,
                        minimum: 1,
                        maximum: 5000
                    }
                },
                required: ["sql"]
            }
        },
        {
            name: "db_dev_write",
            description: "DB DEV: scrittura SQL diretta. DELETE, DROP, EXEC ed EXECUTE sono sempre bloccati dal guard SQL.",
            annotations: {
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: false,
                openWorldHint: false
            },
            inputSchema: {
                type: "object",
                additionalProperties: false,
                properties: {
                    sql: {
                        type: "string",
                        description: "Query SQL di scrittura consentita (INSERT/UPDATE/MERGE/ALTER/TRUNCATE/CREATE). DELETE e DROP vietati."
                    },
                    parameters: {
                        type: "object",
                        description: "Parametri query (key/value).",
                        additionalProperties: true
                    },
                    reason: {
                        type: "string",
                        description: "Motivazione della modifica."
                    }
                },
                required: ["sql"]
            }
        },
        {
            name: "db_dev_info",
            description: "Spiega scopo, limiti e regole operative del MCP DB DEV.",
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false
            },
            inputSchema: {
                type: "object",
                additionalProperties: false,
                properties: {}
            }
        }
    ];
}

function createToolHandler(config, dbOps) {
    return async (request) => {
        const { name, arguments: args } = request.params;
        if (!SUPPORTED_TOOL_NAMES.has(name)) {
            throw new McpError(ErrorCode.InvalidParams, `Tool non supportato: ${name}`);
        }

        try {
            if (name === "db_dev_read") {
                const sqlText = assertReadOnlySql(args?.sql);
                const maxRows = parseMaxRows(args?.maxRows, config.maxRows);
                const parameters = sanitizeParameters(args?.parameters);
                const result = await dbOps.runReadQuery({
                    connectionString: config.connectionString,
                    sqlText,
                    parameters,
                    maxRows,
                    queryTimeoutMs: config.queryTimeoutMs
                });
                return asTextResult({
                    success: true,
                    mode: "read",
                    rowCount: result.rowCount,
                    truncated: result.truncated,
                    rows: result.rows
                });
            }

            if (name === "db_dev_write") {
                const sqlText = assertWriteSql(args?.sql);
                const parameters = sanitizeParameters(args?.parameters);
                const result = await dbOps.runWriteQuery({
                    connectionString: config.connectionString,
                    sqlText,
                    parameters,
                    queryTimeoutMs: config.queryTimeoutMs
                });
                return asTextResult({
                    success: true,
                    mode: "write",
                    reason: args?.reason || "",
                    rowsAffected: result.rowsAffected,
                    output: result.output
                });
            }

            return asTextResult({
                server: "llm-db-dev-mcp",
                purpose: "Accesso SQL al DB di sviluppo (analisi + write dirette).",
                capabilities: [
                    "db_dev_read: SELECT/WITH",
                    "db_dev_write: INSERT/UPDATE/MERGE/ALTER/TRUNCATE/CREATE diretti, con DELETE/DROP/EXEC/EXECUTE sempre bloccati"
                ],
                constraints: [
                    "DELETE, DROP, EXEC ed EXECUTE sono sempre vietati",
                    "Parametri SQL validati prima dell'esecuzione",
                    "Gli errori di validazione vengono restituiti come tool execution errors"
                ]
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : "Errore interno durante l'esecuzione del tool.";
            return asToolError(message);
        }
    };
}

export function createMcpServer({
    config,
    dbOps = {
        runReadQuery,
        runWriteQuery
    }
}) {
    const toolDefinitions = createToolDefinitions(config);
    const server = new Server(
        {
            name: "llm-db-dev-mcp",
            version: "1.0.0"
        },
        {
            capabilities: {
                tools: {}
            }
        }
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: toolDefinitions
    }));
    server.setRequestHandler(CallToolRequestSchema, createToolHandler(config, dbOps));

    return server;
}

function createErrorResponse(message) {
    return {
        jsonrpc: "2.0",
        error: {
            code: -32000,
            message
        },
        id: null
    };
}

function normalizeHeaderValue(rawValue) {
    if (Array.isArray(rawValue)) {
        return typeof rawValue[0] === "string" ? rawValue[0].trim() : "";
    }
    return typeof rawValue === "string" ? rawValue.trim() : "";
}

function normalizeOrigin(origin) {
    try {
        const parsed = new URL(origin);
        const protocol = parsed.protocol.toLowerCase();
        const host = parsed.hostname.toLowerCase();
        if (!["http:", "https:"].includes(protocol) || !host) {
            return null;
        }
        return parsed.port ? `${protocol}//${host}:${parsed.port}` : `${protocol}//${host}`;
    } catch {
        return null;
    }
}

function isOriginAllowed(origin, allowedOrigins) {
    const normalizedOrigin = normalizeOrigin(origin);
    if (!normalizedOrigin) return false;
    for (const rawPattern of allowedOrigins) {
        const pattern = String(rawPattern || "").trim().toLowerCase();
        if (!pattern) continue;
        if (pattern === normalizedOrigin) return true;
        if (pattern.endsWith(":*")) {
            const prefix = pattern.slice(0, -2);
            if (normalizedOrigin.startsWith(`${prefix}:`)) {
                return true;
            }
        }
    }
    return false;
}

function withOriginValidationFactory(config) {
    return function withOriginValidation(req, res, next) {
        const origin = normalizeHeaderValue(req.headers.origin);
        if (!origin) {
            next();
            return;
        }
        if (!isOriginAllowed(origin, config.server.allowedOrigins)) {
            res.status(403).json(createErrorResponse("Forbidden: Origin not allowed"));
            return;
        }
        res.append("Vary", "Origin");
        res.set("Access-Control-Allow-Origin", origin);
        res.set("Access-Control-Expose-Headers", CORS_EXPOSE_HEADERS);
        next();
    };
}

function sendCorsPreflight(res) {
    res.set("Access-Control-Allow-Methods", CORS_ALLOW_METHODS);
    res.set("Access-Control-Allow-Headers", CORS_ALLOW_HEADERS);
    res.set("Access-Control-Max-Age", "600");
    res.status(204).send();
}

function sendMissingSession(res) {
    res.status(400).json(createErrorResponse("Bad Request: Missing session ID"));
}

function sendUnknownSession(res) {
    res.status(404).json(createErrorResponse("Not Found: Invalid or expired session ID"));
}

export function createApp({
    config,
    sessionStore = createSessionStore({ ttlMs: config.sessionTtlMs }),
    serverFactory = createMcpServer
}) {
    const app = createMcpExpressApp({
        host: config.server.host,
        allowedHosts: config.server.allowedHosts?.length ? config.server.allowedHosts : undefined
    });

    app.use(withOriginValidationFactory(config));
    app.options(config.server.path, (_req, res) => {
        sendCorsPreflight(res);
    });

    app.get("/health", (_req, res) => {
        res.json({
            status: "ok",
            server: "llm-db-dev-mcp",
            endpoint: config.server.path,
            pid: process.pid,
            uptimeSec: Math.floor(process.uptime()),
            activeSessions: sessionStore.size()
        });
    });

    app.post(config.server.path, async (req, res) => {
        const rawSessionId = req.headers["mcp-session-id"];
        const sessionId = normalizeHeaderValue(rawSessionId);
        const hasSessionHeader = rawSessionId !== undefined;
        let transport;

        try {
            if (sessionId) {
                transport = sessionStore.get(sessionId);
            }

            if (sessionId && transport) {
                await transport.handleRequest(req, res, req.body);
                return;
            }

            if (sessionId && !transport) {
                sendUnknownSession(res);
                return;
            }

            if (hasSessionHeader && !sessionId) {
                sendUnknownSession(res);
                return;
            }

            if (!sessionId && isInitializeRequest(req.body)) {
                const server = serverFactory({ config });
                transport = new StreamableHTTPServerTransport({
                    sessionIdGenerator: () => randomUUID(),
                    enableJsonResponse: !config.server.sseEnabled,
                    onsessioninitialized: sid => {
                        sessionStore.set(sid, transport);
                    }
                });

                transport.onclose = () => {
                    const sid = transport.sessionId;
                    if (sid) {
                        sessionStore.delete(sid);
                    }
                };

                await server.connect(transport);
                await transport.handleRequest(req, res, req.body);
                return;
            }

            sendMissingSession(res);
        } catch (error) {
            const message = error instanceof Error ? error.message : "Internal server error";
            if (!res.headersSent) {
                res.status(500).json(createErrorResponse(message));
            }
        }
    });

    app.get(config.server.path, async (req, res) => {
        if (!config.server.sseEnabled) {
            res.status(405).set("Allow", "POST, DELETE").send("Method Not Allowed");
            return;
        }

        const rawSessionId = req.headers["mcp-session-id"];
        if (rawSessionId === undefined) {
            sendMissingSession(res);
            return;
        }

        const sessionId = normalizeHeaderValue(rawSessionId);
        const transport = sessionId ? sessionStore.get(sessionId) : null;
        if (!sessionId || !transport) {
            sendUnknownSession(res);
            return;
        }

        try {
            await transport.handleRequest(req, res);
        } catch (error) {
            if (!res.headersSent) {
                const message = error instanceof Error ? error.message : "Internal server error";
                res.status(500).json(createErrorResponse(message));
            }
        }
    });

    app.delete(config.server.path, async (req, res) => {
        const rawSessionId = req.headers["mcp-session-id"];
        if (rawSessionId === undefined) {
            sendMissingSession(res);
            return;
        }

        const sessionId = normalizeHeaderValue(rawSessionId);
        const transport = sessionId ? sessionStore.get(sessionId) : null;
        if (!sessionId || !transport) {
            sendUnknownSession(res);
            return;
        }

        try {
            await transport.handleRequest(req, res);
        } catch (error) {
            if (!res.headersSent) {
                const message = error instanceof Error ? error.message : "Internal server error";
                res.status(500).json(createErrorResponse(message));
            }
        }
    });

    return { app, sessionStore };
}

export async function startServer({
    config = getDevConfig(),
    logger = console
} = {}) {
    const { app, sessionStore } = createApp({ config });

    return await new Promise((resolve, reject) => {
        const httpServer = app.listen(config.server.port, config.server.host, error => {
            if (error) {
                reject(error);
                return;
            }

            const address = httpServer.address();
            const actualPort = typeof address === "object" && address ? address.port : config.server.port;
            logger.log(
                `llm-db-dev-mcp listening at http://${config.server.host}:${actualPort}${config.server.path}`
            );
            logger.log("[SECURITY] DELETE, DROP, EXEC ed EXECUTE sono sempre bloccati da sql-guard.");
            resolve({
                app,
                sessionStore,
                httpServer,
                url: `http://${config.server.host}:${actualPort}${config.server.path}`
            });
        });

        httpServer.on("error", reject);
    });
}

export async function stopServer(httpServer) {
    if (!httpServer) return;
    await new Promise((resolve, reject) => {
        httpServer.close(error => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
    });
}

function isDirectRun() {
    return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isDirectRun()) {
    startServer().catch(error => {
        console.error("Failed to start llm-db-dev-mcp:", error);
        process.exit(1);
    });
}
