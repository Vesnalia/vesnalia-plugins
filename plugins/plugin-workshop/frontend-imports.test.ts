// The frontend bundle must not reach the server SDK: VesnALIA 0.46.1 refuses to resolve `@vesnalia/plugin-sdk` in a frontend build
// (only `@vesnalia/plugin-sdk/app` is there). Walks the runtime imports from `app.tsx`; `import type` is erased and does not count.
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const root = dirname(fileURLToPath(import.meta.url));
const STATEMENT = /^\s*(?:import|export)\s+(type\s+)?([^;"']*?)\s*from\s*["']([^"']+)["']|^\s*import\s*["']([^"']+)["']/gm;

/** Specifiers this file imports at run time: not `import type`, not a brace list of `type X` only. */
export function runtimeImports(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(STATEMENT)) {
    if (m[4]) {
      out.push(m[4]);
      continue;
    }
    if (m[1]) continue;
    const list = /^\{([\s\S]*)\}$/.exec((m[2] ?? "").trim());
    if (list && list[1]!.split(",").map((s) => s.trim()).filter(Boolean).every((s) => s.startsWith("type "))) continue;
    out.push(m[3]!);
  }
  return out;
}

function resolveLocal(from: string, spec: string): string {
  const base = resolve(dirname(from), spec);
  for (const p of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) if (existsSync(p) && !p.endsWith("/")) return p;
  throw new Error(`cannot resolve ${spec} from ${from}`);
}

test("the frontend reaches no server-only module at run time", () => {
  const seen = new Set<string>();
  const external = new Set<string>();
  const queue = [resolve(root, "app.tsx")];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of runtimeImports(readFileSync(file, "utf8"))) {
      if (spec.startsWith(".")) queue.push(resolveLocal(file, spec));
      else external.add(spec);
    }
  }
  expect([...external].filter((s) => s === "@vesnalia/plugin-sdk" || (s.startsWith("@vesnalia/plugin-sdk/") && s !== "@vesnalia/plugin-sdk/app"))).toEqual([]);
  expect([...seen].map((f) => f.slice(root.length + 1)).filter((f) => f === "contract.ts" || f === "server/models.ts")).toEqual([]);
});

test("runtimeImports: type-only imports do not count, mixed ones do", () => {
  expect(runtimeImports('import type { A } from "./a";\nimport { type B, type C } from "./b";\nimport { D, type E } from "./d";\nimport "./side";\nexport { F } from "./f";')).toEqual([
    "./d",
    "./side",
    "./f",
  ]);
});
