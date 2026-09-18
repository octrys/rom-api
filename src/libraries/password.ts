import { randomBytes, scrypt, timingSafeEqual } from "crypto";
import { promisify } from "util";

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

// Hashes a password with scrypt and a random salt. Stored format:
// "scrypt$<saltHex>$<hashHex>".
export const hashPassword = async (password: string): Promise<string> => {
    const salt = randomBytes(SALT_LENGTH);
    const derived = await scryptAsync(password, salt, KEY_LENGTH);
    return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
};

// Verifies a password against a stored scrypt hash. Returns false (never throws)
// on a malformed hash or mismatch.
export const verifyPassword = async (password: string, stored: string): Promise<boolean> => {
    const parts = stored.split("$");
    if (parts.length !== 3 || parts[0] !== "scrypt") {
        return false;
    }
    const salt = Buffer.from(parts[1], "hex");
    const expected = Buffer.from(parts[2], "hex");
    const derived = await scryptAsync(password, salt, expected.length);
    return expected.length === derived.length && timingSafeEqual(expected, derived);
};
