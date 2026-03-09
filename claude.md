# claude.md — llm-db-dev-mcp

## Project summary

Server MCP (Model Context Protocol) in Node.js per l'accesso a un **database SQL Server di sviluppo**.
Espone 3 tool: lettura sempre consentita, scrittura solo con conferma utente esplicita, `DELETE` e `DROP` sempre bloccati a livello di guard SQL.
Trasporto HTTP su `127.0.0.1:8781/mcp`. Progetto MCP del monorepo Yetzirah; il runtime è in `Binah`.

## Quickstart

```bash
cd llm-db-dev-mcp

# Configura env
cp config.local.example.env .env
# Edita .env: imposta DB_DEV_CONNECTION_STRING

# Installa dipendenze
npm install

# Avvia server
npm start
# → http://127.0.0.1:8781/mcp
```

## Architecture overview

```
Client MCP (Claude / npx mcp-remote)
    |  HTTP POST /mcp
    v
server.js  (entry point, setup MCP + HTTP)
    |
lib/
    |-- sqlGuard.js    (validazione SQL: blocco keyword pericolose)
    |-- dbClient.js    (connessione mssql)
    |-- tools/
         |-- read.js   (db_dev_read: solo SELECT/WITH)
         |-- write.js  (db_dev_write: write con conferma utente)
         |-- info.js   (db_dev_info: descrizione MCP)
```

## Key modules / folders

| Percorso | Ruolo |
|---|---|
| `src/server.js` | Entry point: inizializza MCP SDK + HTTP server |
| `src/lib/` | Guard SQL, client DB, implementazione tool |
| `config/` | Esempi configurazione MCP client |
| `config.local.example.env` | Template variabili ambiente |

## Dependencies & tooling

- **Runtime**: Node.js (ESM, `"type": "module"`)
- **MCP SDK**: `@modelcontextprotocol/sdk ^1.12.0`
- **DB driver**: `mssql ^11.0.1`
- **Build**: nessuno (JS diretto)
- **Test**: Non determinabile dai file presenti (nessuna directory `tests/` o script test in `package.json`)

## Configuration

| Variabile | Default | Note |
|---|---|---|
| `DB_DEV_CONNECTION_STRING` | — | **Obbligatoria** |
| `DB_DEV_MAX_ROWS` | `500` | Limite righe risultato |
| `MCP_DEV_HOST` | `127.0.0.1` | |
| `MCP_DEV_PORT` | `8781` | |
| `MCP_DEV_PATH` | `/mcp` | |
| `MCP_DEV_SSE_ENABLED` | `false` | Se false, GET /mcp → 405 |
| `MCP_DEV_ALLOWED_HOSTS` | `localhost,127.0.0.1,[::1]` | |
| `MCP_DEV_ALLOWED_ORIGINS` | loopback wildcard porta | |
| `MCP_MODELS_DIR` | `.local/models` | Asset modello locale |

## Common commands

```bash
# Avvio server
npm start
# equivale a: node src/server.js

# Avvio tramite launcher monorepo
powershell -ExecutionPolicy Bypass -File ../tools/start-mcp-db.ps1 -Mode dev

# Test compliance MCP transport
powershell -ExecutionPolicy Bypass -File ../tools/test-mcp-transport-compliance.ps1
```

## Operational notes

- **Porta DEV**: 8781. Non cambiare senza aggiornare launcher e compliance test.
- Configurazione client consigliata: `type=stdio` + `npx mcp-remote http://127.0.0.1:8781/mcp`.
- Il server non espone SSE per default (`MCP_DEV_SSE_ENABLED=false`): `GET /mcp` → 405.
- Regola sicurezza: la conferma utente (`confirmedByUser=true`) per write è verificata lato server, non solo client.
- Deploy: tramite `tools/deploy-mcp-dev-to-deploy.ps1` → copia in `Binah\llm-db-dev-mcp`.

## Known issues / risks

- **Nessun test automatizzato** identificato nel progetto.
- `DELETE` e `DROP` bloccati da guard SQL, ma `TRUNCATE` non è esplicitamente menzionato nei README: verificare `sqlGuard.js`.
- La connection string è l'unico segreto critico: assicurarsi non sia mai committata in `.env`.
- Assenza di rate limiting o circuit breaker per query DB.

## Roadmap / next actions

1. **(S)** Verificare che `TRUNCATE` sia bloccato dal guard SQL in `sqlGuard.js`
2. **(M)** Aggiungere test automatizzati (almeno guard SQL e validazione tool input)
3. **(S)** Aggiungere `package.json` script `test` per standardizzare CI
4. **(M)** Aggiungere rate limiting per prevenire query abuse
5. **(S)** Documentare esempi di connection string valide nel `README`
