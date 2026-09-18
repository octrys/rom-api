import express, { type Express, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { type AuthConfig } from "../../config";
import { Logger, hashPassword, verifyPassword } from "../../libraries";
import { AccountStore, type Account } from "./accountStore";
import { TokenStore } from "./tokenStore";
import { renderLoginPage } from "./loginPage";

// RedlabSDK ERLIDPCode values (from the client's enum dump).
const IDP_CODES: Record<string, number> = {
    email: 1,
    google: 2,
    apple: 4,
    guest: 99
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type AuthDeps = {
    config: AuthConfig;
    store: AccountStore;
    tokens: TokenStore;
    logger: Logger;
};

const idpCodeFor = (provider: string): number => IDP_CODES[provider] ?? 0;

const bodyOf = (request: Request): Record<string, unknown> =>
    typeof request.body === "object" && request.body !== null
        ? (request.body as Record<string, unknown>)
        : {};

const stringField = (body: Record<string, unknown>, key: string): string =>
    typeof body[key] === "string" ? (body[key] as string) : "";

// Express 5 types route params as string | string[]; a single-segment param is
// always a string, so collapse it.
const paramString = (value: string | string[]): string => (Array.isArray(value) ? value[0] ?? "" : value);

// The stable identity key for a guest/social account. deviceId first (stable per
// device), then the OAuth state, else a random anonymous id so a login never
// silently collapses onto another account.
const subjectFrom = (body: Record<string, unknown>): string => {
    const device = stringField(body, "deviceId");
    const state = stringField(body, "state");
    return device || state || `anon-${randomUUID()}`;
};

// Builds the identity service express app. Endpoints mirror the captured
// RedlabSDK routes (auth.romgoldenage.com) plus the email login/register form.
export const createAuthApp = (config: AuthConfig, store: AccountStore, tokens: TokenStore, logger: Logger): Express => {
    const deps: AuthDeps = { config, store, tokens, logger };
    const app = express();
    // Parse every request body as JSON regardless of content-type — the SDK
    // does not always send application/json.
    app.use(express.json({ type: () => true }));

    // Login start: hand back an authUrl pointing at our own login page.
    app.post("/v1/auth/pc/:provider/start", (req: Request, res: Response) => {
        const provider = paramString(req.params.provider);
        const state = randomUUID();
        const authUrl = `https://${config.authHost}/v1/auth/pc/${provider}/authorize?state=${state}`;
        logger.log(`start ${provider} state=${state}`);
        res.json({ result: 0, resultMessage: "SUCCESS", state, authUrl });
    });

    // Webview target: serve the login/register form.
    app.get("/v1/auth/pc/:provider/authorize", (req: Request, res: Response) => {
        const state = typeof req.query.state === "string" ? req.query.state : "";
        const callbackBase = `http://localhost:${config.callbackPort}/auth`;
        logger.log(`authorize ${paramString(req.params.provider)} -> login form state=${state}`);
        res.type("html").send(renderLoginPage(state, callbackBase));
    });

    // Email registration: create the account (does not sign in). async so a
    // rejection is caught by Express instead of hanging the request.
    app.post("/v1/auth/email/register", async (req: Request, res: Response) => {
        await registerEmail(bodyOf(req), res, deps);
    });

    // Email login: verify the password and issue a single-use token.
    app.post("/v1/auth/email/login", async (req: Request, res: Response) => {
        await loginEmail(bodyOf(req), res, deps);
    });

    // Guest login/registration (no token, auto-provisioned).
    app.post("/v1/auth/guest/authorize", (req: Request, res: Response) => {
        exchange("guest", bodyOf(req), res, deps);
    });

    // Token exchange after the webview: a valid authToken resolves to its
    // account's userCode; otherwise fall back to guest/social auto-provisioning.
    app.post("/v1/auth/pc/:provider/auth", (req: Request, res: Response) => {
        exchange(paramString(req.params.provider), bodyOf(req), res, deps);
    });

    // Internal API for the region service: resolve a userCode to its account.
    app.get("/internal/accounts/:userCode", (req: Request, res: Response) => {
        const account = store.findByUserCode(paramString(req.params.userCode));
        if (!account) {
            res.status(404).json({ result: 1, resultMessage: "NOT_FOUND" });
            return;
        }
        res.json({ accountId: account.accountId, userCode: account.userCode, idpCode: account.idpCode });
    });

    return app;
};

const registerEmail = async (body: Record<string, unknown>, res: Response, deps: AuthDeps): Promise<void> => {
    const email = stringField(body, "email").trim().toLowerCase();
    const password = stringField(body, "password");
    if (!EMAIL_RE.test(email)) {
        res.status(400).json({ result: 1, resultMessage: "Invalid email" });
        return;
    }
    if (password.length < deps.config.passwordMinLength) {
        res.status(400).json({ result: 1, resultMessage: `Password must be at least ${deps.config.passwordMinLength} characters` });
        return;
    }
    if (password.length > deps.config.passwordMaxLength) {
        res.status(400).json({ result: 1, resultMessage: `Password must be at most ${deps.config.passwordMaxLength} characters` });
        return;
    }
    const account = deps.store.createEmailAccount(email, await hashPassword(password));
    if (!account) {
        res.status(409).json({ result: 1, resultMessage: "Email already registered" });
        return;
    }
    // Registration only creates the account; the user must then log in.
    deps.logger.log(`register email=${email} -> userCode=${account.userCode} accountId=${account.accountId}`);
    res.status(201).json({ result: 0, resultMessage: "SUCCESS" });
};

const loginEmail = async (body: Record<string, unknown>, res: Response, deps: AuthDeps): Promise<void> => {
    const email = stringField(body, "email").trim().toLowerCase();
    const password = stringField(body, "password");
    // Reject oversized input before scrypt runs (same response as a bad login,
    // so it reveals nothing).
    if (password.length > deps.config.passwordMaxLength) {
        deps.logger.log(`login denied email=${email} (password too long)`, "warn");
        res.status(401).json({ result: 1, resultMessage: "Invalid email or password" });
        return;
    }
    const credential = deps.store.findEmailCredential(email);
    // Verify even when the account is missing would be ideal for timing, but a
    // simple guard is enough here; respond identically for unknown/wrong password.
    if (!credential || !(await verifyPassword(password, credential.passwordHash))) {
        deps.logger.log(`login denied email=${email}`, "warn");
        res.status(401).json({ result: 1, resultMessage: "Invalid email or password" });
        return;
    }
    deps.logger.log(`login email=${email} -> userCode=${credential.account.userCode}`);
    res.json({ result: 0, resultMessage: "SUCCESS", authToken: deps.tokens.issue(credential.account.accountId) });
};

// Resolves the request to an account and answers with its userCode. A valid
// single-use authToken (from the login/register form) wins; if a token is
// supplied but invalid/expired the request is rejected (never silently
// downgraded to a guest). With no token, the provider is auto-provisioned by
// identity (guest/social).
const exchange = (provider: string, body: Record<string, unknown>, res: Response, deps: AuthDeps): void => {
    const state = stringField(body, "state");
    const account = resolveAccount(provider, body, deps);
    if (!account) {
        deps.logger.log(`exchange ${provider} denied (invalid or expired token)`, "warn");
        res.status(401).json({ result: 1, resultMessage: "Invalid or expired token", state });
        return;
    }
    deps.logger.log(`exchange ${provider} -> userCode=${account.userCode} accountId=${account.accountId}`);
    res.json({ result: 0, resultMessage: "SUCCESS", state, userCode: account.userCode });
};

// Returns the account, or null when an authToken was supplied but is
// invalid/expired (or its account vanished) — the caller then rejects.
const resolveAccount = (provider: string, body: Record<string, unknown>, deps: AuthDeps): Account | null => {
    const token = stringField(body, "authToken");
    if (token) {
        const accountId = deps.tokens.consume(token);
        if (accountId === null) {
            return null;
        }
        return deps.store.findByAccountId(accountId);
    }
    return deps.store.getOrCreate(idpCodeFor(provider), subjectFrom(body));
};
