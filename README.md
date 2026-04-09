# llm-db-dev-mcp

> [!WARNING]
> Deprecated repository.
> This project has been superseded by [`llm-sql-db-mcp`](https://github.com/ragePolpette/llm-sql-db-mcp), which unifies the previous dev/prod split into a single target-based SQL MCP server.
>
> Use `llm-sql-db-mcp` for new work. This repository is kept only as historical reference for the original development-only flow.

Questo progetto e' destinato a vivere come **repository standalone** dentro il workspace DEV `Yetzirah`.
Il runtime locale, quando deployato, resta in `runtime-root\llm-db-dev-mcp`.

MCP server per DB di sviluppo SQL Server.

Regole implementate:
- Lettura: sempre consentita (`db_dev_read`).
- Scrittura: consentita solo con `approvalToken` one-time emesso dopo conferma out-of-band con challenge locale.
- Sicurezza hard-block: `DELETE`, `DROP`, `EXEC` e `EXECUTE` sono sempre vietati.

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
Se `.env` contiene `DB_DEV_CONNECTION_STRING`, l'avvio fallisce esplicitamente per evitare secret locali persistenti.
I file `.env.example` / `config.local.example.env` non devono contenere il segreto DB DEV.

Server esposto in locale su `http://127.0.0.1:8781/mcp` (configurabile via env).
Configurazione client consigliata: `type=stdio` + `npx mcp-remote`.

## Variabili ambiente

- `DB_DEV_CONNECTION_STRING` (obbligatoria, solo runtime/process env)
- `DB_DEV_MAX_ROWS` (default `500`)
- `DB_DEV_QUERY_TIMEOUT_MS` (default `9000`)
- `DB_DEV_WRITE_APPROVAL_TTL_MS` (default `300000`)
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
  - Blocca keyword write/admin (`INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `EXEC`, ...).
- `db_dev_write`
  - Query write consentita solo con token di approvazione emesso dopo conferma out-of-band.
  - `DELETE`, `DROP`, `EXEC` ed `EXECUTE` sempre bloccati dal guard SQL.
- `db_dev_request_write_approval`
  - Prepara una write, valida la SQL e restituisce `approvalId`; il challenge viene mostrato solo nel log del server.
- `db_dev_confirm_write_approval`
  - Converte `approvalId` + challenge locale in `approvalToken` one-time per l'esecuzione.
- `db_dev_info`
  - Spiega scopo e limiti del MCP DB DEV.

## Esempio configurazione MCP (Codex/Client)

File: `config/mcp.servers.example.json`

## Flusso write sicuro

1. Chiamare `db_dev_request_write_approval` con SQL, parametri e motivo.
2. Leggere il `challenge` solo dal log locale del server; non viene restituito al chiamante MCP.
3. Solo dopo conferma umana reale, chiamare `db_dev_confirm_write_approval` con `approvalId` + `challenge` per ottenere `approvalToken`.
4. Chiamare `db_dev_write` con la stessa SQL, gli stessi parametri e `approvalToken`.
5. Se il token scade o SQL/parametri cambiano, richiedere una nuova approvazione.

## Note operative

- `DB_DEV_CONNECTION_STRING` va passata nel processo di avvio o dal launcher esterno, non salvata nel repo.
- Il bootstrap rifiuta `.env` se contiene `DB_DEV_CONNECTION_STRING`, anche se la stessa variabile e' presente nel process env.
- Le sessioni MCP inattive decadono automaticamente dopo `MCP_DEV_SESSION_TTL_MS`.
- `MCP_DEV_ALLOWED_HOSTS` viene normalizzato in lowercase per evitare mismatch dovuti al casing.
