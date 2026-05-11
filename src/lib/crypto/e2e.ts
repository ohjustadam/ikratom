"use client";

/**
 * End-to-end encryption for direct messages.
 *
 * Cryptography:
 *   - Identity keypair: Curve25519 (libsodium box).
 *     Public key uploaded to profiles.public_key.
 *     Private key stored in IndexedDB on this device only.
 *   - Per-conversation symmetric session key: 32 bytes random.
 *     Encrypted once per participant with libsodium box (their public key).
 *     Stored on dm_conversations.encrypted_session_keys.
 *   - Per-message: XChaCha20-Poly1305 (libsodium secretbox) using session key
 *     + a random 24-byte nonce per message.
 *
 * Trust model: TOFU — we accept the other party's public key on first message.
 * If their public_key changes later, the conversation surfaces a soft warning.
 *
 * Recovery: lost private key = lost old messages. New keypair lets you resume
 * conversations going forward (other party will see a key-changed warning).
 */

import sodium from "libsodium-wrappers";

const DB_NAME = "ikratom";
const STORE_NAME = "keypair";
const KEY_RECORD_ID = "main";

let _ready: Promise<void> | null = null;
function ready() {
  if (!_ready) _ready = sodium.ready;
  return _ready;
}

// ----- IndexedDB helpers (browser only) -----

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGet<T>(key: string): Promise<T | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve((req.result as T) ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function dbSet<T>(key: string, value: T): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const req = tx.objectStore(STORE_NAME).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ----- Keypair management -----

export type StoredKeypair = {
  publicKey: string;   // base64
  privateKey: string;  // base64
};

/** Get the device's keypair, generating a new one if none exists. */
export async function getOrCreateKeypair(): Promise<StoredKeypair> {
  await ready();
  const existing = await dbGet<StoredKeypair>(KEY_RECORD_ID);
  if (existing) return existing;

  const kp = sodium.crypto_box_keypair();
  const stored: StoredKeypair = {
    publicKey: sodium.to_base64(kp.publicKey, sodium.base64_variants.ORIGINAL),
    privateKey: sodium.to_base64(kp.privateKey, sodium.base64_variants.ORIGINAL),
  };
  await dbSet(KEY_RECORD_ID, stored);
  return stored;
}

/** Re-generate the device keypair (loses access to old conversations). */
export async function regenerateKeypair(): Promise<StoredKeypair> {
  await ready();
  const kp = sodium.crypto_box_keypair();
  const stored: StoredKeypair = {
    publicKey: sodium.to_base64(kp.publicKey, sodium.base64_variants.ORIGINAL),
    privateKey: sodium.to_base64(kp.privateKey, sodium.base64_variants.ORIGINAL),
  };
  await dbSet(KEY_RECORD_ID, stored);
  return stored;
}

/** Short, human-readable fingerprint of a public key (for optional verification). */
export async function fingerprintForPublicKey(publicKeyB64: string): Promise<string> {
  await ready();
  const bytes = sodium.from_base64(publicKeyB64, sodium.base64_variants.ORIGINAL);
  const hash = sodium.crypto_generichash(8, bytes, null);
  // Format as 8 groups of 2 hex chars: "a4 9f 7d 02  e1 8c 5b 6f"
  const hex = sodium.to_hex(hash);
  return hex.match(/.{2}/g)!.join(" ").replace(/((?:\S\S\s){4})/g, "$1 ");
}

// ----- Session-key handling -----

/**
 * Generate a new session key + encrypt it for each participant.
 * Returns:
 *   { sessionKey, encryptedForUsers: { user_id: ciphertext_base64 }, nonces: { user_id: nonce_base64 } }
 *
 * Used when starting a NEW conversation.
 */
export async function makeSessionKey(
  myPrivateKeyB64: string,
  participantPublicKeysByUserId: Record<string, string>
): Promise<{
  sessionKey: Uint8Array;
  encryptedForUsers: Record<string, string>;
  nonces: Record<string, string>;
}> {
  await ready();
  const sessionKey = sodium.crypto_secretbox_keygen();
  const myPriv = sodium.from_base64(myPrivateKeyB64, sodium.base64_variants.ORIGINAL);

  const encryptedForUsers: Record<string, string> = {};
  const nonces: Record<string, string> = {};

  for (const [userId, theirPubB64] of Object.entries(participantPublicKeysByUserId)) {
    const theirPub = sodium.from_base64(theirPubB64, sodium.base64_variants.ORIGINAL);
    const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
    const ct = sodium.crypto_box_easy(sessionKey, nonce, theirPub, myPriv);
    encryptedForUsers[userId] = sodium.to_base64(ct, sodium.base64_variants.ORIGINAL);
    nonces[userId] = sodium.to_base64(nonce, sodium.base64_variants.ORIGINAL);
  }

  return { sessionKey, encryptedForUsers, nonces };
}

/**
 * Encrypt an existing session key for a new recipient. Used when adding
 * a member to a group — we already have the session key (we decrypted
 * our own slot), now we need to give the new member their own slot
 * encrypted to their pubkey.
 */
export async function encryptSessionKeyForRecipient(input: {
  sessionKey: Uint8Array;
  myPrivateKeyB64: string;
  recipientPublicKeyB64: string;
}): Promise<{ ciphertextB64: string; nonceB64: string }> {
  await ready();
  const myPriv = sodium.from_base64(input.myPrivateKeyB64, sodium.base64_variants.ORIGINAL);
  const theirPub = sodium.from_base64(input.recipientPublicKeyB64, sodium.base64_variants.ORIGINAL);
  const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
  const ct = sodium.crypto_box_easy(input.sessionKey, nonce, theirPub, myPriv);
  return {
    ciphertextB64: sodium.to_base64(ct, sodium.base64_variants.ORIGINAL),
    nonceB64: sodium.to_base64(nonce, sodium.base64_variants.ORIGINAL),
  };
}

/** Decrypt a session key that was encrypted for me (using sender's public key + my private key). */
export async function decryptSessionKeyForMe(input: {
  myPrivateKeyB64: string;
  senderPublicKeyB64: string;
  ciphertextB64: string;
  nonceB64: string;
}): Promise<Uint8Array> {
  await ready();
  const myPriv = sodium.from_base64(input.myPrivateKeyB64, sodium.base64_variants.ORIGINAL);
  const senderPub = sodium.from_base64(input.senderPublicKeyB64, sodium.base64_variants.ORIGINAL);
  const ct = sodium.from_base64(input.ciphertextB64, sodium.base64_variants.ORIGINAL);
  const nonce = sodium.from_base64(input.nonceB64, sodium.base64_variants.ORIGINAL);
  return sodium.crypto_box_open_easy(ct, nonce, senderPub, myPriv);
}

// ----- Message encryption (symmetric, per-message nonce) -----

export async function encryptMessage(plaintext: string, sessionKey: Uint8Array): Promise<{
  ciphertext: string;
  nonce: string;
}> {
  await ready();
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const ct = sodium.crypto_secretbox_easy(sodium.from_string(plaintext), nonce, sessionKey);
  return {
    ciphertext: sodium.to_base64(ct, sodium.base64_variants.ORIGINAL),
    nonce: sodium.to_base64(nonce, sodium.base64_variants.ORIGINAL),
  };
}

export async function decryptMessage(input: {
  ciphertextB64: string;
  nonceB64: string;
  sessionKey: Uint8Array;
}): Promise<string> {
  await ready();
  const ct = sodium.from_base64(input.ciphertextB64, sodium.base64_variants.ORIGINAL);
  const nonce = sodium.from_base64(input.nonceB64, sodium.base64_variants.ORIGINAL);
  const pt = sodium.crypto_secretbox_open_easy(ct, nonce, input.sessionKey);
  return sodium.to_string(pt);
}
