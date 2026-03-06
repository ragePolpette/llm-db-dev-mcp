import test from "node:test";
import assert from "node:assert/strict";
import { assertWriteSql } from "../src/lib/sql-guard.js";

test("write guard blocks EXEC and EXECUTE", () => {
    assert.throws(
        () => assertWriteSql("INSERT INTO AuditLog(output) EXEC xp_cmdshell 'dir'"),
        /DELETE, DROP, EXEC ed EXECUTE/
    );
    assert.throws(
        () => assertWriteSql("UPDATE T SET Name = 'ok' EXECUTE dbo.RunSomething"),
        /DELETE, DROP, EXEC ed EXECUTE/
    );
});

test("write guard still allows basic update statements", () => {
    assert.equal(
        assertWriteSql("UPDATE T SET Name = @name WHERE Id = @id"),
        "UPDATE T SET Name = @name WHERE Id = @id"
    );
});
