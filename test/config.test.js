import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("getDevConfig rejects DB_DEV_CONNECTION_STRING inside dot env", async () => {
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
            /Il file \.env non puo' contenere DB_DEV_CONNECTION_STRING/
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

test("getDevConfig rejects case-variant DB_DEV_CONNECTION_STRING entries from dot env", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "llm-db-dev-config-"));
    const originalCwd = process.cwd();
    const originalEnv = process.env.DB_DEV_CONNECTION_STRING;

    try {
        process.chdir(tempDir);
        fs.writeFileSync(path.join(tempDir, ".env"), "db_dev_connection_string=from-dot-env-lower\n");
        delete process.env.DB_DEV_CONNECTION_STRING;

        const moduleUrl = new URL(`../src/lib/config.js?case=${Date.now()}-lowercase`, import.meta.url);
        const configModule = await import(moduleUrl);

        assert.throws(
            () => configModule.getDevConfig(),
            /Il file \.env non puo' contenere db_dev_connection_string/i
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

test("getDevConfig still rejects dot env secret even when runtime env is present", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "llm-db-dev-config-"));
    const originalCwd = process.cwd();
    const originalEnv = process.env.DB_DEV_CONNECTION_STRING;

    try {
        process.chdir(tempDir);
        fs.writeFileSync(path.join(tempDir, ".env"), "DB_DEV_CONNECTION_STRING=from-dot-env\n");
        process.env.DB_DEV_CONNECTION_STRING = "Server=runtime;";

        const moduleUrl = new URL(`../src/lib/config.js?case=${Date.now()}-reject-even-with-runtime`, import.meta.url);
        const configModule = await import(moduleUrl);

        assert.throws(
            () => configModule.getDevConfig(),
            /Il file \.env non puo' contenere DB_DEV_CONNECTION_STRING/
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

test("getDevConfig normalizes allowed host casing", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "llm-db-dev-config-"));
    const originalCwd = process.cwd();
    const originalEnv = process.env.DB_DEV_CONNECTION_STRING;
    const originalHosts = process.env.MCP_DEV_ALLOWED_HOSTS;

    try {
        process.chdir(tempDir);
        process.env.DB_DEV_CONNECTION_STRING = "Server=runtime;";
        process.env.MCP_DEV_ALLOWED_HOSTS = "LocalHost,EXAMPLE.internal,LOCALHOST";

        const moduleUrl = new URL(`../src/lib/config.js?case=${Date.now()}-hosts`, import.meta.url);
        const configModule = await import(moduleUrl);
        const config = configModule.getDevConfig();

        assert.deepEqual(config.server.allowedHosts, ["localhost", "example.internal"]);
    } finally {
        process.chdir(originalCwd);
        if (originalEnv === undefined) {
            delete process.env.DB_DEV_CONNECTION_STRING;
        } else {
            process.env.DB_DEV_CONNECTION_STRING = originalEnv;
        }
        if (originalHosts === undefined) {
            delete process.env.MCP_DEV_ALLOWED_HOSTS;
        } else {
            process.env.MCP_DEV_ALLOWED_HOSTS = originalHosts;
        }
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});
