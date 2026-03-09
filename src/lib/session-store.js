export function createSessionStore({ ttlMs = 30 * 60 * 1000 } = {}) {
    const sessions = new Map();

    function prune(now = Date.now()) {
        for (const [sessionId, entry] of sessions.entries()) {
            if (entry.expiresAt <= now) {
                sessions.delete(sessionId);
            }
        }
    }

    function set(sessionId, transport, now = Date.now()) {
        prune(now);
        sessions.set(sessionId, {
            transport,
            expiresAt: now + ttlMs
        });
    }

    function get(sessionId, now = Date.now()) {
        prune(now);
        const entry = sessions.get(sessionId);
        if (!entry) {
            return null;
        }
        entry.expiresAt = now + ttlMs;
        return entry.transport;
    }

    function deleteSession(sessionId) {
        sessions.delete(sessionId);
    }

    return {
        set,
        get,
        delete: deleteSession,
        prune,
        size() {
            prune();
            return sessions.size;
        }
    };
}
