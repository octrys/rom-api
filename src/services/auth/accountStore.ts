import { type Db, isUniqueViolation, mintUserCode } from "../../libraries";

// ERLIDPCode value for an email/password account.
export const EMAIL_IDP_CODE = 1;

// An account, keyed on the (idpCode, subject) identity and exposed to the game
// by its userCode. accountId is the stable numeric handle the region service
// hands to the client (C2S_SessionAuthLogin uses userCode as accountCode).
export type Account = {
    accountId: number;
    userCode: string;
    idpCode: number;
    subject: string;
};

// An email account plus its stored password hash, for login verification.
export type EmailCredential = {
    account: Account;
    passwordHash: string;
};

type AccountRow = {
    account_id: number;
    user_code: string;
    idp_code: number;
    subject: string;
};

type CredentialRow = AccountRow & { password_hash: string };

// accountId starts here + 1 so the first account looks like a realistic id
// rather than 1 (matches the shape seen in production captures).
const ACCOUNT_ID_BASE = 100000;

// Persists accounts and performs registration. Guest/social logins auto-create
// on first sight; email accounts are created explicitly with a password.
export class AccountStore {
    private readonly db: Db;

    constructor(db: Db) {
        this.db = db;
        this.migrate();
    }

    private migrate(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS accounts (
                account_id    INTEGER PRIMARY KEY,
                user_code     TEXT NOT NULL UNIQUE,
                idp_code      INTEGER NOT NULL,
                subject       TEXT NOT NULL,
                email         TEXT,
                password_hash TEXT,
                created_at    TEXT NOT NULL,
                UNIQUE (idp_code, subject)
            )
        `);
        // Bring older databases (created before email/password) up to date.
        this.ensureColumn("email", "email TEXT");
        this.ensureColumn("password_hash", "password_hash TEXT");
    }

    private ensureColumn(name: string, ddl: string): void {
        const columns = this.db.prepare("PRAGMA table_info(accounts)").all() as { name: string }[];
        if (!columns.some((column) => column.name === name)) {
            this.db.exec(`ALTER TABLE accounts ADD COLUMN ${ddl}`);
        }
    }

    // Registration for guest/social logins. Keyed on (idpCode, subject): a stable
    // identity always resolves to the same account and userCode.
    public getOrCreate(idpCode: number, subject: string): Account {
        const existing = this.findByIdentity(idpCode, subject);
        if (existing) {
            return existing;
        }
        return this.insert(idpCode, subject, null, null);
    }

    // Creates an email/password account. Returns null when the email is already
    // registered (so the caller can answer 409).
    public createEmailAccount(email: string, passwordHash: string): Account | null {
        if (this.findByIdentity(EMAIL_IDP_CODE, email)) {
            return null;
        }
        try {
            return this.insert(EMAIL_IDP_CODE, email, email, passwordHash);
        } catch (error) {
            if (isUniqueViolation(error)) {
                return null;
            }
            throw error;
        }
    }

    // Looks up an email account together with its password hash for login.
    public findEmailCredential(email: string): EmailCredential | null {
        const row = this.db
            .prepare(
                `SELECT account_id, user_code, idp_code, subject, password_hash
                 FROM accounts WHERE idp_code = ? AND subject = ? AND password_hash IS NOT NULL`
            )
            .get(EMAIL_IDP_CODE, email) as CredentialRow | undefined;
        return row ? { account: this.toAccount(row), passwordHash: row.password_hash } : null;
    }

    // Used by the region service (via the /internal API) to validate a userCode.
    public findByUserCode(userCode: string): Account | null {
        return this.selectAccount("user_code = ?", [userCode]);
    }

    // Used by the /auth exchange to resolve a consumed token to its account.
    public findByAccountId(accountId: number): Account | null {
        return this.selectAccount("account_id = ?", [accountId]);
    }

    private findByIdentity(idpCode: number, subject: string): Account | null {
        return this.selectAccount("idp_code = ? AND subject = ?", [idpCode, subject]);
    }

    private insert(idpCode: number, subject: string, email: string | null, passwordHash: string | null): Account {
        const userCode = mintUserCode(`${idpCode}:${subject}`);
        const create = this.db.transaction((): Account => {
            const row = this.db
                .prepare("SELECT COALESCE(MAX(account_id), ?) AS maxId FROM accounts")
                .get(ACCOUNT_ID_BASE) as { maxId: number };
            const accountId = row.maxId + 1;
            this.db
                .prepare(
                    `INSERT INTO accounts (account_id, user_code, idp_code, subject, email, password_hash, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`
                )
                .run(accountId, userCode, idpCode, subject, email, passwordHash, new Date().toISOString());
            return { accountId, userCode, idpCode, subject };
        });
        return create();
    }

    private selectAccount(where: string, params: unknown[]): Account | null {
        const row = this.db
            .prepare(`SELECT account_id, user_code, idp_code, subject FROM accounts WHERE ${where}`)
            .get(...params) as AccountRow | undefined;
        return row ? this.toAccount(row) : null;
    }

    private toAccount(row: AccountRow): Account {
        return {
            accountId: row.account_id,
            userCode: row.user_code,
            idpCode: row.idp_code,
            subject: row.subject
        };
    }
}
