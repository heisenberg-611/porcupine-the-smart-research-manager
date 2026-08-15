import sodium from "libsodium-wrappers-sumo";
import { beforeAll, describe, expect, it } from "vitest";

import { initCrypto } from "./identity";
import {
  createProjectKey,
  unwrapProjectKey,
  wrapProjectKeyFor,
  type WrapContext,
} from "./project-key";

/**
 * The claim under test is not "the key round-trips". It is that a wrap the
 * SERVER could have produced or moved is refused.
 *
 * `crypto_box_seal` is anonymous, and the server holds every member's public
 * key — so it can seal a key of its own choosing to anyone. Every assertion
 * below is about the signature that makes that detectable, and each one is
 * written so it can fail.
 */

interface Member {
  identityPub: Uint8Array;
  identityPriv: Uint8Array;
  signPub: Uint8Array;
  signPriv: Uint8Array;
  id: string;
}

function member(id: string): Member {
  const box = sodium.crypto_box_keypair();
  const sign = sodium.crypto_sign_keypair();
  return {
    id,
    identityPub: box.publicKey,
    identityPriv: box.privateKey,
    signPub: sign.publicKey,
    signPriv: sign.privateKey,
  };
}

describe("project key wraps", () => {
  let alice: Member;
  let bob: Member;
  let server: Member;
  let context: WrapContext;

  beforeAll(async () => {
    await initCrypto();
    alice = member("11111111-1111-1111-1111-111111111111");
    bob = member("22222222-2222-2222-2222-222222222222");
    // Stands in for anyone holding public keys and a place to put rows.
    server = member("99999999-9999-9999-9999-999999999999");
    context = {
      projectId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      userId: bob.id,
      epoch: 1,
    };
  });

  it("lets the member it was sealed to open it", async () => {
    const projectKey = await createProjectKey();
    const wrap = await wrapProjectKeyFor(
      projectKey,
      bob.identityPub,
      alice.signPriv,
      context,
    );

    const opened = await unwrapProjectKey(
      wrap,
      context,
      alice.signPub,
      bob.identityPub,
      bob.identityPriv,
    );
    expect(opened).toEqual(projectKey);
  });

  it("refuses a wrap the server sealed itself", async () => {
    // The attack the signature exists for. The server knows Bob's public key,
    // so it can seal a key it chose — Bob decrypts it happily, encrypts his
    // next message under it, and the server reads everything after.
    const attackerKey = await createProjectKey();
    const forged = await wrapProjectKeyFor(
      attackerKey,
      bob.identityPub,
      server.signPriv,
      context,
    );

    await expect(
      unwrapProjectKey(forged, context, alice.signPub, bob.identityPub, bob.identityPriv),
    ).rejects.toThrow(/not signed by/i);
  });

  it("refuses a wrap moved to another epoch", async () => {
    // Replay. The row's epoch is a column the server writes, so a wrap that
    // signed only its ciphertext could be relabelled as a later epoch and
    // quietly undo a rotation.
    const projectKey = await createProjectKey();
    const wrap = await wrapProjectKeyFor(
      projectKey,
      bob.identityPub,
      alice.signPriv,
      context,
    );

    await expect(
      unwrapProjectKey(
        wrap,
        { ...context, epoch: 2 },
        alice.signPub,
        bob.identityPub,
        bob.identityPriv,
      ),
    ).rejects.toThrow(/not signed by/i);
  });

  it("refuses a wrap moved to another member's row", async () => {
    const projectKey = await createProjectKey();
    const wrap = await wrapProjectKeyFor(
      projectKey,
      bob.identityPub,
      alice.signPriv,
      context,
    );

    await expect(
      unwrapProjectKey(
        wrap,
        { ...context, userId: alice.id },
        alice.signPub,
        bob.identityPub,
        bob.identityPriv,
      ),
    ).rejects.toThrow(/not signed by/i);
  });

  it("refuses a wrap moved to another project", async () => {
    const projectKey = await createProjectKey();
    const wrap = await wrapProjectKeyFor(
      projectKey,
      bob.identityPub,
      alice.signPriv,
      context,
    );

    await expect(
      unwrapProjectKey(
        wrap,
        { ...context, projectId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" },
        alice.signPub,
        bob.identityPub,
        bob.identityPriv,
      ),
    ).rejects.toThrow(/not signed by/i);
  });

  it("refuses a tampered ciphertext", async () => {
    const projectKey = await createProjectKey();
    const wrap = await wrapProjectKeyFor(
      projectKey,
      bob.identityPub,
      alice.signPriv,
      context,
    );

    const wrappedKey = new Uint8Array(wrap.wrappedKey);
    const at = wrappedKey.length - 1;
    wrappedKey[at] = (wrappedKey[at] ?? 0) ^ 0xff;

    await expect(
      unwrapProjectKey(
        { ...wrap, wrappedKey },
        context,
        alice.signPub,
        bob.identityPub,
        bob.identityPriv,
      ),
    ).rejects.toThrow(/not signed by/i);
  });

  it("will not open for a member it was not sealed to", async () => {
    // Alice signs a wrap addressed to Bob and then tries to open it herself.
    // The signature verifies — she made it — so this is the seal doing the
    // work, and it proves the two checks are independent.
    const projectKey = await createProjectKey();
    const wrap = await wrapProjectKeyFor(
      projectKey,
      bob.identityPub,
      alice.signPriv,
      context,
    );

    await expect(
      unwrapProjectKey(
        wrap,
        context,
        alice.signPub,
        alice.identityPub,
        alice.identityPriv,
      ),
    ).rejects.toThrow(/not sealed to you/i);
  });

  it("gives every epoch a different key", async () => {
    // A rotation that reused the key would look identical from the outside and
    // protect nothing.
    const first = await createProjectKey();
    const second = await createProjectKey();
    expect(first).not.toEqual(second);
    expect(first).toHaveLength(32);
  });
});
