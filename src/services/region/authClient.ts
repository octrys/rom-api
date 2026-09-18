import { Logger } from "../../libraries";

// The subset of an account the region service needs to mint a session.
export type ValidatedAccount = {
    accountId: number;
    userCode: string;
    idpCode: number;
};

const REQUEST_TIMEOUT_MS = 3000;

// Talks to the auth service's /internal API to validate a userCode before the
// region issues a session. This is the region -> auth trust boundary.
export class AuthClient {
    private readonly baseUrl: string;
    private readonly logger: Logger;

    constructor(baseUrl: string, logger: Logger) {
        this.baseUrl = baseUrl.replace(/\/+$/, "");
        this.logger = logger;
    }

    // Returns the account for a userCode, or null when it is unknown or the auth
    // service is unreachable (fail closed — no session is minted).
    public async validate(userCode: string): Promise<ValidatedAccount | null> {
        if (!userCode) {
            return null;
        }
        const url = `${this.baseUrl}/internal/accounts/${encodeURIComponent(userCode)}`;
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
            if (response.status === 404) {
                return null;
            }
            if (!response.ok) {
                this.logger.log(`validate ${userCode} -> HTTP ${response.status}`, "warn");
                return null;
            }
            return this.parse(await response.json());
        } catch (error) {
            this.logger.log(`validate ${userCode} failed => ${error}`, "error");
            return null;
        }
    }

    private parse(payload: unknown): ValidatedAccount | null {
        if (typeof payload !== "object" || payload === null) {
            return null;
        }
        const raw = payload as Record<string, unknown>;
        if (
            typeof raw.accountId !== "number" ||
            typeof raw.userCode !== "string" ||
            typeof raw.idpCode !== "number"
        ) {
            return null;
        }
        return { accountId: raw.accountId, userCode: raw.userCode, idpCode: raw.idpCode };
    }
}
