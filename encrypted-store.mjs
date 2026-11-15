import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createEmptyData } from "./investment-domain.mjs";

function decodeKey(value) {
  if (!value || !/^[0-9a-f]{64}$/i.test(value)) {
    throw new Error("DATA_ENCRYPTION_KEY must be 64 hexadecimal characters (32 random bytes).");
  }
  return Buffer.from(value, "hex");
}

function encrypt(data, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(data), "utf8"), cipher.final()]);
  return JSON.stringify({
    version: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: encrypted.toString("base64")
  });
}

function decrypt(contents, key) {
  const envelope = JSON.parse(contents);
  if (envelope.version !== 1) throw new Error("Encrypted data file has an unsupported format.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const cleartext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final()
  ]).toString("utf8");
  const data = JSON.parse(cleartext);
  if (data.schemaVersion !== 1 || !Array.isArray(data.holdings) || !Array.isArray(data.transactions)) {
    throw new Error("Encrypted data file is invalid or has an unsupported schema.");
  }
  return data;
}

export class EncryptedStore {
  #key;
  #file;
  #writeQueue = Promise.resolve();

  constructor(file, keyHex, allowedEmails) {
    this.#file = file;
    this.#key = decodeKey(keyHex);
    this.allowedEmails = [...allowedEmails];
  }

  async read() {
    try {
      const data = decrypt(await readFile(this.#file, "utf8"), this.#key);
      data.members = [...this.allowedEmails];
      return data;
    } catch (error) {
      if (error.code === "ENOENT") return createEmptyData(this.allowedEmails);
      throw error;
    }
  }

  async mutate(operation) {
    const task = this.#writeQueue.then(async () => {
      const data = await this.read();
      const result = await operation(data);
      const content = encrypt(data, this.#key);
      await mkdir(dirname(this.#file), { recursive: true, mode: 0o700 });
      const temporary = `${this.#file}.${randomBytes(8).toString("hex")}.tmp`;
      try {
        await writeFile(temporary, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
        await rename(temporary, this.#file);
      } catch (error) {
        await unlink(temporary).catch(() => {});
        throw error;
      }
      return result;
    });
    this.#writeQueue = task.catch(() => {});
    return task;
  }
}

export function createEncryptionKey() {
  return randomBytes(32).toString("hex");
}
