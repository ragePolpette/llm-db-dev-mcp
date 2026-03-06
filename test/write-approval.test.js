import test from "node:test";
import assert from "node:assert/strict";
import { createWriteApprovalStore } from "../src/lib/write-approval.js";

test("approval token is one-time and bound to sql plus parameters", () => {
    const approvals = createWriteApprovalStore({ ttlMs: 60000 });
    const { token } = approvals.issue({
        sqlText: "UPDATE T SET A = @value WHERE Id = @id",
        parameters: { id: 1, value: "x" },
        reason: "test"
    });

    const approval = approvals.consume({
        token,
        sqlText: "UPDATE T SET A = @value WHERE Id = @id",
        parameters: { value: "x", id: 1 }
    });

    assert.equal(approval.reason, "test");
    assert.throws(
        () =>
            approvals.consume({
                token,
                sqlText: "UPDATE T SET A = @value WHERE Id = @id",
                parameters: { id: 1, value: "x" }
            }),
        /non valido o scaduto/
    );
});

test("approval token rejects mismatched sql or parameters", () => {
    const approvals = createWriteApprovalStore({ ttlMs: 60000 });
    const { token } = approvals.issue({
        sqlText: "INSERT INTO T(Name) VALUES (@name)",
        parameters: { name: "ok" }
    });

    assert.throws(
        () =>
            approvals.consume({
                token,
                sqlText: "INSERT INTO T(Name) VALUES (@other)",
                parameters: { name: "ok" }
            }),
        /non valido per questa SQL/
    );
});
