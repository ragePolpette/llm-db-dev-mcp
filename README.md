# llm-db-dev-mcp

MCP server per DB di sviluppo SQL Server.

Regole implementate:
- Lettura: sempre consentita (`db_dev_read`).
- Scrittura: consentita solo se l'agente ha prima ricevuto conferma esplicita utente in chat (`confirmedByUser=true`).
- Sicurezza hard-block: `DELETE` e `DROP` sono sempre vietati.

## Setup

1. Copia `.env.example` in `.env` (o imposta variabili ambiente).
2. Installa dipendenze:
```bash
npm install
```
3. Avvia server MCP:
```bash
npm start
```

Server esposto in locale su `http://127.0.0.1:8781/mcp` (configurabile via env).
Configurazione client consigliata: `type=stdio` + `npx mcp-remote`.

## Variabili ambiente

- `DB_DEV_CONNECTION_STRING` (obbligatoria)
- `DB_DEV_MAX_ROWS` (default `500`)
- `MCP_DEV_HOST` (default `127.0.0.1`)
- `MCP_DEV_PORT` (default `8781`)
- `MCP_DEV_PATH` (default `/mcp`)
- `MCP_DEV_SSE_ENABLED` (default `false`; se `false`, `GET /mcp` risponde `405`)
- `MCP_DEV_ALLOWED_HOSTS` (default `localhost,127.0.0.1,[::1]`)
- `MCP_DEV_ALLOWED_ORIGINS` (default localhost loopback con wildcard porta)
- `MCP_MODELS_DIR` (default `.local/models`, convenzione comune per asset modello locali non tracciati)

## Tool esposti

- `db_dev_read`
  - SQL consentita: solo `SELECT` / `WITH`.
  - Blocca keyword write/admin (`INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `EXEC`, ...).
- `db_dev_write`
  - Query write con conferma esplicita utente (nessun token richiesto).
  - `DELETE` e `DROP` sempre bloccati dal guard SQL.
- `db_dev_info`
  - Spiega scopo e limiti del MCP DB DEV.

## Esempio configurazione MCP (Codex/Client)

File: `config/mcp.servers.example.json`
