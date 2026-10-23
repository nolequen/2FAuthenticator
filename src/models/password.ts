import argon2 from "argon2-browser";
import { Encryption } from "./encryption";

const ARGON2_TIMEOUT = 30000;
const ARGON2_VERIFY_MISMATCH = -35;
const ARGON2_MIN_SALT_LENGTH = 8;
const ARGON2_MIN_HASH_LENGTH = 4;
const MAX_SALT_LENGTH = 256;
const KEY_HASH =
  /^\$argon2id\$v=19\$m=19456,t=2,p=1\$([A-Za-z0-9+/]{1,200})\$([A-Za-z0-9+/]{1,200})$/;

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("argon2 did not respond in time")),
      ARGON2_TIMEOUT,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function hash(value: string, salt: string) {
  const result = await withTimeout(
    argon2.hash({
      pass: value,
      salt,
      time: 2,
      mem: 1024 * 19,
      parallelism: 1,
      hashLen: 32,
      type: argon2.ArgonType.Argon2id,
    }),
  );

  // https://passlib.readthedocs.io/en/stable/lib/passlib.hash.argon2.html#format-algorithm
  const encodedHash = result.encoded.split("$")[5];
  if (!encodedHash) {
    throw new Error("argon2 did not return a hash!");
  }
  return { encoded: result.encoded, hash: encodedHash };
}

async function verify(value: string, encoded: string) {
  let error: unknown;
  try {
    error = await withTimeout(argon2.verify({ pass: value, encoded }));
  } catch (e) {
    error = e;
  }

  if (!error) {
    return true;
  }
  if ((error as { code?: unknown }).code === ARGON2_VERIFY_MISMATCH) {
    return false;
  }
  throw error;
}

function base64Length(value: string) {
  try {
    const decoded = atob(value);
    return btoa(decoded).replace(/=+$/, "") === value ? decoded.length : -1;
  } catch {
    return -1;
  }
}

function isValidKey(key: unknown): key is Key {
  if (!key || typeof key !== "object") {
    return false;
  }

  const { dataType, id, salt, hash, version } = key as Record<string, unknown>;
  if (
    dataType !== "Key" ||
    version !== 3 ||
    typeof id !== "string" ||
    !id ||
    typeof salt !== "string" ||
    salt.length > MAX_SALT_LENGTH ||
    new TextEncoder().encode(salt).length < ARGON2_MIN_SALT_LENGTH ||
    typeof hash !== "string"
  ) {
    return false;
  }

  const match = KEY_HASH.exec(hash);
  return Boolean(
    match &&
    base64Length(match[1]) >= ARGON2_MIN_SALT_LENGTH &&
    base64Length(match[2]) >= ARGON2_MIN_HASH_LENGTH,
  );
}

function randomSalt() {
  let salt = "";
  for (const byte of crypto.getRandomValues(new Uint8Array(16))) {
    salt += ("0" + byte.toString(16)).slice(-2);
  }
  return salt;
}

export async function unlockKey(
  key: Key,
  password: string,
): Promise<{ encryption: Encryption; passphrase: string } | null> {
  if (!isValidKey(key)) {
    return null;
  }

  // The hash of the user's password is used as the encryption key for user data.
  const passphrase = (await hash(password, key.salt)).hash;

  // verify user password by comparing their password hash with the
  // hash of their password's hash
  if (!(await verify(passphrase, key.hash))) {
    return null;
  }

  return { encryption: new Encryption(passphrase, key.id), passphrase };
}

export async function createKey(password: string): Promise<{
  key: Key;
  encryption: Encryption;
  passphrase: string;
}> {
  const salt = randomSalt();
  // The hash of the user's password is used as the encryption key for user data.
  const passphrase = (await hash(password, salt)).hash;
  // This hash is used to verify that a user decrypted `passphrase` correctly
  const hashOfHash = (await hash(passphrase, randomSalt())).encoded;

  const key: Key = {
    dataType: "Key",
    id: crypto.randomUUID(),
    salt,
    hash: hashOfHash,
    version: 3,
  };

  return { key, encryption: new Encryption(passphrase, key.id), passphrase };
}
