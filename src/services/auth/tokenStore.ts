import { randomBytes } from "crypto";
import { type Db } from "../../libraries";

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

type TokenRow = {
    account_id: number;
    created_at: number;
    consumed: number;
};

// Short-lived, single-use tokens bound to an account. The login/register form
// gets one on success; the client hands it back to the /auth exchange, which
// consumes it to resolve the account's userCode.
export class TokenStore {
    private readonly db: Db;
    private readonly ttlSeconds: number;

    constructor(db: Db, ttlSeconds: number) {
        this.db = db;
        this.ttlSeconds = ttlSeconds;
        this.migrate();
    }

    private migrate(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS auth_tokens (
                token       TEXT PRIMARY KEY,
                account_id  INTEGER NOT NULL,
                created_at  INTEGER NOT NULL,
                consumed    INTEGER NOT NULL DEFAULT 0
            )
        `);
    }

    public issue(accountId: number): string {
        const token = randomBytes(24).toString("hex");
        this.db
            .prepare("INSERT INTO auth_tokens (token, account_id, created_at, consumed) VALUES (?, ?, ?, 0)")
            .run(token, accountId, nowSeconds());
        return token;
    }

    // Returns the bound accountId and marks the token consumed. Returns null when
    // the token is unknown, already consumed, or expired (expired rows are dropped).
    public consume(token: string): number | null {
        if (!token) {
            return null;
        }
        const row = this.db
            .prepare("SELECT account_id, created_at, consumed FROM auth_tokens WHERE token = ?")
            .get(token) as TokenRow | undefined;
        if (!row || row.consumed) {
            return null;
        }
        if (row.created_at + this.ttlSeconds <= nowSeconds()) {
            this.db.prepare("DELETE FROM auth_tokens WHERE token = ?").run(token);
            return null;
        }
        this.db.prepare("UPDATE auth_tokens SET consumed = 1 WHERE token = ?").run(token);
        return row.account_id;
    }
}
