# llm-db-dev-mcp

MCP server per DB di sviluppo SQL Server.

Regole implementate:
- Lettura: sempre consentita (`db_dev_read`).
- Scrittura: consentita solo se:
1. richiesta con `confirmedByUser=true`
2. `confirmationToken` valido
3. token mostrato all'avvio server (se non impostato in env viene generato random per sessione)

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

Server esposto in locale su `http://127.0.0.1:8781/sse` (configurabile via env).
Configurazione client consigliata: `type=stdio` + `npx mcp-remote`.

## Variabili ambiente

- `DB_DEV_CONNECTION_STRING` (obbligatoria)
- `DB_DEV_MAX_ROWS` (default `500`)
- `DB_DEV_WRITE_CONFIRMATION_TOKEN` (opzionale: se vuoto viene generato random per sessione)
- `MCP_DEV_HOST` (default `127.0.0.1`)
- `MCP_DEV_PORT` (default `8781`)
- `MCP_DEV_PATH` (default `/sse`)
- `MCP_MODELS_DIR` (default `.local/models`, convenzione comune per asset modello locali non tracciati)

## Tool esposti

- `db_dev_read`
  - SQL consentita: solo `SELECT` / `WITH`.
  - Blocca keyword write/admin (`INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `EXEC`, ...).
- `db_dev_write`
  - Query write con conferma esplicita.

## Esempio configurazione MCP (Codex/Client)

File: `config/mcp.servers.example.json`
