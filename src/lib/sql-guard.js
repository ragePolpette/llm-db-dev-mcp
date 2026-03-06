const READ_ONLY_START = /^\s*(select|with)\b/i;
const FORBIDDEN_KEYWORDS = /\b(insert|update|delete|merge|alter|drop|truncate|create|exec|execute|grant|revoke|deny)\b/i;
const HARD_BLOCKED_WRITE_KEYWORDS = /\b(delete|drop|exec|execute)\b/i;
const WRITE_KEYWORDS = /\b(insert|update|merge|alter|truncate|create)\b/i;

function sanitizeSqlInput(sql) {
    if (typeof sql !== "string" || sql.trim() === "") {
        throw new Error("SQL non valido: stringa vuota.");
    }

    const trimmed = sql.trim();
    const withoutTrailingSemicolon = trimmed.endsWith(";") ? trimmed.slice(0, -1).trim() : trimmed;

    // Blocca multi-statement.
    if (withoutTrailingSemicolon.includes(";")) {
        throw new Error("SQL non valido: è consentita una sola istruzione per richiesta.");
    }

    return withoutTrailingSemicolon;
}

export function assertReadOnlySql(sql) {
    const normalized = sanitizeSqlInput(sql);
    if (!READ_ONLY_START.test(normalized)) {
        throw new Error("Solo query di lettura sono consentite (SELECT / WITH).");
    }
    if (FORBIDDEN_KEYWORDS.test(normalized)) {
        throw new Error("Query bloccata: contiene parole chiave non consentite in sola lettura.");
    }
    return normalized;
}

export function assertWriteSql(sql) {
    const normalized = sanitizeSqlInput(sql);
    if (HARD_BLOCKED_WRITE_KEYWORDS.test(normalized)) {
        throw new Error("Query bloccata: DELETE, DROP, EXEC ed EXECUTE sono sempre vietati in db_dev_write.");
    }
    if (!WRITE_KEYWORDS.test(normalized)) {
        throw new Error("Query di scrittura non valida: nessuna operazione write rilevata.");
    }
    return normalized;
}
