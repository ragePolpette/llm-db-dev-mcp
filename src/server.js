import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, isInitializeRequest, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { getDevConfig } from "./lib/config.js";
import { runReadQuery, runWriteQuery } from "./lib/db-client.js";
import { assertReadOnlySql, assertWriteSql } from "./lib/sql-guard.js";
import { createSessionStore } from "./lib/session-store.js";

const config = getDevConfig();
const sessions = createSessionStore({ ttlMs: config.sessionTtlMs });

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

function createMcpServer() {
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
        tools: [
            {
                name: "db_dev_read",
                description: "DB DEV: sola lettura SQL (SELECT/WITH). Usare per analisi e verifica dati in ambiente di sviluppo.",
                inputSchema: {
                    type: "object",
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
                    idempotentHint: false
                },
                inputSchema: {
                    type: "object",
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
                inputSchema: {
                    type: "object",
                    properties: {}
                }
            }
        ]
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;

        if (name === "db_dev_read") {
            const sqlText = assertReadOnlySql(args?.sql);
            const maxRows = Math.max(1, Math.min(Number(args?.maxRows || config.maxRows), 5000));
            const result = await runReadQuery({
                connectionString: config.connectionString,
                sqlText,
                parameters: args?.parameters,
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
            const result = await runWriteQuery({
                connectionString: config.connectionString,
                sqlText,
                parameters: args?.parameters,
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

        if (name === "db_dev_info") {
            return asTextResult({
                server: "llm-db-dev-mcp",
                purpose: "Accesso SQL al DB di sviluppo (analisi + write dirette).",
                capabilities: [
                    "db_dev_read: SELECT/WITH",
                    "db_dev_write: INSERT/UPDATE/MERGE/ALTER/TRUNCATE/CREATE diretti, con DELETE/DROP/EXEC/EXECUTE sempre bloccati"
                ],
                constraints: [
                    "DELETE, DROP, EXEC ed EXECUTE sono sempre vietati",
                    "SQL write validata da sql-guard prima dell'esecuzione"
                ]
            });
        }

        throw new Error(`Tool non supportato: ${name}`);
    });

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

function withOriginValidation(req, res, next) {
    const origin = normalizeHeaderValue(req.headers.origin);
    if (!origin) {
        next();
        return;
    }
    if (!isOriginAllowed(origin, config.server.allowedOrigins)) {
        res.status(403).json(createErrorResponse("Forbidden: Origin not allowed"));
        return;
    }
    res.set("Vary", "Origin");
    res.set("Access-Control-Allow-Origin", origin);
    next();
}

function sendCorsPreflight(res) {
    res.set("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Accept, mcp-session-id");
    res.set("Access-Control-Max-Age", "600");
    res.status(204).send();
}

function sendMissingSession(res) {
    res.status(400).json(createErrorResponse("Bad Request: Missing session ID"));
}

function sendUnknownSession(res) {
    res.status(404).json(createErrorResponse("Not Found: Invalid or expired session ID"));
}

const app = createMcpExpressApp({
    host: config.server.host,
    allowedHosts: config.server.allowedHosts?.length ? config.server.allowedHosts : undefined
});
app.use(withOriginValidation);
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
        activeSessions: sessions.size()
    });
});

app.post(config.server.path, async (req, res) => {
    const rawSessionId = req.headers["mcp-session-id"];
    const sessionId = normalizeHeaderValue(rawSessionId);
    const hasSessionHeader = rawSessionId !== undefined;
    let transport;

    try {
        if (sessionId) {
            transport = sessions.get(sessionId);
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
            const server = createMcpServer();
            transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: () => randomUUID(),
                enableJsonResponse: !config.server.sseEnabled,
                onsessioninitialized: sid => {
                    sessions.set(sid, transport);
                }
            });

            transport.onclose = () => {
                const sid = transport.sessionId;
                if (sid) {
                    sessions.delete(sid);
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
    const transport = sessionId ? sessions.get(sessionId) : null;
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
    const transport = sessionId ? sessions.get(sessionId) : null;
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

app.listen(config.server.port, config.server.host, error => {
    if (error) {
        console.error("Failed to start llm-db-dev-mcp:", error);
        process.exit(1);
    }
    console.log(
        `llm-db-dev-mcp listening at http://${config.server.host}:${config.server.port}${config.server.path}`
    );
    console.log("[SECURITY] DELETE, DROP, EXEC ed EXECUTE sono sempre bloccati da sql-guard.");
});
