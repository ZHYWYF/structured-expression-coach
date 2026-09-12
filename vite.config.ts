import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const runtimeRoot = dirname(require.resolve("@huggingface/transformers"));
const runtimeFiles = ["ort-wasm-simd-threaded.jsep.mjs", "ort-wasm-simd-threaded.jsep.wasm"];

export default defineConfig({
  plugins: [react(), {
    name: "bundle-offline-onnx-runtime",
    generateBundle() {
      for (const name of runtimeFiles) this.emitFile({ type: "asset", fileName: `runtime/${name}`, source: readFileSync(resolve(runtimeRoot, name)) });
    },
    configureServer(server) {
      server.middlewares.use("/runtime", (request, response, next) => {
        const name = request.url?.replace(/^\//, "").split("?")[0] ?? "";
        if (!runtimeFiles.includes(name)) return next();
        response.setHeader("Content-Type", name.endsWith(".wasm") ? "application/wasm" : "text/javascript");
        response.end(readFileSync(resolve(runtimeRoot, name)));
      });
    },
  }],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_"],
});
