import express, { type Express, type Request, type Response } from "express";
import { type RegionConfig } from "../../config";
import { Logger } from "../../libraries";
import { SessionStore, type Session } from "./sessionStore";
import { AuthClient } from "./authClient";

// Structural flags that are always these values in the captured world list.
const SERVER_LABEL = 0;
const EXCLUSIVE_TYPE = 0;

// One world entry pointing the client's raw game socket at our emulator.
const worldEntry = (config: RegionConfig): Record<string, unknown> => ({
    worldGroupId: config.world.worldGroupId,
    serverId: config.world.worldId,
    serverName: config.world.worldName,
    serverLabel: SERVER_LABEL,
    serverStatus: config.world.status,
    manageEndDate: config.world.manageEndDate,
    newCreateUser: config.world.newCreateUser,
    exclusiveType: EXCLUSIVE_TYPE,
    orderId: config.world.orderId,
    congestion: config.world.congestion,
    serverHost: [
        { serverAddr: config.gameHost, serverPort: config.gameAltPort },
        { serverAddr: config.gameHost, serverPort: config.gamePort }
    ]
});

const stringField = (body: unknown, key: string): string => {
    if (typeof body !== "object" || body === null) {
        return "";
    }
    const value = (body as Record<string, unknown>)[key];
    return typeof value === "string" ? value : "";
};

// Express 5 types route params as string | string[]; a single-segment param is
// always a string, so collapse it.
const paramString = (value: string | string[]): string => (Array.isArray(value) ? value[0] ?? "" : value);

const sessionPayload = (session: Session): Record<string, unknown> => ({
    sessionKey: session.sessionKey,
    accountId: session.accountId,
    userCode: session.userCode,
    worldId: session.worldId,
    expiresAt: session.expiresAt
});

// Builds the regional game API express app (live-auth-region-<code>).
export const createRegionApp = (
    config: RegionConfig,
    sessions: SessionStore,
    authClient: AuthClient,
    logger: Logger
): Express => {
    const app = express();
    app.use(express.json({ type: () => true }));

    // Cross-region world list (light form). Registered before /api/worldList so
    // the literal colon path is matched by its own route.
    app.post(/^\/api\/worldList:cross$/, (_req: Request, res: Response) => {
        res.json({
            result: 0,
            resultMessage: "SUCCESS",
            worldListData: [
                {
                    worldId: config.world.worldId,
                    worldGroupId: config.world.worldGroupId,
                    worldName: config.world.worldName,
                    orderId: config.world.orderId
                }
            ]
        });
    });

    // World list. worldListData is a STRINGIFIED json here (unlike authLogin).
    app.post("/api/worldList", (_req: Request, res: Response) => {
        logger.log(`worldList -> ${config.gameHost}:${config.gamePort}`);
        res.json({
            result: 0,
            resultMessage: "SUCCESS",
            // worldList carries the version as a number (authLogin as a string).
            version: Number(config.clientVersion),
            worldListData: JSON.stringify({ worldData: [worldEntry(config)] }),
            lastLoginWorldId: config.world.worldId
        });
    });

    // Session issue: validate the userCode against auth, then mint the
    // game-socket credentials (sessionKey/accountId). worldListData is an OBJECT
    // here. Fails closed if auth does not recognise the userCode.
    app.post("/api/authLogin", async (req: Request, res: Response) => {
        const userCode = stringField(req.body, "userCode");
        const account = await authClient.validate(userCode);
        if (!account) {
            logger.log(`authLogin denied userCode=${userCode}`, "warn");
            res.json({ result: 1, resultMessage: "INVALID_SESSION" });
            return;
        }
        const session = sessions.create(account.accountId, account.userCode, config.world.worldId);
        logger.log(
            `authLogin userCode=${account.userCode} accountId=${account.accountId} sessionKey=${session.sessionKey}`
        );
        res.json({
            result: 0,
            resultMessage: "SUCCESS",
            userCode: account.userCode,
            sessionKey: session.sessionKey,
            accountId: account.accountId,
            accountType: null,
            isNewCreate: false,
            version: config.clientVersion,
            expireTime: session.expiresAt,
            exclusiveType: 0,
            manageEndDate: null,
            worldListData: { worldData: [worldEntry(config)] }
        });
    });

    // Internal API for the game server (region -> game-server trust boundary),
    // so the raw game socket can reject connections that never went through
    // auth/region. The game server compares the returned userCode with the
    // accountCode the client sent on the socket.

    // Reusable validation: valid until the session expires.
    app.get("/internal/sessions/:sessionKey", (req: Request, res: Response) => {
        const raw = paramString(req.params.sessionKey);
        const sessionKey = Number(raw);
        const session = Number.isInteger(sessionKey) ? sessions.find(sessionKey) : null;
        if (!session) {
            logger.log(`session validate denied sessionKey=${raw}`, "warn");
            res.status(404).json({ result: 1, resultMessage: "INVALID_SESSION" });
            return;
        }
        res.json(sessionPayload(session));
    });

    // Single-use validation: returns the session once, then marks it consumed.
    app.post("/internal/sessions/:sessionKey/consume", (req: Request, res: Response) => {
        const raw = paramString(req.params.sessionKey);
        const sessionKey = Number(raw);
        const session = Number.isInteger(sessionKey) ? sessions.consume(sessionKey) : null;
        if (!session) {
            logger.log(`session consume denied sessionKey=${raw}`, "warn");
            res.status(404).json({ result: 1, resultMessage: "INVALID_SESSION" });
            return;
        }
        logger.log(`session consumed sessionKey=${sessionKey} userCode=${session.userCode}`);
        res.json(sessionPayload(session));
    });

    return app;
};
