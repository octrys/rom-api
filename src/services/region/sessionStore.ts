import { type Db, isUniqueViolation, randomInt32 } from "../../libraries";

// A game-socket session issued at authLogin. sessionKey is what the client
// sends back as C2S_SessionAuthLogin.m_sessionKey; the game server validates it
// against this table on connect. expiresAt is a Unix timestamp (seconds).
export type Session = {
    sessionKey: number;
    accountId: number;
    userCode: string;
    worldId: number;
    expiresAt: number;
};

type SessionRow = {
    session_key: number;
    account_id: number;
    user_code: string;
    world_id: number;
    created_at: number;
    consumed: number;
};

const MAX_KEY_ATTEMPTS = 5;

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

// Persists per-login sessions keyed by a random Int32 session key. Sessions
// expire ttlSeconds after creation (lazily: an expired row is dropped on read)
// and can optionally be consumed once (single-use validation).
export class SessionStore {
    private readonly db: Db;
    private readonly ttlSeconds: number;

    constructor(db: Db, ttlSeconds: number) {
        this.db = db;
        this.ttlSeconds = ttlSeconds;
        this.migrate();
    }

    private migrate(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS sessions (
                session_key INTEGER PRIMARY KEY,
                account_id  INTEGER NOT NULL,
                user_code   TEXT NOT NULL,
                world_id    INTEGER NOT NULL,
                created_at  INTEGER NOT NULL,
                consumed    INTEGER NOT NULL DEFAULT 0
            )
        `);
        // Bring older databases (created before single-use) up to date.
        this.ensureColumn("consumed", "consumed INTEGER NOT NULL DEFAULT 0");
    }

    private ensureColumn(name: string, ddl: string): void {
        const columns = this.db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[];
        if (!columns.some((column) => column.name === name)) {
            this.db.exec(`ALTER TABLE sessions ADD COLUMN ${ddl}`);
        }
    }

    // Allocates a session with a unique random session key, retrying on the
    // (astronomically unlikely) key collision.
    public create(accountId: number, userCode: string, worldId: number): Session {
        const insert = this.db.prepare(
            `INSERT INTO sessions (session_key, account_id, user_code, world_id, created_at, consumed)
             VALUES (?, ?, ?, ?, ?, 0)`
        );
        const createdAt = nowSeconds();
        for (let attempt = 0; attempt < MAX_KEY_ATTEMPTS; attempt++) {
            const sessionKey = randomInt32();
            try {
                insert.run(sessionKey, accountId, userCode, worldId, createdAt);
                return { sessionKey, accountId, userCode, worldId, expiresAt: createdAt + this.ttlSeconds };
            } catch (error) {
                if (isUniqueViolation(error) && attempt < MAX_KEY_ATTEMPTS - 1) {
                    continue;
                }
                throw error;
            }
        }
        throw new Error("failed to allocate a unique session key");
    }

    // Reusable validation for the game server: returns the session while it is
    // valid. An expired session is deleted; a consumed one is treated as absent.
    public find(sessionKey: number): Session | null {
        const row = this.db
            .prepare(
                `SELECT session_key, account_id, user_code, world_id, created_at, consumed
                 FROM sessions WHERE session_key = ?`
            )
            .get(sessionKey) as SessionRow | undefined;
        if (!row || row.consumed) {
            return null;
        }
        const expiresAt = row.created_at + this.ttlSeconds;
        if (expiresAt <= nowSeconds()) {
            this.db.prepare("DELETE FROM sessions WHERE session_key = ?").run(sessionKey);
            return null;
        }
        return {
            sessionKey: row.session_key,
            accountId: row.account_id,
            userCode: row.user_code,
            worldId: row.world_id,
            expiresAt
        };
    }

    // Single-use validation: returns the session and marks it consumed, so a
    // second call fails. Atomic (find + mark run in one transaction).
    public consume(sessionKey: number): Session | null {
        const run = this.db.transaction((): Session | null => {
            const session = this.find(sessionKey);
            if (!session) {
                return null;
            }
            this.db.prepare("UPDATE sessions SET consumed = 1 WHERE session_key = ?").run(sessionKey);
            return session;
        });
        return run();
    }
}
