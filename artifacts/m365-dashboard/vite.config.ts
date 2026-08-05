import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

/**
 * Ceiling for the eager entry payload, in bytes: the entry chunk plus every
 * chunk reachable from it through *static* imports. That is what a browser must
 * download and execute before the first tab renders; chunks reached only
 * through `import()` are excluded, because those are the lazy tab boundary.
 *
 * The budget is deliberately on the closure rather than on the single entry
 * file. Measuring the entry file alone is the metric the old `manualChunks`
 * configuration gamed: it held `index.js` at 298 kB while eagerly pulling a
 * 421 kB Recharts chunk alongside it, for 931 kB before any tab loaded.
 *
 * Achieved at the time of writing: 404,043 bytes in a single eager chunk. The
 * ceiling is that plus roughly 8%, so ordinary dependency drift does not trip
 * it but a regression of the Recharts kind (+400 kB) does.
 *
 * To change this deliberately: run `pnpm --filter m365-dashboard run build`,
 * take the "eager entry payload" figure it prints, and set the constant to that
 * plus a similar margin — in the same commit as the change that moved it, with
 * the reason in the commit message. Raising it to make a red build green,
 * without such a reason, defeats the point of the budget.
 */
const ENTRY_JS_BUDGET_BYTES = 438_000;

/**
 * Fails the build when the eager entry payload exceeds `ENTRY_JS_BUDGET_BYTES`.
 *
 * The closure is walked over Rollup's own chunk metadata (`chunk.imports`),
 * which is the authoritative static-import graph, rather than by re-parsing the
 * emitted JavaScript.
 */
function bundleBudget(): Plugin {
  return {
    name: "entry-bundle-budget",
    apply: "build",
    generateBundle(_options, bundle) {
      const chunks = new Map(
        Object.values(bundle)
          .filter((c): c is Extract<typeof c, { type: "chunk" }> => c.type === "chunk")
          .map((c) => [c.fileName, c]),
      );

      const entry = [...chunks.values()].find((c) => c.isEntry);
      if (!entry) return;

      const seen = new Set<string>();
      const stack = [entry.fileName];
      while (stack.length > 0) {
        const fileName = stack.pop()!;
        if (seen.has(fileName)) continue;
        const chunk = chunks.get(fileName);
        if (!chunk) continue;
        seen.add(fileName);
        // `imports` is static only; `dynamicImports` is the lazy boundary.
        stack.push(...chunk.imports);
      }

      let bytes = 0;
      for (const fileName of seen) {
        bytes += Buffer.byteLength(chunks.get(fileName)!.code, "utf8");
      }

      const kb = (n: number) => `${(n / 1000).toFixed(2)} kB`;
      this.info(
        `eager entry payload: ${bytes} bytes (${kb(bytes)}) across ${seen.size} chunk(s), ` +
          `budget ${ENTRY_JS_BUDGET_BYTES} bytes (${kb(ENTRY_JS_BUDGET_BYTES)})`,
      );

      if (bytes > ENTRY_JS_BUDGET_BYTES) {
        const over = bytes - ENTRY_JS_BUDGET_BYTES;
        this.error(
          `Bundle budget exceeded: the eager entry payload is ${kb(bytes)} across ` +
            `${seen.size} chunk(s), which is ${kb(over)} over the ${kb(ENTRY_JS_BUDGET_BYTES)} ` +
            `ceiling. Eager chunks: ${[...seen].sort().join(", ")}. Either reduce what the ` +
            `entry pulls in statically, move it behind an import(), or raise ` +
            `ENTRY_JS_BUDGET_BYTES in vite.config.ts deliberately.`,
        );
      }
    },
  };
}

const rawPort = process.env.PORT;
const port = rawPort ? Number(rawPort) : 5173;
const apiProxyTarget = process.env.API_PROXY_TARGET ?? "http://localhost:5100";

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH ?? "/";

// Restrict which Host headers the dev/preview servers respond to. With
// `allowedHosts: true` any website could use DNS rebinding to reach the
// proxied /api endpoints. Vite always allows localhost and IP addresses;
// Replit preview domains and any ALLOWED_HOSTS entries are added on top.
const allowedHosts = [
  ...(process.env.ALLOWED_HOSTS ?? "").split(","),
  ...(process.env.REPLIT_DOMAINS ?? "").split(","),
  process.env.REPLIT_DEV_DOMAIN ?? "",
]
  .map((host) => host.trim())
  .filter(Boolean);

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    bundleBudget(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    chunkSizeWarningLimit: 650,
    // No `manualChunks`. Forcing Recharts, TanStack and Radix into fixed vendor
    // chunks defeated the lazy tab split. Because those chunks were shared by
    // the shell and by several tabs, Rollup had to make the entry chunk import
    // them statically, so the eager payload was index + charts + tables + radix
    // = 931 kB: every visitor downloaded and executed the whole of Recharts
    // before any tab rendered, including a visitor going straight to Settings,
    // which renders no chart. Rollup's default chunking instead places each
    // dependency in the lazy chunks that actually reference it, which drops the
    // eager payload to 404 kB and takes Recharts out of it entirely. Measured
    // total emitted JS is unchanged, so the split costs no duplication. See
    // docs/agent-runs/T06.md for the full before/after numbers.
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    proxy: {
      "/api": {
        target: apiProxyTarget,
        changeOrigin: true,
      },
    },
    allowedHosts,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts,
  },
});
