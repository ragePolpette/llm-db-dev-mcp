import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

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
    const pendingApprovals = new Map();
    const executionTokens = new Map();

    function nowMs() {
        return Date.now();
    }

    function purgeExpired(now = nowMs()) {
        for (const [approvalId, approval] of pendingApprovals.entries()) {
            if (approval.expiresAt <= now) {
                pendingApprovals.delete(approvalId);
            }
        }
        for (const [token, approval] of executionTokens.entries()) {
            if (approval.expiresAt <= now) {
                executionTokens.delete(token);
            }
        }
    }

    function buildChallenge() {
        return randomBytes(4).toString("hex").toUpperCase();
    }

    function equalsToken(left, right) {
        const leftBuffer = Buffer.from(String(left || ""), "utf8");
        const rightBuffer = Buffer.from(String(right || ""), "utf8");
        if (leftBuffer.length !== rightBuffer.length) {
            return false;
        }
        return timingSafeEqual(leftBuffer, rightBuffer);
    }

    return {
        issue({ sqlText, parameters, reason }) {
            purgeExpired();
            const approvalId = randomUUID();
            const challenge = buildChallenge();
            const issuedAt = nowMs();
            pendingApprovals.set(approvalId, {
                challenge,
                sqlText,
                parametersDigest: stableSerialize(parameters || {}),
                reason: String(reason || "").trim(),
                issuedAt,
                expiresAt: issuedAt + ttlMs
            });
            return {
                approvalId,
                challenge,
                expiresAt: new Date(issuedAt + ttlMs).toISOString()
            };
        },
        confirm({ approvalId, challenge }, now = nowMs()) {
            purgeExpired(now);
            const approval = pendingApprovals.get(approvalId);
            if (!approval) {
                throw new Error("Richiesta di approvazione non valida o scaduta.");
            }
            if (!equalsToken(approval.challenge, challenge)) {
                throw new Error("Challenge di conferma non valida.");
            }
            pendingApprovals.delete(approvalId);
            const token = randomUUID();
            executionTokens.set(token, {
                sqlText: approval.sqlText,
                parametersDigest: approval.parametersDigest,
                reason: approval.reason,
                issuedAt: approval.issuedAt,
                approvedAt: now,
                expiresAt: approval.expiresAt
            });
            return {
                token,
                expiresAt: new Date(approval.expiresAt).toISOString()
            };
        },
        consumeExecution({ token, sqlText, parameters }, now = nowMs()) {
            purgeExpired(now);
            const approval = executionTokens.get(token);
            if (!approval) {
                throw new Error("Token di approvazione non valido o scaduto.");
            }
            executionTokens.delete(token);
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
