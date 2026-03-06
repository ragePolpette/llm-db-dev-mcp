import sql from "mssql";
import { isIP } from "node:net";

let poolPromise;

function mapParameters(request, parameters) {
    if (!parameters || typeof parameters !== "object") return;
    for (const [key, value] of Object.entries(parameters)) {
        request.input(key, value);
    }
}

function normalizeHostForIpCheck(hostValue) {
    const raw = String(hostValue || "").trim();
    if (!raw) return "";
    const withoutBrackets = raw.startsWith("[") && raw.endsWith("]") ? raw.slice(1, -1) : raw;
    const base = withoutBrackets.split("\\")[0].split(",")[0].trim();
    return base;
}

function disableSniForIpServer(pool) {
    const host = normalizeHostForIpCheck(pool?.config?.server);
    if (!host || isIP(host) === 0) return;
    pool.config.options = pool.config.options || {};
    pool.config.options.serverName = "localhost";
}

async function getPool(connectionString) {
    if (!connectionString) {
        throw new Error("Connection string non configurata (DB_DEV_CONNECTION_STRING).");
    }
    if (!poolPromise) {
        const pool = new sql.ConnectionPool(connectionString);
        disableSniForIpServer(pool);
        poolPromise = pool.connect();
    }
    return poolPromise;
}

export async function runReadQuery({ connectionString, sqlText, parameters, maxRows, queryTimeoutMs }) {
    const pool = await getPool(connectionString);
    const request = pool.request();
    if (Number.isFinite(queryTimeoutMs) && queryTimeoutMs > 0) {
        request.timeout = queryTimeoutMs;
    }
    mapParameters(request, parameters);
    const result = await request.query(sqlText);
    const rows = Array.isArray(result.recordset) ? result.recordset.slice(0, maxRows) : [];
    return {
        rows,
        rowCount: rows.length,
        truncated: Array.isArray(result.recordset) && result.recordset.length > maxRows
    };
}

export async function runWriteQuery({ connectionString, sqlText, parameters, queryTimeoutMs }) {
    const pool = await getPool(connectionString);
    const request = pool.request();
    if (Number.isFinite(queryTimeoutMs) && queryTimeoutMs > 0) {
        request.timeout = queryTimeoutMs;
    }
    mapParameters(request, parameters);
    const result = await request.query(sqlText);
    return {
        rowsAffected: result.rowsAffected || [],
        output: result.output || {}
    };
}

