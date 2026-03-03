import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, isInitializeRequest, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { getDevConfig } from "./lib/config.js";
import { runReadQuery, runWriteQuery } from "./lib/db-client.js";
import { assertReadOnlySql, assertWriteSql } from "./lib/sql-guard.js";

const config = getDevConfig();
const sessionWriteConfirmationToken = config.writeConfirmationToken || randomUUID();

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
                description: "Esegue query SQL di sola lettura sul DB di sviluppo (SELECT/WITH).",
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
                description: "Esegue query di scrittura sul DB di sviluppo SOLO con conferma esplicita.",
                inputSchema: {
                    type: "object",
                    properties: {
                        sql: { type: "string", description: "Query SQL di scrittura (INSERT/UPDATE/DELETE/...)." },
                        parameters: {
                            type: "object",
                            description: "Parametri query (key/value).",
                            additionalProperties: true
                        },
                        confirmedByUser: {
                            type: "boolean",
                            description: "Deve essere true solo dopo conferma utente."
                        },
                        confirmationToken: {
                            type: "string",
                            description: "Token di conferma scrittura."
                        },
                        reason: {
                            type: "string",
                            description: "Motivazione della modifica."
                        }
                    },
                    required: ["sql", "confirmedByUser", "confirmationToken"]
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
                maxRows
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
            if (!args?.confirmedByUser) {
                throw new Error("Scrittura bloccata: serve conferma esplicita dell'utente (confirmedByUser=true).");
            }
            if (args?.confirmationToken !== sessionWriteConfirmationToken) {
                throw new Error("Scrittura bloccata: confirmationToken non valido.");
            }

            const sqlText = assertWriteSql(args?.sql);
            const result = await runWriteQuery({
                connectionString: config.connectionString,
                sqlText,
                parameters: args?.parameters
            });

            return asTextResult({
                success: true,
                mode: "write",
                reason: args?.reason || "",
                rowsAffected: result.rowsAffected,
                output: result.output
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

const app = createMcpExpressApp({ host: config.server.host });
const transports = {};

app.get("/health", (_req, res) => {
    res.json({
        status: "ok",
        server: "llm-db-dev-mcp",
        endpoint: config.server.path
    });
});

app.post(config.server.path, async (req, res) => {
    const sessionId = req.headers["mcp-session-id"];
    let transport;

    try {
        if (sessionId && transports[sessionId]) {
            transport = transports[sessionId];
            await transport.handleRequest(req, res, req.body);
            return;
        }

        if (!sessionId && isInitializeRequest(req.body)) {
            const server = createMcpServer();
            transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: () => randomUUID(),
                onsessioninitialized: sid => {
                    transports[sid] = transport;
                }
            });

            transport.onclose = () => {
                const sid = transport.sessionId;
                if (sid && transports[sid]) {
                    delete transports[sid];
                }
            };

            await server.connect(transport);
            await transport.handleRequest(req, res, req.body);
            return;
        }

        res.status(400).json(createErrorResponse("Bad Request: No valid session ID provided"));
    } catch (error) {
        const message = error instanceof Error ? error.message : "Internal server error";
        if (!res.headersSent) {
            res.status(500).json(createErrorResponse(message));
        }
    }
});

app.get(config.server.path, async (req, res) => {
    const sessionId = req.headers["mcp-session-id"];
    if (!sessionId || !transports[sessionId]) {
        res.status(400).send("Invalid or missing session ID");
        return;
    }

    try {
        await transports[sessionId].handleRequest(req, res);
    } catch (error) {
        if (!res.headersSent) {
            const message = error instanceof Error ? error.message : "Internal server error";
            res.status(500).send(message);
        }
    }
});

app.delete(config.server.path, async (req, res) => {
    const sessionId = req.headers["mcp-session-id"];
    if (!sessionId || !transports[sessionId]) {
        res.status(400).send("Invalid or missing session ID");
        return;
    }

    try {
        await transports[sessionId].handleRequest(req, res);
    } catch (error) {
        if (!res.headersSent) {
            const message = error instanceof Error ? error.message : "Internal server error";
            res.status(500).send(message);
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
    console.log("[SECURITY] db_dev_write richiede conferma esplicita utente + confirmationToken.");
    console.log(`[SECURITY] confirmationToken sessione: ${sessionWriteConfirmationToken}`);
});
