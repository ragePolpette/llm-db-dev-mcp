import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("getDevConfig requires DB_DEV_CONNECTION_STRING from runtime env", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "llm-db-dev-config-"));
    const originalCwd = process.cwd();
    const originalEnv = process.env.DB_DEV_CONNECTION_STRING;

    try {
        process.chdir(tempDir);
        fs.writeFileSync(path.join(tempDir, ".env"), "DB_DEV_CONNECTION_STRING=from-dot-env\n");
        delete process.env.DB_DEV_CONNECTION_STRING;

        const moduleUrl = new URL(`../src/lib/config.js?case=${Date.now()}`, import.meta.url);
        const configModule = await import(moduleUrl);

        assert.throws(
            () => configModule.getDevConfig(),
            /DB_DEV_CONNECTION_STRING deve essere fornita a runtime/
        );
    } finally {
        process.chdir(originalCwd);
        if (originalEnv === undefined) {
            delete process.env.DB_DEV_CONNECTION_STRING;
        } else {
            process.env.DB_DEV_CONNECTION_STRING = originalEnv;
        }
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test("getDevConfig accepts DB_DEV_CONNECTION_STRING from process env", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "llm-db-dev-config-"));
    const originalCwd = process.cwd();
    const originalEnv = process.env.DB_DEV_CONNECTION_STRING;

    try {
        process.chdir(tempDir);
        process.env.DB_DEV_CONNECTION_STRING = "Server=runtime;";

        const moduleUrl = new URL(`../src/lib/config.js?case=${Date.now()}-env`, import.meta.url);
        const configModule = await import(moduleUrl);
        const config = configModule.getDevConfig();

        assert.equal(config.connectionString, "Server=runtime;");
    } finally {
        process.chdir(originalCwd);
        if (originalEnv === undefined) {
            delete process.env.DB_DEV_CONNECTION_STRING;
        } else {
            process.env.DB_DEV_CONNECTION_STRING = originalEnv;
        }
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});
