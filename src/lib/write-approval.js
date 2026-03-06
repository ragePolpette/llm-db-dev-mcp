import { randomUUID } from "node:crypto";

function stableSerialize(value) {
    if (value === null || typeof value !== "object") {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map(stableSerialize).join(",")}]`;
    }
    return `{${Object.keys(value)
        .sort()
        .map(key => `${JSON.stringify(key)}:${stableSerialize(value[key])}`)
        .join(",")}}`;
}

export function createWriteApprovalStore({ ttlMs = 5 * 60 * 1000 } = {}) {
    const approvals = new Map();

    function nowMs() {
        return Date.now();
    }

    function purgeExpired(now = nowMs()) {
        for (const [token, approval] of approvals.entries()) {
            if (approval.expiresAt <= now) {
                approvals.delete(token);
            }
        }
    }

    return {
        issue({ sqlText, parameters, reason }) {
            purgeExpired();
            const token = randomUUID();
            const issuedAt = nowMs();
            approvals.set(token, {
                sqlText,
                parametersDigest: stableSerialize(parameters || {}),
                reason: String(reason || "").trim(),
                issuedAt,
                expiresAt: issuedAt + ttlMs
            });
            return {
                token,
                expiresAt: new Date(issuedAt + ttlMs).toISOString()
            };
        },
        consume({ token, sqlText, parameters }, now = nowMs()) {
            purgeExpired(now);
            const approval = approvals.get(token);
            if (!approval) {
                throw new Error("Token di approvazione non valido o scaduto.");
            }
            approvals.delete(token);
            if (approval.sqlText !== sqlText) {
                throw new Error("Token di approvazione non valido per questa SQL.");
            }
            if (approval.parametersDigest !== stableSerialize(parameters || {})) {
                throw new Error("Token di approvazione non valido per questi parametri.");
            }
            return approval;
        }
    };
}
