const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs");

const ca = fs.readFileSync("/certs/ca.crt");
const syntheticAssertion = "Bearer test.assertion.only";

function request({
  secure = true,
  hostname = "gateway",
  port = secure ? 8443 : 8080,
  path = "/internal/v1/auth/login",
  method = "POST",
  authorization = syntheticAssertion,
  headers = {},
  trustCA = true,
  servername,
} = {}) {
  return new Promise((resolve, reject) => {
    const transport = secure ? https : http;
    const requestHeaders = { ...headers };

    if (authorization !== null) {
      requestHeaders.Authorization = authorization;
    }

    const options = {
      hostname,
      port,
      path,
      method,
      headers: requestHeaders,
      agent: false,
    };

    if (secure) {
      if (trustCA) options.ca = ca;
      if (servername) options.servername = servername;
    }

    const outgoing = transport.request(options, (response) => {
      let body = "";

      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("error", reject);
      response.on("end", () => {
        resolve({
          status: response.statusCode,
          headers: response.headers,
          body,
        });
      });
    });

    outgoing.setTimeout(5000, () => {
      outgoing.destroy(new Error("Request timed out"));
    });

    outgoing.on("error", reject);
    outgoing.end();
  });
}

async function upstreamCount() {
  const response = await request({
    secure: false,
    hostname: "mock",
    port: 3006,
    path: "/__stats",
    method: "GET",
    authorization: null,
  });

  assert.equal(response.status, 200);
  return JSON.parse(response.body).operationRequests;
}

function assertRejected(response) {
  assert.ok(
    response.status >= 400 && response.status < 500,
    `Expected rejection; received HTTP ${response.status}`,
  );
  assert.equal(response.headers.location, undefined);
  assert.equal(response.headers["cache-control"], "no-store");
}

test("Gateway routing and TLS boundaries", async (t) => {
  await t.test("all six exact private POST paths reach the mock", async () => {
    const before = await upstreamCount();

    for (const suffix of [
      "login",
      "refresh",
      "session/check",
      "logout",
      "logout-all",
      "mfa/challenge",
    ]) {
      const path = `/internal/v1/auth/${suffix}`;
      const response = await request({ path });

      assert.equal(response.status, 200);
      assert.equal(response.headers["cache-control"], "no-store");
      assert.equal(response.headers["set-cookie"], undefined);

      const body = JSON.parse(response.body);
      assert.equal(body.status, "MOCK_UPSTREAM_ONLY");
      assert.equal(body.method, "POST");
      assert.equal(body.path, path);
      assert.equal(body.receivedAuthorization, true);
    }

    assert.equal(await upstreamCount(), before + 6);
  });

  await t.test("public listener never forwards Auth paths", async () => {
    const before = await upstreamCount();

    for (const path of [
      "/internal",
      "/internal/v1/auth/login",
      "/internal/v1/auth/refresh",
      "/internal/v1/auth/session/check",
      "/internal/v1/auth/logout",
      "/internal/v1/auth/logout-all",
      "/internal/v1/auth/mfa/challenge",
      "/api/v1/auth/login",
    ]) {
      assertRejected(await request({ secure: false, path }));
    }

    assert.equal(await upstreamCount(), before);
  });

  await t.test("private path aliases and queries are rejected", async () => {
    const before = await upstreamCount();

    for (const path of [
      "/internal/v1/auth/login/",
      "/internal//v1/auth/login",
      "/internal/v1/auth/./login",
      "/internal/v1/auth/other/../login",
      "/internal/v1/auth/%6cogin",
      "/internal/v1/auth/%2elogin",
      "/internal/v1/auth/login%2f",
      "/INTERNAL/v1/auth/login",
      "/internal/v1/auth/LOGIN",
      "/internal/v1/auth/login?test=1",
      "/internal/v1/auth/login?",
      "/internal/v1/auth/login;test=1",
      "/internal/v1/auth\\login",
      "/internal/v1/auth/unknown",
      "http://gateway/internal/v1/auth/login",
    ]) {
      assertRejected(await request({ path }));
    }

    assert.equal(await upstreamCount(), before);
  });

  await t.test("non-POST methods never reach the mock", async () => {
    const before = await upstreamCount();

    for (const method of ["GET", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]) {
      assertRejected(await request({ method }));
    }

    assert.equal(await upstreamCount(), before);
  });

  await t.test("missing and oversized assertion headers are rejected", async () => {
    const before = await upstreamCount();

    for (const authorization of [
      null,
      "Bearer ",
      "Basic synthetic",
      `Bearer ${"a".repeat(4097)}`,
    ]) {
      assertRejected(await request({ authorization }));
    }

    assert.equal(await upstreamCount(), before);
  });

  await t.test("4096-byte synthetic assertion passes gateway size check", async () => {
    const token = `a.b.${"c".repeat(4092)}`;
    assert.equal(Buffer.byteLength(token, "ascii"), 4096);

    const before = await upstreamCount();
    const response = await request({
      authorization: `Bearer ${token}`,
    });

    assert.equal(response.status, 200);
    assert.equal(await upstreamCount(), before + 1);
  });

  await t.test("browser cookies and caller identity headers are stripped", async () => {
    const response = await request({
      headers: {
        Cookie: "synthetic-cookie=1",
        "X-Service-Identity": "synthetic-admin",
      },
    });

    assert.equal(response.status, 200);

    const body = JSON.parse(response.body);
    assert.equal(body.receivedAuthorization, true);
    assert.equal(body.receivedCookie, false);
    assert.equal(body.receivedServiceIdentity, false);
  });

  await t.test("TLS rejects an untrusted certificate", async () => {
    const before = await upstreamCount();

    await assert.rejects(
      request({ trustCA: false }),
      (error) => [
        "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
        "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
        "SELF_SIGNED_CERT_IN_CHAIN",
        "DEPTH_ZERO_SELF_SIGNED_CERT",
      ].includes(error.code),
    );

    assert.equal(await upstreamCount(), before);
  });

  await t.test("TLS rejects the wrong server hostname", async () => {
    const before = await upstreamCount();

    await assert.rejects(
      request({ servername: "wrong-host.invalid" }),
      { code: "ERR_TLS_CERT_ALTNAME_INVALID" },
    );

    assert.equal(await upstreamCount(), before);
  });
});