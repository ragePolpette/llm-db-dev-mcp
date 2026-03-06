# llm-db-dev-mcp

MCP server per DB di sviluppo SQL Server.

Regole implementate:
- Lettura: sempre consentita (`db_dev_read`).
- Scrittura: consentita solo con `approvalToken` one-time emesso dal server.
- Sicurezza hard-block: `DELETE` e `DROP` sono sempre vietati.

## Setup

1. Installa dipendenze:
```bash
npm install
```
2. Esporta `DB_DEV_CONNECTION_STRING` nel processo di avvio.
3. Avvia server MCP:
```bash
$env:DB_DEV_CONNECTION_STRING="Server=127.0.0.1;Database=YourDevDb;User Id=your_user;Password=your_password;TrustServerCertificate=True;"
npm start
```

`DB_DEV_CONNECTION_STRING` deve essere fornita a runtime. Il server non la legge da `.env`.

Server esposto in locale su `http://127.0.0.1:8781/mcp` (configurabile via env).
Configurazione client consigliata: `type=stdio` + `npx mcp-remote`.

## Variabili ambiente

- `DB_DEV_CONNECTION_STRING` (obbligatoria, solo runtime/process env)
- `DB_DEV_MAX_ROWS` (default `500`)
- `DB_DEV_QUERY_TIMEOUT_MS` (default `9000`)
- `DB_DEV_WRITE_APPROVAL_TTL_MS` (default `300000`)
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
  - Query write consentita solo con token di approvazione emesso dal server.
  - `DELETE` e `DROP` sempre bloccati dal guard SQL.
- `db_dev_request_write_approval`
  - Prepara una write, valida la SQL e restituisce un token one-time per l'esecuzione.
- `db_dev_info`
  - Spiega scopo e limiti del MCP DB DEV.

## Esempio configurazione MCP (Codex/Client)

File: `config/mcp.servers.example.json`

## Flusso write sicuro

1. Chiamare `db_dev_request_write_approval` con SQL, parametri e motivo.
2. Ottenere `approvalToken` one-time dal server.
3. Solo dopo conferma umana reale, chiamare `db_dev_write` con la stessa SQL, gli stessi parametri e il token.
