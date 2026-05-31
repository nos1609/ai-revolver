import crypto from "node:crypto";

/**
 * Password-based AES-256-GCM envelope.
 *
 * Shared between the encrypted-file vault backend and the export/import
 * command — same scrypt params, same on-disk shape, so an export encrypted
 * with the same password is decipherable by the vault crypto test harness
 * (and vice-versa).
 */

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const SCRYPT_COST = 16384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELISM = 1;

export interface EncryptedEnvelope {
  version: number;
  salt: string;
  iv: string;
  tag: string;
  data: string;
}

function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.scryptSync(password, salt, KEY_LENGTH, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELISM,
  });
}

export function encryptWithPassword(plaintext: string, password: string): EncryptedEnvelope {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = deriveKey(password, salt);
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    version: 1,
    salt: salt.toString("hex"),
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    data: encrypted.toString("hex"),
  };
}

export function decryptWithPassword(env: EncryptedEnvelope, password: string): string {
  const salt = Buffer.from(env.salt, "hex");
  const key = deriveKey(password, salt);
  const iv = Buffer.from(env.iv, "hex");
  const tag = Buffer.from(env.tag, "hex");
  const encrypted = Buffer.from(env.data, "hex");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(tag);
  return decipher.update(encrypted).toString() + decipher.final("utf-8");
}
