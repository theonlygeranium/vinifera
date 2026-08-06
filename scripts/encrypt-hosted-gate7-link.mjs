import {
  constants,
  createCipheriv,
  publicEncrypt,
  randomBytes,
} from "node:crypto";

const [handoffId, publicKeySpkiBase64] = process.argv.slice(2);
if (!handoffId || !publicKeySpkiBase64) {
  throw new Error("Usage: encrypt-hosted-gate7-link.mjs <handoff-id> <public-key-spki-base64>");
}

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const link = Buffer.concat(chunks).toString("utf8").trim();
if (!link) throw new Error("A magic-link URL is required on stdin.");

const key = randomBytes(32);
const iv = randomBytes(12);
const cipher = createCipheriv("aes-256-gcm", key, iv);
const ciphertext = Buffer.concat([cipher.update(link, "utf8"), cipher.final()]);
const encryptedKey = publicEncrypt(
  {
    key: Buffer.from(publicKeySpkiBase64, "base64"),
    format: "der",
    type: "spki",
    oaepHash: "sha256",
    padding: constants.RSA_PKCS1_OAEP_PADDING,
  },
  key,
);

process.stdout.write(
  JSON.stringify({
    ciphertext: ciphertext.toString("base64"),
    encryptedKey: encryptedKey.toString("base64"),
    handoffId,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  }),
);
