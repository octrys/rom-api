import fs from "fs";
import path from "path";

// Identity service: issues userCodes for guest/google/apple and owns account
// registration. authHost is the public hostname the reverse proxy exposes it
// on — it is baked into the OAuth authUrl handed back to the client.
export type AuthConfig = {
    host: string; // bind address
    port: number; // listen port
    authHost: string; // public hostname used to build the OAuth authUrl
    callbackPort: number; // client's local CodeListenerPC port (localhost)
    database: string; // sqlite file for accounts
    authTokenTtlSeconds: number; // lifetime of the single-use login/register token
    passwordMinLength: number; // minimum accepted password length on register
    passwordMaxLength: number; // maximum accepted password length (caps scrypt cost)
};

// A single game world as advertised to the client in the world list.
export type WorldConfig = {
    worldId: number; // serverId in the world list
    worldGroupId: number; // worldGroupId in the world list
    worldName: string; // serverName shown in the client
    orderId: number; // sort order in the list
    status: number; // serverStatus (0 = normal)
    congestion: number; // congestion indicator shown to the client
    newCreateUser: number; // 1 = new characters allowed
    manageEndDate: string; // maintenance/care end date
};

// Regional game API: issues per-login sessionKeys and the world list. Validates
// every userCode against the auth service before minting a session.
export type RegionConfig = {
    host: string; // bind address
    port: number; // listen port
    code: string; // region code (sa/ap/eu), used only for logging
    database: string; // sqlite file for sessions
    authInternalUrl: string; // base URL of the auth service's /internal API
    gameHost: string; // raw game-socket host advertised in the world list
    gamePort: number; // raw game-socket port advertised in the world list
    gameAltPort: number; // secondary serverHost port advertised alongside gamePort (17700 in captures)
    clientVersion: string; // protocol/client version echoed in the responses
    sessionTtlSeconds: number; // how long an issued session key stays valid
    world: WorldConfig; // the world advertised by this region
};

export type AppConfig = {
    auth: AuthConfig;
    region: RegionConfig;
};

const CONFIG_PATH = path.join("config", "default.json");

const DEFAULTS: AppConfig = {
    auth: {
        host: "127.0.0.1",
        port: 8001,
        authHost: "auth.romgoldenage.com",
        callbackPort: 7077,
        database: "storage/auth.db",
        authTokenTtlSeconds: 300,
        passwordMinLength: 8,
        passwordMaxLength: 200
    },
    region: {
        host: "127.0.0.1",
        port: 8002,
        code: "sa",
        database: "storage/region.db",
        authInternalUrl: "http://127.0.0.1:8001",
        gameHost: "rm.alan.gregory.nom.br",
        gamePort: 17701,
        gameAltPort: 17700,
        clientVersion: "2023101315",
        sessionTtlSeconds: 86400,
        world: {
            worldId: 56,
            worldGroupId: 3,
            worldName: "Anorel",
            orderId: 1,
            status: 0,
            congestion: 1,
            newCreateUser: 1,
            manageEndDate: "2026-09-10T03:00:00"
        }
    }
};

const asRecord = (value: unknown): Record<string, unknown> =>
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

const pickString = (raw: Record<string, unknown>, key: string, fallback: string): string =>
    typeof raw[key] === "string" ? (raw[key] as string) : fallback;

const pickNumber = (raw: Record<string, unknown>, key: string, fallback: number): number =>
    typeof raw[key] === "number" ? (raw[key] as number) : fallback;

const loadAuth = (raw: Record<string, unknown>): AuthConfig => ({
    host: pickString(raw, "host", DEFAULTS.auth.host),
    port: pickNumber(raw, "port", DEFAULTS.auth.port),
    authHost: pickString(raw, "authHost", DEFAULTS.auth.authHost),
    callbackPort: pickNumber(raw, "callbackPort", DEFAULTS.auth.callbackPort),
    database: pickString(raw, "database", DEFAULTS.auth.database),
    authTokenTtlSeconds: pickNumber(raw, "authTokenTtlSeconds", DEFAULTS.auth.authTokenTtlSeconds),
    passwordMinLength: pickNumber(raw, "passwordMinLength", DEFAULTS.auth.passwordMinLength),
    passwordMaxLength: pickNumber(raw, "passwordMaxLength", DEFAULTS.auth.passwordMaxLength)
});

const loadWorld = (raw: Record<string, unknown>): WorldConfig => ({
    worldId: pickNumber(raw, "worldId", DEFAULTS.region.world.worldId),
    worldGroupId: pickNumber(raw, "worldGroupId", DEFAULTS.region.world.worldGroupId),
    worldName: pickString(raw, "worldName", DEFAULTS.region.world.worldName),
    orderId: pickNumber(raw, "orderId", DEFAULTS.region.world.orderId),
    status: pickNumber(raw, "status", DEFAULTS.region.world.status),
    congestion: pickNumber(raw, "congestion", DEFAULTS.region.world.congestion),
    newCreateUser: pickNumber(raw, "newCreateUser", DEFAULTS.region.world.newCreateUser),
    manageEndDate: pickString(raw, "manageEndDate", DEFAULTS.region.world.manageEndDate)
});

const loadRegion = (raw: Record<string, unknown>): RegionConfig => ({
    host: pickString(raw, "host", DEFAULTS.region.host),
    port: pickNumber(raw, "port", DEFAULTS.region.port),
    code: pickString(raw, "code", DEFAULTS.region.code),
    database: pickString(raw, "database", DEFAULTS.region.database),
    authInternalUrl: pickString(raw, "authInternalUrl", DEFAULTS.region.authInternalUrl),
    gameHost: pickString(raw, "gameHost", DEFAULTS.region.gameHost),
    gamePort: pickNumber(raw, "gamePort", DEFAULTS.region.gamePort),
    gameAltPort: pickNumber(raw, "gameAltPort", DEFAULTS.region.gameAltPort),
    clientVersion: pickString(raw, "clientVersion", DEFAULTS.region.clientVersion),
    sessionTtlSeconds: pickNumber(raw, "sessionTtlSeconds", DEFAULTS.region.sessionTtlSeconds),
    world: loadWorld(asRecord(raw.world))
});

// Loads config/default.json (relative to the working directory) and overlays it
// on the built-in defaults. A missing file, invalid JSON, or missing keys fall
// back to the defaults, so callers always get a fully typed config.
export const loadConfig = (): AppConfig => {
    if (!fs.existsSync(CONFIG_PATH)) {
        return DEFAULTS;
    }
    const parsed: unknown = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    const raw = asRecord(parsed);
    return {
        auth: loadAuth(asRecord(raw.auth)),
        region: loadRegion(asRecord(raw.region))
    };
};
