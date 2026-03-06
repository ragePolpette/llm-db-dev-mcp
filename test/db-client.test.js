import test from "node:test";
import assert from "node:assert/strict";
import { __resetPoolForTests, __setSqlDriverForTests, runReadQuery } from "../src/lib/db-client.js";

const originalDriver = {
    ConnectionPool: undefined
};

test("db client clears failed pool promise and retries", async () => {
    let attempts = 0;
    const pools = [];

    class FakePool {
        constructor(connectionString) {
            this.connectionString = connectionString;
            this.config = { server: "127.0.0.1" };
            this.closed = false;
            pools.push(this);
        }

        async connect() {
            attempts += 1;
            if (attempts === 1) {
                throw new Error("boom");
            }
            return {
                request: () => ({
                    query: async () => ({ recordset: [] })
                })
            };
        }

        async close() {
            this.closed = true;
        }
    }

    originalDriver.ConnectionPool = FakePool;
    __setSqlDriverForTests(originalDriver);
    __resetPoolForTests();

    await assert.rejects(
        () =>
            runReadQuery({
                connectionString: "Server=test;",
                sqlText: "SELECT 1",
                maxRows: 10
            }),
        /boom/
    );

    const result = await runReadQuery({
        connectionString: "Server=test;",
        sqlText: "SELECT 1",
        maxRows: 10
    });

    assert.equal(result.rowCount, 0);
    assert.equal(attempts, 2);
    assert.equal(pools[0].closed, true);
});
