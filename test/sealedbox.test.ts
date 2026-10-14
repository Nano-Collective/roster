import assert from "node:assert/strict";
import { test } from "node:test";
import sodium from "libsodium-wrappers";
import { blake2b, sealedBox, sealForGitHub, x25519 } from "../src/lib/sealedbox.js";

/**
 * GitHub opens what the portal seals with libsodium, so libsodium is the judge. Every case here
 * is sealed by roster's own code and opened by the real thing: a mistake anywhere in the chain
 * is a value GitHub stores as garbage, and a run that fails a week later with a bad key.
 */

await sodium.ready;

test("libsodium opens what roster seals, at every length a key comes in", () => {
  const { publicKey, privateKey } = sodium.crypto_box_keypair();
  for (const len of [0, 1, 15, 16, 17, 63, 64, 65, 200, 1000]) {
    const message = new Uint8Array(len).map((_, i) => (i * 7 + len) & 255);
    const opened = sodium.crypto_box_seal_open(sealedBox(message, publicKey), publicKey, privateKey);
    assert.deepEqual(opened, message, `length ${len}`);
  }
});

test("the base64 form GitHub takes round-trips a real-looking key", () => {
  const { publicKey, privateKey } = sodium.crypto_box_keypair();
  const sealed = sealForGitHub("rk_live_51abc£€", sodium.to_base64(publicKey, sodium.base64_variants.ORIGINAL));
  const opened = sodium.crypto_box_seal_open(
    sodium.from_base64(sealed, sodium.base64_variants.ORIGINAL),
    publicKey,
    privateKey,
  );
  assert.equal(sodium.to_string(opened), "rk_live_51abc£€");
});

test("X25519 agrees with libsodium", () => {
  const a = sodium.randombytes_buf(32);
  const b = sodium.randombytes_buf(32);
  assert.deepEqual(x25519(a, sodium.crypto_scalarmult_base(b)), sodium.crypto_scalarmult(a, sodium.crypto_scalarmult_base(b)));
});

test("BLAKE2b agrees with libsodium, across a block boundary", () => {
  for (const len of [0, 64, 127, 128, 129, 300]) {
    const m = sodium.randombytes_buf(len);
    assert.deepEqual(blake2b(m, 24), sodium.crypto_generichash(24, m, null), `length ${len}`);
  }
});

test("two seals of the same value differ, so a stored key says nothing about another", () => {
  const { publicKey } = sodium.crypto_box_keypair();
  const m = new TextEncoder().encode("same");
  assert.notDeepEqual(sealedBox(m, publicKey), sealedBox(m, publicKey));
});
