/**
 * @file idempotency.ts
 * @description Pure helpers for variable-creation idempotency keys.
 *
 * Spec: docs/knowledge/variable-resolver-design-2026-05.md §3.1
 *
 *   idempotency_key = sha256(collection_id + "|" + name + "|" + type + "|" +
 *                            canonical_json(values_by_mode))
 *
 * Properties:
 *  - Same call with same values → idempotent reuse, returns existing variable_id.
 *  - Same call with NEW `values_by_mode` → key changes → wrapper does NOT silently
 *    reuse the old variable. Caller must explicitly call `set_variable_value`.
 *  - Random / caller-chosen keys are rejected (validated against the formula).
 *
 * `canonical_json` is JSON with sorted keys and no whitespace, so semantically-
 * equal value maps produce identical keys regardless of insertion order.
 *
 * SHA-256 is implemented inline (pure JS, sync) because the Figma plugin
 * sandbox does not expose Node's `crypto` module and the async `crypto.subtle`
 * API would force every callsite (and the synchronous handler signatures)
 * to become async. The hash here is a fingerprint, not a security primitive,
 * so we accept the slightly larger code footprint in exchange for sync use.
 */

/**
 * Canonical JSON: deterministic stringification with sorted keys and no
 * whitespace. Recursively sorts object keys; arrays preserve order (their
 * order is semantic).
 *
 * Note: this differs from JSON.stringify in that `{b:1,a:2}` and `{a:2,b:1}`
 * produce the same string. NaN/Infinity become null (JSON.stringify default).
 */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return JSON.stringify(value ?? null);
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJson).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const k of keys) {
    parts.push(JSON.stringify(k) + ':' + canonicalJson(obj[k]));
  }
  return '{' + parts.join(',') + '}';
}

/**
 * Compute the canonical idempotency key for a variable.
 *
 *   sha256(collection_id + "|" + name + "|" + type + "|" + canonical_json(values_by_mode))
 *
 * Returns a lowercase hex digest (64 chars).
 */
export function computeVariableIdempotencyKey(args: {
  collection_id: string;
  name: string;
  type: 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN';
  values_by_mode: Record<string, unknown>;
}): string {
  const payload =
    args.collection_id + '|' +
    args.name + '|' +
    args.type + '|' +
    canonicalJson(args.values_by_mode ?? {});
  return sha256Hex(payload);
}

// ───────────────────────────────────────────────────────────────────────────
// SHA-256 — pure JS, synchronous. Adapted from public-domain reference impl.
// Input: UTF-8 string. Output: lowercase hex digest.
// ───────────────────────────────────────────────────────────────────────────

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

function utf8Encode(str: string): Uint8Array {
  // Use TextEncoder when available (browsers, modern Node, Figma sandbox).
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(str);
  }
  // Manual UTF-8 fallback for environments without TextEncoder.
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c < 0x80) {
      bytes.push(c);
    } else if (c < 0x800) {
      bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c < 0xd800 || c >= 0xe000) {
      bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    } else {
      // surrogate pair
      i++;
      const c2 = str.charCodeAt(i);
      const cp = 0x10000 + (((c & 0x3ff) << 10) | (c2 & 0x3ff));
      bytes.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    }
  }
  return new Uint8Array(bytes);
}

export function sha256Hex(input: string): string {
  const msg = utf8Encode(input);
  const bitLen = msg.length * 8;

  // Pre-processing: append "1" bit + zero pad + 64-bit length
  const padLen = ((msg.length + 9 + 63) & ~63) - msg.length;
  const padded = new Uint8Array(msg.length + padLen);
  padded.set(msg);
  padded[msg.length] = 0x80;
  // Big-endian 64-bit length (we only fill low 32 bits — strings won't exceed 4GB)
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 4, bitLen >>> 0, false);
  dv.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000) >>> 0, false);

  // Initial hash values
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);

  const W = new Uint32Array(64);

  for (let chunkStart = 0; chunkStart < padded.length; chunkStart += 64) {
    for (let i = 0; i < 16; i++) {
      W[i] = dv.getUint32(chunkStart + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }

    let a = H[0], b = H[1], c = H[2], d = H[3];
    let e = H[4], f = H[5], g = H[6], h = H[7];

    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + W[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + h) >>> 0;
  }

  let hex = '';
  for (let i = 0; i < 8; i++) {
    hex += H[i].toString(16).padStart(8, '0');
  }
  return hex;
}
