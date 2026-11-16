import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";

const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>BT Fixture</title></head>
  <body>
    <h1>Browser Tools Fixture</h1>
    <button id="inc">Increment</button><span id="count">0</span>
    <label for="name">Name</label>
    <input id="name" /><span id="mirror"></span>
    <button id="greet">Greet</button><span id="greeting"></span>
    <button id="slow">Slow update</button><span id="slow-result"></span>
    <button id="fetch404">Fetch missing</button><span id="status"></span>
    <button id="console-error">Console error</button>
    <button id="console-secret">Console secret</button>
    <button id="pageerror">Page error</button>
    <div id="list"><button id="a">A</button><button id="b">B</button><button id="c">C</button></div>
    <button id="reorder">Reorder</button>
    <button id="deep">Add deep DOM</button><div id="deep-root"></div>
    <button id="tall">Add tall content</button><div id="tall-root"></div>
    <input id="key-input" aria-label="Key input" /><span id="last-key"></span>
    <div id="editable" contenteditable="true">edit me</div>
    <iframe id="frame" src="/frame" title="fixture frame"></iframe>
    <script>
      document.getElementById("inc").addEventListener("click", () => {
        document.getElementById("count").textContent = String(Number(document.getElementById("count").textContent) + 1);
      });
      document.getElementById("name").addEventListener("input", (event) => {
        document.getElementById("mirror").textContent = event.target.value;
      });
      document.getElementById("greet").addEventListener("click", () => {
        document.getElementById("greeting").textContent = "Hello, " + document.getElementById("name").value;
      });
      document.getElementById("slow").addEventListener("click", () => {
        setTimeout(() => { document.getElementById("slow-result").textContent = "slow done"; }, 500);
      });
      document.getElementById("fetch404").addEventListener("click", async () => {
        const response = await fetch("/missing");
        document.getElementById("status").textContent = String(response.status);
      });
      document.getElementById("console-error").addEventListener("click", () => {
        console.error("fixture console error");
      });
      document.getElementById("console-secret").addEventListener("click", () => {
        console.log("authorization bearer=abcd1234secretvalue");
      });
      document.getElementById("pageerror").addEventListener("click", () => {
        setTimeout(() => { throw new Error("fixture page error"); }, 0);
      });
      document.getElementById("reorder").addEventListener("click", () => {
        document.getElementById("list").appendChild(document.getElementById("a"));
      });
      document.getElementById("deep").addEventListener("click", () => {
        const root = document.getElementById("deep-root");
        for (let index = 0; index < 3000; index += 1) {
          const div = document.createElement("div");
          div.textContent = "deep node " + index;
          root.appendChild(div);
        }
      });
      document.getElementById("tall").addEventListener("click", () => {
        const root = document.getElementById("tall-root");
        const div = document.createElement("div");
        div.style.height = "3000px";
        div.textContent = "tall content";
        root.appendChild(div);
      });
      document.getElementById("key-input").addEventListener("keydown", (event) => {
        document.getElementById("last-key").textContent = event.key + (event.ctrlKey ? "+ctrl" : "");
      });
    </script>
  </body>
</html>`;

const FRAME_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><title>Fixture frame</title></head>
<body><p>Inside frame</p><button id="frame-button">Frame button</button><span id="frame-clicked"></span>
<script>
  document.getElementById("frame-button").addEventListener("click", () => {
    document.getElementById("frame-clicked").textContent = "frame clicked";
  });
</script>
</body></html>`;

const SECOND_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><title>Fixture second</title></head>
<body><p id="second-text">Second page</p></body></html>`;

export type Fixture = {
  url: string;
  close: () => Promise<void>;
};

export async function startFixture(): Promise<Fixture> {
  const server: Server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const routes: Record<string, [number, string, string]> = {
      "/": [200, "text/html; charset=utf-8", INDEX_HTML],
      "/frame": [200, "text/html; charset=utf-8", FRAME_HTML],
      "/second": [200, "text/html; charset=utf-8", SECOND_HTML],
      "/missing": [404, "text/plain", "not found"],
    };
    const route = routes[path] ?? [404, "text/plain", "not found"];
    response.writeHead(route[0], { "content-type": route[1] });
    response.end(route[2]);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("fixture server did not bind a port");
  }
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

const CHROME_CANDIDATES = [
  process.env.ALIA_BROWSER_TOOLS_CHROME,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter((candidate): candidate is string => typeof candidate === "string" && candidate !== "");

/** Chrome is mandatory for the integration job; absence fails it loudly. */
export function chromeExecutablePath(): string {
  for (const candidate of CHROME_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    "Chrome is required for browser integration tests (set ALIA_BROWSER_TOOLS_CHROME to its executable)",
  );
}
