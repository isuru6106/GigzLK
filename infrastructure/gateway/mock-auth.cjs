const http = require("node:http");
const { createHash } = require("node:crypto");

let operationRequests = 0;

const server = http.createServer((request, response) => {
  if (request.method === "GET" && request.url === "/__stats") {
    request.resume();
    response.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    response.end(JSON.stringify({ operationRequests }));
    return;
  }

  operationRequests += 1;

  const chunks = [];
  let size = 0;
  let tooLarge = false;

  request.on("data", (chunk) => {
    size += chunk.length;

    if (size > 16384) {
      tooLarge = true;
      chunks.length = 0;
      return;
    }

    if (!tooLarge) chunks.push(chunk);
  });

  request.on("error", () => response.destroy());

  request.on("end", () => {
    if (tooLarge) {
      response.writeHead(413, { "Cache-Control": "no-store" });
      response.end();
      return;
    }

    const body = Buffer.concat(chunks);
    let input = {};

    if (body.length > 0) {
      try {
        input = JSON.parse(body.toString("utf8"));
      } catch {
        response.writeHead(400, { "Cache-Control": "no-store" });
        response.end();
        return;
      }
    }

    const scenario = input?.testScenario;

    if (scenario === "disconnect") {
      response.destroy();
      return;
    }

    const metadata = {
      status: "MOCK_UPSTREAM_ONLY",
      method: request.method,
      path: request.url,
      operationRequests,
      bodyBytes: body.length,
      bodySha256: createHash("sha256").update(body).digest("hex"),
      receivedContentType: request.headers["content-type"] ?? null,
      receivedAuthorization: request.headers.authorization !== undefined,
      receivedCookie: request.headers.cookie !== undefined,
      receivedServiceIdentity:
        request.headers["x-service-identity"] !== undefined,
    };

    function send(status, extraHeaders = {}) {
      if (response.destroyed) return;

      response.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=60",
        "Set-Cookie": "mock-only=1; HttpOnly; SameSite=Lax",
        ...extraHeaders,
      });
      response.end(JSON.stringify(metadata));
    }

    if (scenario === "unavailable") {
      send(503);
      return;
    }

    if (scenario === "redirect") {
      send(307, {
        Location: "http://mock:3006/mock-redirect-target",
      });
      return;
    }

    if (scenario === "timeout") {
      const timer = setTimeout(() => send(200), 6500);
      response.once("close", () => clearTimeout(timer));
      return;
    }

    send(200);
  });
});

server.listen(3006, "0.0.0.0", () => {
  console.log("Mock upstream listening; no Auth integration enabled.");
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});