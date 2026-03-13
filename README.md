# llm-db-dev-mcp

Questo progetto e' destinato a vivere come **repository standalone** dentro il workspace DEV `Yetzirah`.
Il runtime locale, quando deployato, resta in `Binah\llm-db-dev-mcp`.

MCP server HTTP per DB di sviluppo SQL Server.

Regole implementate:
- Lettura: consentita con `db_dev_read` su query `SELECT/WITH`.
- Scrittura: consentita con `db_dev_write` su operazioni `INSERT/UPDATE/MERGE/ALTER/TRUNCATE/CREATE`.
- Sicurezza hard-block: `DELETE`, `DROP`, `EXEC` e `EXECUTE` sono sempre vietati.
- Input invalidi dei tool restituiti come **tool execution errors** MCP, non come protocol errors.

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
I file `.env.example` / `config.local.example.env` non devono contenere il segreto DB DEV.

Server esposto in locale su `http://127.0.0.1:8781/mcp` (configurabile via env).
Configurazione client consigliata: `type=stdio` + `npx mcp-remote`.

## Variabili ambiente

- `DB_DEV_CONNECTION_STRING` (obbligatoria, solo runtime/process env)
- `DB_DEV_MAX_ROWS` (default `500`)
- `DB_DEV_QUERY_TIMEOUT_MS` (default `9000`)
- `MCP_DEV_SESSION_TTL_MS` (default `1800000`)
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
  - Valida i parametri SQL e blocca keyword write/admin.
- `db_dev_write`
  - SQL consentita: `INSERT/UPDATE/MERGE/ALTER/TRUNCATE/CREATE`.
  - `DELETE`, `DROP`, `EXEC` ed `EXECUTE` sempre bloccati dal guard SQL.
- `db_dev_info`
  - Spiega scopo e limiti del MCP DB DEV.

## Esempio configurazione MCP (Codex/Client)

File: `config/mcp.servers.example.json`

## Note operative

- `DB_DEV_CONNECTION_STRING` va passata nel processo di avvio o dal launcher esterno, non salvata nel repo.
- Le sessioni MCP inattive decadono automaticamente dopo `MCP_DEV_SESSION_TTL_MS`.
- `MCP_DEV_ALLOWED_HOSTS` viene normalizzato in lowercase per evitare mismatch dovuti al casing.
- Le richieste browser devono poter inviare `MCP-Protocol-Version`; il server espone anche `MCP-Session-Id` via CORS.
