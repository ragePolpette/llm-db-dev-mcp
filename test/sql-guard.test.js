import test from "node:test";
import assert from "node:assert/strict";
import { assertReadOnlySql, assertWriteSql } from "../src/lib/sql-guard.js";

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

test("read guard allows semicolons inside literals and comments", () => {
    assert.equal(
        assertReadOnlySql("SELECT ';' AS marker -- ; semicolon in comment"),
        "SELECT ';' AS marker -- ; semicolon in comment"
    );
    assert.equal(
        assertReadOnlySql("SELECT 1 /* ; comment semicolon */"),
        "SELECT 1 /* ; comment semicolon */"
    );
});

test("read guard rejects real multi statement sql", () => {
    assert.throws(
        () => assertReadOnlySql("SELECT 1; SELECT 2"),
        /una sola istruzione/
    );
});

test("write guard ignores keywords inside strings and comments", () => {
    assert.equal(
        assertWriteSql("UPDATE T SET Note = 'exec drop ;' WHERE Id = @id"),
        "UPDATE T SET Note = 'exec drop ;' WHERE Id = @id"
    );
    assert.equal(
        assertWriteSql("UPDATE T SET Name = @name /* exec drop */ WHERE Id = @id"),
        "UPDATE T SET Name = @name /* exec drop */ WHERE Id = @id"
    );
});
