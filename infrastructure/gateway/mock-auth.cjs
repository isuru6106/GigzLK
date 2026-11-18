const http = require("node:http");

let operationRequests = 0;

const server = http.createServer((request, response) => {
  request.resume();

  if (request.method === "GET" && request.url === "/__stats") {
    response.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    response.end(JSON.stringify({ operationRequests }));
    return;
  }

  operationRequests += 1;

  response.writeHead(200, {
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=60",
    "Set-Cookie": "mock-only=1; HttpOnly; SameSite=Lax",
  });

  response.end(JSON.stringify({
    status: "MOCK_UPSTREAM_ONLY",
    method: request.method,
    path: request.url,
    operationRequests,
    receivedAuthorization: request.headers.authorization !== undefined,
    receivedCookie: request.headers.cookie !== undefined,
    receivedServiceIdentity:
      request.headers["x-service-identity"] !== undefined,
  }));
});

server.listen(3006, "0.0.0.0", () => {
  console.log("Mock upstream listening; no Auth integration enabled.");
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});