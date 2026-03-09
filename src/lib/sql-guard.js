const READ_ONLY_START = /^\s*(select|with)\b/i;
const FORBIDDEN_KEYWORDS = /\b(insert|update|delete|merge|alter|drop|truncate|create|exec|execute|grant|revoke|deny)\b/i;
const HARD_BLOCKED_WRITE_KEYWORDS = /\b(delete|drop|exec|execute)\b/i;
const WRITE_KEYWORDS = /\b(insert|update|merge|alter|truncate|create)\b/i;

function stripSqlCommentsAndLiterals(sql) {
    let out = "";
    let state = "normal";

    for (let i = 0; i < sql.length; i += 1) {
        const char = sql[i];
        const next = sql[i + 1];

        if (state === "normal") {
            if (char === "'" ) {
                state = "single-quote";
                out += " ";
                continue;
            }
            if (char === "\"") {
                state = "double-quote";
                out += " ";
                continue;
            }
            if (char === "[") {
                state = "bracket-identifier";
                out += " ";
                continue;
            }
            if (char === "-" && next === "-") {
                state = "line-comment";
                out += "  ";
                i += 1;
                continue;
            }
            if (char === "/" && next === "*") {
                state = "block-comment";
                out += "  ";
                i += 1;
                continue;
            }
            out += char;
            continue;
        }

        if (state === "single-quote") {
            if (char === "'" && next === "'") {
                out += "  ";
                i += 1;
                continue;
            }
            out += " ";
            if (char === "'") {
                state = "normal";
            }
            continue;
        }

        if (state === "double-quote") {
            out += " ";
            if (char === "\"") {
                state = "normal";
            }
            continue;
        }

        if (state === "bracket-identifier") {
            out += " ";
            if (char === "]") {
                state = "normal";
            }
            continue;
        }

        if (state === "line-comment") {
            out += char === "\n" ? "\n" : " ";
            if (char === "\n") {
                state = "normal";
            }
            continue;
        }

        if (state === "block-comment") {
            if (char === "*" && next === "/") {
                out += "  ";
                i += 1;
                state = "normal";
                continue;
            }
            out += char === "\n" ? "\n" : " ";
        }
    }

    return out;
}

function sanitizeSqlInput(sql) {
    if (typeof sql !== "string" || sql.trim() === "") {
        throw new Error("SQL non valido: stringa vuota.");
    }

    const trimmed = sql.trim();
    const analyzed = stripSqlCommentsAndLiterals(trimmed).trim();
    const withoutTrailingSemicolon = analyzed.endsWith(";") ? analyzed.slice(0, -1).trim() : analyzed;

    // Blocca multi-statement.
    if (withoutTrailingSemicolon.includes(";")) {
        throw new Error("SQL non valido: è consentita una sola istruzione per richiesta.");
    }

    return {
        original: trimmed,
        analyzed: withoutTrailingSemicolon
    };
}

export function assertReadOnlySql(sql) {
    const normalized = sanitizeSqlInput(sql);
    if (!READ_ONLY_START.test(normalized.analyzed)) {
        throw new Error("Solo query di lettura sono consentite (SELECT / WITH).");
    }
    if (FORBIDDEN_KEYWORDS.test(normalized.analyzed)) {
        throw new Error("Query bloccata: contiene parole chiave non consentite in sola lettura.");
    }
    return normalized.original;
}

export function assertWriteSql(sql) {
    const normalized = sanitizeSqlInput(sql);
    if (HARD_BLOCKED_WRITE_KEYWORDS.test(normalized.analyzed)) {
        throw new Error("Query bloccata: DELETE, DROP, EXEC ed EXECUTE sono sempre vietati in db_dev_write.");
    }
    if (!WRITE_KEYWORDS.test(normalized.analyzed)) {
        throw new Error("Query di scrittura non valida: nessuna operazione write rilevata.");
    }
    return normalized.original;
}
