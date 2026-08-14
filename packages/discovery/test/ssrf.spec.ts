import { describe, expect, it } from "vitest";

import { fetch as undiciFetch } from "undici";

import {
  __testing,
  assertPublicUrl,
  classifyAddress,
  resolveAndValidate,
  safeFetch,
  SSRF_KNOWN_GAPS,
  SsrfError,
} from "../src/ssrf";

/**
 * These are negative tests, so each one is written to be capable of failing:
 * the blocked cases assert a specific rejection reason rather than merely
 * "it threw", and the allowed cases assert the same function accepts them.
 * A blocklist that rejects everything passes a test that only checks for
 * rejection, and proves nothing.
 */

describe("address classification", () => {
  const blocked: Array<[string, RegExp]> = [
    ["169.254.169.254", /link-local/], // AWS/GCP/Azure metadata
    ["169.254.170.2", /link-local/], // ECS task metadata
    ["127.0.0.1", /loopback/],
    ["10.0.0.1", /private/],
    ["172.16.0.1", /private/],
    ["172.31.255.255", /private/],
    ["192.168.1.1", /private/],
    ["100.64.0.1", /CGNAT/],
    ["0.0.0.0", /this network/],
    ["224.0.0.1", /multicast/],
    ["255.255.255.255", /reserved/],
    ["::1", /loopback/],
    ["fe80::1", /link-local/],
    ["fd00::1", /unique-local/],
    ["::ffff:169.254.169.254", /IPv4-mapped.*link-local/],
    ["::ffff:127.0.0.1", /IPv4-mapped.*loopback/],
    ["2002:a9fe:a9fe::", /6to4/],
    ["64:ff9b::a9fe:a9fe", /NAT64/],
  ];

  it.each(blocked)("blocks %s", (ip, reason) => {
    const result = classifyAddress(ip);
    expect(result, `${ip} should be blocked`).not.toBeNull();
    expect(result).toMatch(reason);
  });

  // Without these, a blocklist that returns "blocked" for everything passes.
  const allowed = [
    "8.8.8.8",
    "1.1.1.1",
    "93.184.216.34",
    "172.32.0.1", // just outside 172.16/12
    "172.15.255.255", // just below it
    "100.128.0.1", // just outside CGNAT 100.64/10
    "2606:2800:220:1:248:1893:25c8:1946",
  ];

  it.each(allowed)("allows the public address %s", (ip) => {
    expect(classifyAddress(ip)).toBeNull();
  });

  it("rejects non-canonical IPv4 encodings rather than parsing them", () => {
    // 0177.0.0.1 is octal for 127.0.0.1 and 2130706433 is its decimal form.
    // Both are classic blocklist bypasses. We do not try to decode them: a
    // non-canonical address is treated as not-an-address and refused.
    expect(classifyAddress("0177.0.0.1")).not.toBeNull();
    expect(classifyAddress("2130706433")).not.toBeNull();
    expect(classifyAddress("127.1")).not.toBeNull();
  });
});

describe("assertPublicUrl", () => {
  it("refuses http", async () => {
    await expect(assertPublicUrl("http://example.com")).rejects.toThrow(/https only/);
  });

  it("refuses a literal metadata address", async () => {
    await expect(
      assertPublicUrl("https://169.254.169.254/latest/meta-data/"),
    ).rejects.toThrow(/link-local/);
  });

  it("refuses a bracketed IPv6 loopback", async () => {
    await expect(assertPublicUrl("https://[::1]/")).rejects.toThrow(/loopback/);
  });

  it("refuses embedded credentials", async () => {
    await expect(assertPublicUrl("https://user:pw@example.com")).rejects.toThrow(
      /credentials/,
    );
  });

  it("refuses a hostname that resolves to loopback", async () => {
    // localhost is the honest, dependency-free stand-in for a hostile DNS
    // record pointing at a private address: the hostname says nothing, and
    // only the resolved address gives it away.
    await expect(assertPublicUrl("https://localhost/")).rejects.toThrow(/loopback/);
  });

  it("accepts an ordinary public URL", async () => {
    const url = await assertPublicUrl("https://api.openalex.org/works");
    expect(url.hostname).toBe("api.openalex.org");
  });

  it("reports the offending URL on the error", async () => {
    await expect(assertPublicUrl("https://127.0.0.1/x")).rejects.toBeInstanceOf(
      SsrfError,
    );
  });
});

describe("safeFetch", () => {
  it("refuses a private target before opening a socket", async () => {
    await expect(safeFetch("https://127.0.0.1:1/")).rejects.toThrow(/loopback/);
  });

  it("enforces the byte cap", async () => {
    // 1 byte is below any real response, so this proves the cap is applied
    // rather than merely present.
    await expect(
      safeFetch("https://api.openalex.org/works?per_page=1", { maxBytes: 1 }),
    ).rejects.toThrow(/bytes/);
  }, 20_000);
});

describe("address pinning (DNS rebinding)", () => {
  /**
   * The rebinding attack is: we resolve a name, approve the address, and then
   * `fetch` resolves the SAME name again and gets a different one. Validation
   * is worthless if nothing connects to what it checked.
   *
   * Proving the pin works needs evidence that the socket ignored DNS. So:
   * pin api.openalex.org to a public address that is NOT OpenAlex. If the pin
   * is in effect, the TCP connection lands on the wrong host and TLS fails on
   * the certificate name. If the pin were ignored, DNS would resolve the real
   * OpenAlex and the request would simply succeed — which is exactly the
   * behaviour that would mean we are still vulnerable.
   */
  it("sends the socket to the pinned address, not to DNS", async () => {
    // 8.8.8.8 serves HTTPS under a dns.google certificate, so a connection
    // pinned there cannot complete a handshake for api.openalex.org.
    //
    // The assertion is deliberately "it fails" rather than a specific error:
    // any failure proves the point, because WITHOUT the pin this exact
    // request succeeds — DNS would resolve the real OpenAlex and return 200.
    // The next test is the complement and stops this from passing merely
    // because pinning broke everything.
    //
    // (An earlier draft pinned to 1.1.1.1 and got a 403 instead of a TLS
    // error: OpenAlex is behind Cloudflare, so 1.1.1.1 could serve a valid
    // certificate for it. Same conclusion, far more fragile.)
    const agent = __testing.pinnedAgent("8.8.8.8");
    try {
      await expect(
        undiciFetch("https://api.openalex.org/works?per_page=1", { dispatcher: agent }),
      ).rejects.toThrow();
    } finally {
      await agent.close();
    }
  }, 20_000);

  it("still reaches a host when pinned to its own real address", async () => {
    // The complement: pinning is not simply breaking everything.
    const { addresses } = await resolveAndValidate("https://api.openalex.org/works");
    const agent = __testing.pinnedAgent(addresses[0]!);
    try {
      const response = await undiciFetch("https://api.openalex.org/works?per_page=1", {
        dispatcher: agent,
      });
      expect(response.status).toBe(200);
      await response.body?.cancel();
    } finally {
      await agent.close();
    }
  }, 20_000);

  it("reports no remaining security gaps, only an availability one", () => {
    // If a rebinding entry ever reappears here, the pin was removed.
    expect(SSRF_KNOWN_GAPS.join(" ")).not.toMatch(/rebinding/i);
  });
});
