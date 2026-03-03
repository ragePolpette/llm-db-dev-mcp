import sql from "mssql";

let poolPromise;

function mapParameters(request, parameters) {
    if (!parameters || typeof parameters !== "object") return;
    for (const [key, value] of Object.entries(parameters)) {
        request.input(key, value);
    }
}

async function getPool(connectionString) {
    if (!connectionString) {
        throw new Error("Connection string non configurata (DB_DEV_CONNECTION_STRING).");
    }
    if (!poolPromise) {
        const pool = new sql.ConnectionPool(connectionString);
        poolPromise = pool.connect();
    }
    return poolPromise;
}

export async function runReadQuery({ connectionString, sqlText, parameters, maxRows }) {
    const pool = await getPool(connectionString);
    const request = pool.request();
    mapParameters(request, parameters);
    const result = await request.query(sqlText);
    const rows = Array.isArray(result.recordset) ? result.recordset.slice(0, maxRows) : [];
    return {
        rows,
        rowCount: rows.length,
        truncated: Array.isArray(result.recordset) && result.recordset.length > maxRows
    };
}

export async function runWriteQuery({ connectionString, sqlText, parameters }) {
    const pool = await getPool(connectionString);
    const request = pool.request();
    mapParameters(request, parameters);
    const result = await request.query(sqlText);
    return {
        rowsAffected: result.rowsAffected || [],
        output: result.output || {}
    };
}
