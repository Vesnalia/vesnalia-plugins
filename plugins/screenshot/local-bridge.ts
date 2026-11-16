import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

/** Prove that the VesnALIA browser and the host worker run on the same computer. */
export async function createLocalBridge() {
  const token = randomBytes(32).toString("hex");
  // The response secret stays out of the request, so an unrelated local service cannot echo a valid proof.
  const identity = randomBytes(32).toString("hex");
  const server = createServer((request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Headers", "Authorization");
    response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    response.setHeader("Access-Control-Allow-Private-Network", "true");
    response.setHeader("Cache-Control", "no-store");
    if (request.method === "OPTIONS") {
      response.writeHead(204).end();
      return;
    }
    const authorization = Buffer.from(request.headers.authorization ?? "");
    const expected = Buffer.from(`Bearer ${token}`);
    if (
      request.method !== "GET" ||
      request.url !== "/alia-screenshot/identify" ||
      authorization.length !== expected.length ||
      !timingSafeEqual(authorization, expected)
    ) {
      response.writeHead(403).end();
      return;
    }
    response
      .writeHead(200, { "Content-Type": "application/json" })
      .end(JSON.stringify({ identity }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Could not start the local screenshot connection.");
  let closing: Promise<void> | undefined;
  return {
    port: address.port,
    token,
    identity,
    close: () =>
      (closing ??= new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      })),
  };
}
