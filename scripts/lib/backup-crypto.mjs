/**
 * backup-crypto.mjs — seal database backups so a copy stored anywhere is safe.
 *
 * Hybrid encryption, Node built-ins only (no age/gpg to install on a runner):
 * every backup gets a fresh AES-256-GCM key, and that key is wrapped with an
 * RSA-4096 PUBLIC key that is committed to the repo. Only the PRIVATE key can
 * open a backup, and it never leaves the owner's machine
 * (private/backup-private-key.pem, gitignored). A leaked artifact is noise.
 *
 * File format (all lengths fixed except the wrapped key):
 *   "IKBK1\n" | u32 BE wrapped-key length | wrapped key | 12-byte IV | gzip+AES-GCM ciphertext | 16-byte tag
 */
import crypto from "node:crypto";
import fs from "node:fs";
import zlib from "node:zlib";

const MAGIC = Buffer.from("IKBK1\n");

export function generateKeyPair() {
  return crypto.generateKeyPairSync("rsa", {
    modulusLength: 4096,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
}

/** Stream `input` (e.g. pg_dump stdout) through gzip + AES-GCM into `outPath`. Resolves to bytes written. */
export function encryptStream(input, outPath, publicKeyPem) {
  const key = crypto.randomBytes(32), iv = crypto.randomBytes(12);
  const wrapped = crypto.publicEncrypt({ key: publicKeyPem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, key);
  const len = Buffer.alloc(4); len.writeUInt32BE(wrapped.length);
  const out = fs.createWriteStream(outPath);
  out.write(Buffer.concat([MAGIC, len, wrapped, iv]));
  const gzip = zlib.createGzip({ level: 9 });
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  return new Promise((resolve, reject) => {
    for (const s of [input, gzip, cipher, out]) s.on("error", reject);
    cipher.on("data", (c) => { if (!out.write(c)) { cipher.pause(); out.once("drain", () => cipher.resume()); } });
    cipher.on("end", () => { out.end(cipher.getAuthTag(), () => resolve(fs.statSync(outPath).size)); });
    input.pipe(gzip).pipe(cipher);
  });
}

/** Read the header only: proves a file is an intact iKratom backup without the private key. */
export function inspect(path) {
  const fd = fs.openSync(path, "r");
  try {
    const head = Buffer.alloc(MAGIC.length + 4);
    fs.readSync(fd, head, 0, head.length, 0);
    if (!head.subarray(0, MAGIC.length).equals(MAGIC)) return { ok: false, reason: "not an iKratom backup (bad magic)" };
    const wrappedLen = head.readUInt32BE(MAGIC.length);
    const size = fs.fstatSync(fd).size;
    return size > MAGIC.length + 4 + wrappedLen + 12 + 16 ? { ok: true, size } : { ok: false, reason: "truncated" };
  } finally { fs.closeSync(fd); }
}

/** Decrypt + gunzip a backup into plain SQL. Holds the ciphertext in memory (fine for our size). */
export function decryptFile(inPath, outPath, privateKeyPem) {
  const buf = fs.readFileSync(inPath);
  if (!buf.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("not an iKratom backup");
  let o = MAGIC.length;
  const wrappedLen = buf.readUInt32BE(o); o += 4;
  const key = crypto.privateDecrypt({ key: privateKeyPem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, buf.subarray(o, o + wrappedLen));
  o += wrappedLen;
  const iv = buf.subarray(o, o + 12); o += 12;
  const tag = buf.subarray(buf.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const gz = Buffer.concat([decipher.update(buf.subarray(o, buf.length - 16)), decipher.final()]); // throws if tampered
  fs.writeFileSync(outPath, zlib.gunzipSync(gz));
  return fs.statSync(outPath).size;
}
