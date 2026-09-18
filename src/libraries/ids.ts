import { createHash, randomInt } from "crypto";

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const INT32_MAX = 2 ** 31 - 1;

// Deterministic 28-char base62 handle (Firebase-UID shape) from a seed, so the
// same identity maps to the same userCode across logins.
export const mintUserCode = (seed: string): string => {
    const digest = createHash("sha256").update(seed, "utf8").digest();
    let num = BigInt(`0x${digest.toString("hex")}`);
    const base = 62n;
    let out = "";
    for (let i = 0; i < 28; i++) {
        out += BASE62[Number(num % base)];
        num /= base;
    }
    return out;
};

// Random positive Int32 (1 .. 2^31-1). The client stores the session key as an
// Int32 (C2S_SessionAuthLogin.m_sessionKey), so it must fit that range.
export const randomInt32 = (): number => randomInt(1, INT32_MAX);
