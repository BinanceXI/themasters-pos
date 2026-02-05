type PinHash = {
  pin_salt: string;
  pin_hash: string;
  pin_iter: number;
  pin_kdf: "pbkdf2_sha256";
};

const textEncoder = new TextEncoder();

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(b64: string) {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function randomBytes(size: number) {
  const out = new Uint8Array(size);
  crypto.getRandomValues(out);
  return out;
}

async function pbkdf2Sha256(pin: string, salt: Uint8Array, iterations: number) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    256
  );

  return new Uint8Array(bits);
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function validatePin(pin: string) {
  const p = String(pin || "").trim();
  if (!p) return { ok: false as const, reason: "PIN required" };
  if (p.length < 4) return { ok: false as const, reason: "PIN must be at least 4 characters" };
  if (p.length > 64) return { ok: false as const, reason: "PIN too long" };
  return { ok: true as const, pin: p };
}

export async function hashPin(pin: string, opts: { iterations?: number } = {}): Promise<PinHash> {
  const iterations = clampInt(opts.iterations ?? 120_000, 50_000, 600_000);
  const salt = randomBytes(16);
  const derived = await pbkdf2Sha256(pin, salt, iterations);

  return {
    pin_salt: bytesToBase64(salt),
    pin_hash: bytesToBase64(derived),
    pin_iter: iterations,
    pin_kdf: "pbkdf2_sha256",
  };
}

export async function verifyPin(pin: string, stored: Pick<PinHash, "pin_salt" | "pin_hash" | "pin_iter">) {
  const salt = base64ToBytes(stored.pin_salt);
  const expected = base64ToBytes(stored.pin_hash);
  const derived = await pbkdf2Sha256(pin, salt, clampInt(stored.pin_iter ?? 120_000, 50_000, 600_000));
  return constantTimeEqual(expected, derived);
}

