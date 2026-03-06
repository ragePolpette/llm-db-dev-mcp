import test from "node:test";
import assert from "node:assert/strict";
import { createWriteApprovalStore } from "../src/lib/write-approval.js";

test("approval token is one-time and bound to sql plus parameters", () => {
    const approvals = createWriteApprovalStore({ ttlMs: 60000 });
    const { approvalId, challenge } = approvals.issue({
        sqlText: "UPDATE T SET A = @value WHERE Id = @id",
        parameters: { id: 1, value: "x" },
        reason: "test"
    });

    const { token } = approvals.confirm({ approvalId, challenge });

    const approval = approvals.consumeExecution({
        token,
        sqlText: "UPDATE T SET A = @value WHERE Id = @id",
        parameters: { value: "x", id: 1 }
    });

    assert.equal(approval.reason, "test");
    assert.throws(
        () =>
            approvals.consumeExecution({
                token,
                sqlText: "UPDATE T SET A = @value WHERE Id = @id",
                parameters: { id: 1, value: "x" }
            }),
        /non valido o scaduto/
    );
});

test("approval token rejects mismatched sql or parameters", () => {
    const approvals = createWriteApprovalStore({ ttlMs: 60000 });
    const { approvalId, challenge } = approvals.issue({
        sqlText: "INSERT INTO T(Name) VALUES (@name)",
        parameters: { name: "ok" }
    });
    const { token } = approvals.confirm({ approvalId, challenge });

    assert.throws(
        () =>
            approvals.consumeExecution({
                token,
                sqlText: "INSERT INTO T(Name) VALUES (@other)",
                parameters: { name: "ok" }
            }),
        /non valido per questa SQL/
    );
});

test("approval token expires after ttl", () => {
    const approvals = createWriteApprovalStore({ ttlMs: 1000 });
    const originalNow = Date.now;
    let approvalId;
    let challenge;

    try {
        Date.now = () => 1000;
        ({ approvalId, challenge } = approvals.issue({
            sqlText: "UPDATE T SET Name = @name WHERE Id = @id",
            parameters: { id: 1, name: "ok" }
        }));
    } finally {
        Date.now = originalNow;
    }

    assert.throws(
        () =>
            approvals.confirm(
                {
                    approvalId,
                    challenge
                },
                2001
            ),
        /non valida o scaduta/
    );
});

test("approval requires out-of-band challenge before issuing execution token", () => {
    const approvals = createWriteApprovalStore({ ttlMs: 60000 });
    const { approvalId } = approvals.issue({
        sqlText: "UPDATE T SET A = @value WHERE Id = @id",
        parameters: { id: 1, value: "x" }
    });

    assert.throws(
        () => approvals.confirm({ approvalId, challenge: "WRONG" }),
        /Challenge di conferma non valida/
    );
});
