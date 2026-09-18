import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

export type Db = Database.Database;

// Opens (creating the parent directory if needed) a WAL-mode sqlite database.
// Each service owns its own file; the connection is shared across request
// handlers, which is safe because better-sqlite3 is synchronous.
export const openDatabase = (file: string): Db => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const db = new Database(file);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    return db;
};

// True when an error is a sqlite uniqueness violation (used to retry on
// randomly-generated primary keys).
export const isUniqueViolation = (error: unknown): boolean =>
    typeof (error as { code?: unknown }).code === "string" &&
    (error as { code: string }).code.startsWith("SQLITE_CONSTRAINT");
