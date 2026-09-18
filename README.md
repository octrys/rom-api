# rom-api

Backend for the **ROM: Golden Age** emulator, split into two services that run
independently (TLS is handled later by a reverse proxy — these speak plain HTTP):

| Service | Role | Default | Hostname (behind proxy) |
|---|---|---|---|
| **auth** | Identity + registration. Issues `userCode` for guest/google/apple; owns the accounts DB. | `:8001` | `auth.romgoldenage.com` |
| **region** | Regional game API. Issues per-login `sessionKey`/`accountId` and the world list; validates every `userCode` against **auth**. | `:8002` | `live-auth-region-<code>.romgoldenage.com` |

The CDN (static patch files, `domaindata.json`) stays separate and is not part
of this repo. The raw game socket (`:17701`) is the Python emulator in the
reverse-engineering repo.

## Flow

```
client --POST /v1/auth/guest/authorize------> auth    -> userCode          (account created/loaded)
client --POST /api/worldList----------------> region  -> world list
client --POST /api/authLogin {userCode}-----> region
                                               region --GET /internal/accounts/<userCode>--> auth
                                               region  -> sessionKey + accountId (session persisted)
client --raw TCP :17701 (accountCode=userCode, sessionKey)--> game server
```

auth owns identity (`accountId`, `userCode`); region owns the ephemeral
`sessionKey`. The only cross-service call is region → auth `/internal` to
validate a `userCode` — region **fails closed** if auth does not recognise it.

## Endpoints

**auth**
- `POST /v1/auth/pc/:provider/start` → `{ result, state, authUrl }` (offline: authUrl points at our own `/authorize`)
- `GET  /v1/auth/pc/:provider/authorize` → completion HTML calling `localhost:<callbackPort>/auth`
- `POST /v1/auth/guest/authorize` → `{ result, state, userCode }`
- `POST /v1/auth/pc/:provider/auth` → `{ result, state, userCode }` (google/apple)
- `GET  /internal/accounts/:userCode` → `{ accountId, userCode, idpCode }` | 404 (region only)

**region**
- `POST /api/worldList` → world list (`worldListData` is a **stringified** json)
- `POST /api/worldList:cross` → light cross-region list
- `POST /api/authLogin` → `{ sessionKey, accountId, worldListData, ... }` (`worldListData` is an **object**)
- `GET  /internal/sessions/:sessionKey` → `{ sessionKey, accountId, userCode, worldId, expiresAt }` | 404 — reusable session validation for the game server
- `POST /internal/sessions/:sessionKey/consume` → same payload, but marks the session single-use (second call → 404)

The game server validates a connecting client by calling one of the two
`/internal/sessions` routes and checking the returned `userCode` matches the
`accountCode` sent on the game socket. Use `GET` for reusable validation, `POST
.../consume` for one-time.

## Run

```bash
npm install
# dev (auto-reload)
npm run auth:dev
npm run region:dev
# build + run
npm run build
npm run auth:run
npm run region:run
```

Config lives in [config/default.json](config/default.json); missing keys fall
back to the built-in defaults in `src/config.ts`. SQLite files are created under
`storage/`.
