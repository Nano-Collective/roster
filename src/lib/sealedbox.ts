/**
 * libsodium's sealed box (`crypto_box_seal`), which is how GitHub takes a secret over its API.
 *
 * The portal stores a connector's key as a GitHub secret with the person's own token, on a
 * Worker as well as on a laptop, so it cannot hand the value to `gh`. GitHub wants it encrypted
 * to the repo's (or org's) public key: X25519, XSalsa20-Poly1305, and a nonce that is BLAKE2b of
 * the two public keys. roster has no runtime dependencies, so this is the whole of it, small
 * enough to read, and checked against libsodium itself in test/sealedbox.test.ts.
 *
 * Not constant-time. The only secret here is a one-use ephemeral key made per call, and the
 * value is on its way to GitHub in the same request, so there is nothing a timing could leak
 * that the request does not already carry.
 */

export function sealedBox(message: Uint8Array, recipientPublicKey: Uint8Array): Uint8Array {
  if (recipientPublicKey.length !== 32) throw new Error("a sealed box needs a 32-byte public key");
  const esk = new Uint8Array(32);
  crypto.getRandomValues(esk);
  const epk = x25519(esk, BASE);
  const nonce = blake2b(concat(epk, recipientPublicKey), 24);
  const k = hsalsa20(x25519(esk, recipientPublicKey), new Uint8Array(16));
  return concat(epk, secretbox(message, nonce, k));
}

/** For GitHub: the value as UTF-8, sealed to a base64 key, back as base64. */
export function sealForGitHub(value: string, publicKeyBase64: string): string {
  return toBase64(sealedBox(new TextEncoder().encode(value), fromBase64(publicKeyBase64)));
}

/* ------------------------------------------ X25519 ------------------------------------------ */

const P = 2n ** 255n - 19n;
const A24 = 121665n;
const BASE = (() => {
  const b = new Uint8Array(32);
  b[0] = 9;
  return b;
})();

const mod = (a: bigint) => ((a % P) + P) % P;

function pow(b: bigint, e: bigint): bigint {
  let r = 1n;
  let x = mod(b);
  while (e > 0n) {
    if (e & 1n) r = mod(r * x);
    x = mod(x * x);
    e >>= 1n;
  }
  return r;
}

const leToBig = (b: Uint8Array) => {
  let n = 0n;
  for (let i = b.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(b[i]!);
  return n;
};

const bigToLe = (n: bigint, len: number) => {
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return out;
};

/** RFC 7748's Montgomery ladder. */
export function x25519(scalar: Uint8Array, u: Uint8Array): Uint8Array {
  const k = scalar.slice();
  k[0]! &= 248;
  k[31]! &= 127;
  k[31]! |= 64;
  const uc = u.slice();
  uc[31]! &= 127;
  const x1 = leToBig(uc);
  const kn = leToBig(k);
  let x2 = 1n;
  let z2 = 0n;
  let x3 = x1;
  let z3 = 1n;
  let swap = 0n;
  for (let t = 254n; t >= 0n; t--) {
    const kt = (kn >> t) & 1n;
    swap ^= kt;
    if (swap) [x2, x3, z2, z3] = [x3, x2, z3, z2];
    swap = kt;
    const a = mod(x2 + z2);
    const aa = mod(a * a);
    const b = mod(x2 - z2);
    const bb = mod(b * b);
    const e = mod(aa - bb);
    const c = mod(x3 + z3);
    const d = mod(x3 - z3);
    const da = mod(d * a);
    const cb = mod(c * b);
    x3 = mod((da + cb) ** 2n);
    z3 = mod(x1 * mod((da - cb) ** 2n));
    x2 = mod(aa * bb);
    z2 = mod(e * mod(aa + A24 * e));
  }
  if (swap) [x2, z2] = [x3, z3];
  return bigToLe(mod(x2 * pow(z2, P - 2n)), 32);
}

/* ------------------------------------------ Salsa20 ----------------------------------------- */

const SIGMA = new TextEncoder().encode("expand 32-byte k");
const rotl = (v: number, c: number) => ((v << c) | (v >>> (32 - c))) >>> 0;
const u32 = (b: Uint8Array, i: number) =>
  (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24)) >>> 0;

function salsaState(key: Uint8Array, input16: Uint8Array): number[] {
  return [
    u32(SIGMA, 0),
    u32(key, 0),
    u32(key, 4),
    u32(key, 8),
    u32(key, 12),
    u32(SIGMA, 4),
    u32(input16, 0),
    u32(input16, 4),
    u32(input16, 8),
    u32(input16, 12),
    u32(SIGMA, 8),
    u32(key, 16),
    u32(key, 20),
    u32(key, 24),
    u32(key, 28),
    u32(SIGMA, 12),
  ];
}

function rounds(x: number[]): void {
  const qr = (a: number, b: number, c: number, d: number) => {
    x[b] = (x[b]! ^ rotl((x[a]! + x[d]!) >>> 0, 7)) >>> 0;
    x[c] = (x[c]! ^ rotl((x[b]! + x[a]!) >>> 0, 9)) >>> 0;
    x[d] = (x[d]! ^ rotl((x[c]! + x[b]!) >>> 0, 13)) >>> 0;
    x[a] = (x[a]! ^ rotl((x[d]! + x[c]!) >>> 0, 18)) >>> 0;
  };
  for (let i = 0; i < 10; i++) {
    qr(0, 4, 8, 12);
    qr(5, 9, 13, 1);
    qr(10, 14, 2, 6);
    qr(15, 3, 7, 11);
    qr(0, 1, 2, 3);
    qr(5, 6, 7, 4);
    qr(10, 11, 8, 9);
    qr(15, 12, 13, 14);
  }
}

function hsalsa20(key: Uint8Array, input16: Uint8Array): Uint8Array {
  const x = salsaState(key, input16);
  rounds(x);
  const out = new Uint8Array(32);
  [0, 5, 10, 15, 6, 7, 8, 9].forEach((w, i) => {
    out.set(le32(x[w]!), i * 4);
  });
  return out;
}

const le32 = (v: number) =>
  new Uint8Array([v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]);

/** XSalsa20's keystream, `len` bytes of it. */
function xsalsa20Stream(key: Uint8Array, nonce24: Uint8Array, len: number): Uint8Array {
  const sub = hsalsa20(key, nonce24.subarray(0, 16));
  const out = new Uint8Array(len);
  const input = new Uint8Array(16);
  input.set(nonce24.subarray(16, 24), 0);
  for (let block = 0, off = 0; off < len; block++, off += 64) {
    input.set(le32(block), 8);
    input.set(le32(Math.floor(block / 2 ** 32)), 12);
    const s = salsaState(sub, input);
    const x = s.slice();
    rounds(x);
    for (let i = 0; i < 16 && off + i * 4 < len; i++) {
      const w = le32((x[i]! + s[i]!) >>> 0);
      for (let j = 0; j < 4 && off + i * 4 + j < len; j++) out[off + i * 4 + j] = w[j]!;
    }
  }
  return out;
}

/** NaCl's secretbox: the Poly1305 tag, then the message XORed with the stream after 32 bytes. */
function secretbox(m: Uint8Array, nonce: Uint8Array, k: Uint8Array): Uint8Array {
  const stream = xsalsa20Stream(k, nonce, m.length + 32);
  const c = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) c[i] = m[i]! ^ stream[i + 32]!;
  return concat(poly1305(c, stream.subarray(0, 32)), c);
}

/* ------------------------------------------ Poly1305 ---------------------------------------- */

function poly1305(m: Uint8Array, key: Uint8Array): Uint8Array {
  const p = 2n ** 130n - 5n;
  const r = leToBig(key.subarray(0, 16)) & 0x0ffffffc0ffffffc0ffffffc0fffffffn;
  const s = leToBig(key.subarray(16, 32));
  let acc = 0n;
  for (let i = 0; i < m.length; i += 16) {
    const chunk = m.subarray(i, i + 16);
    const n = leToBig(chunk) + (1n << BigInt(8 * chunk.length));
    acc = ((acc + n) * r) % p;
  }
  return bigToLe((acc + s) & ((1n << 128n) - 1n), 16);
}

/* ------------------------------------------ BLAKE2b ----------------------------------------- */

const M64 = (1n << 64n) - 1n;
const IV = [
  0x6a09e667f3bcc908n,
  0xbb67ae8584caa73bn,
  0x3c6ef372fe94f82bn,
  0xa54ff53a5f1d36f1n,
  0x510e527fade682d1n,
  0x9b05688c2b3e6c1fn,
  0x1f83d9abfb41bd6bn,
  0x5be0cd19137e2179n,
];
const SIG = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
  [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4],
  [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
  [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13],
  [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
  [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11],
  [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
  [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5],
  [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0],
];
const rotr = (v: bigint, n: bigint) => ((v >> n) | (v << (64n - n))) & M64;

/** Unkeyed BLAKE2b, `outLen` bytes. */
export function blake2b(input: Uint8Array, outLen: number): Uint8Array {
  const h = IV.slice();
  h[0] = h[0]! ^ 0x01010000n ^ BigInt(outLen);
  const blocks = Math.max(1, Math.ceil(input.length / 128));
  for (let b = 0; b < blocks; b++) {
    const last = b === blocks - 1;
    const block = new Uint8Array(128);
    block.set(input.subarray(b * 128, b * 128 + 128));
    const m = Array.from({ length: 16 }, (_, i) => leToBig(block.subarray(i * 8, i * 8 + 8)));
    const t = BigInt(last ? input.length : (b + 1) * 128);
    const v = [...h, ...IV];
    v[12] = v[12]! ^ (t & M64);
    v[13] = v[13]! ^ (t >> 64n);
    if (last) v[14] = v[14]! ^ M64;
    const g = (a: number, bb: number, c: number, d: number, x: bigint, y: bigint) => {
      v[a] = (v[a]! + v[bb]! + x) & M64;
      v[d] = rotr(v[d]! ^ v[a]!, 32n);
      v[c] = (v[c]! + v[d]!) & M64;
      v[bb] = rotr(v[bb]! ^ v[c]!, 24n);
      v[a] = (v[a]! + v[bb]! + y) & M64;
      v[d] = rotr(v[d]! ^ v[a]!, 16n);
      v[c] = (v[c]! + v[d]!) & M64;
      v[bb] = rotr(v[bb]! ^ v[c]!, 63n);
    };
    for (let r = 0; r < 12; r++) {
      const s = SIG[r % 10]!;
      g(0, 4, 8, 12, m[s[0]!]!, m[s[1]!]!);
      g(1, 5, 9, 13, m[s[2]!]!, m[s[3]!]!);
      g(2, 6, 10, 14, m[s[4]!]!, m[s[5]!]!);
      g(3, 7, 11, 15, m[s[6]!]!, m[s[7]!]!);
      g(0, 5, 10, 15, m[s[8]!]!, m[s[9]!]!);
      g(1, 6, 11, 12, m[s[10]!]!, m[s[11]!]!);
      g(2, 7, 8, 13, m[s[12]!]!, m[s[13]!]!);
      g(3, 4, 9, 14, m[s[14]!]!, m[s[15]!]!);
    }
    for (let i = 0; i < 8; i++) h[i] = h[i]! ^ v[i]! ^ v[i + 8]!;
  }
  const out = new Uint8Array(64);
  h.forEach((w, i) => {
    out.set(bigToLe(w, 8), i * 8);
  });
  return out.slice(0, outLen);
}

/* ------------------------------------------ bytes ------------------------------------------- */

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function toBase64(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}

function fromBase64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
