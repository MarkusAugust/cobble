import { rmSync } from "node:fs"
import * as esbuild from "esbuild"

const production = process.argv.includes("--production")
const watch = process.argv.includes("--watch")

const shared: esbuild.BuildOptions = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["vscode"],
  mainFields: ["module", "main"],
  sourcemap: !production,
  minify: production,
  logLevel: "info",
}

const targets: esbuild.BuildOptions[] = [
  { ...shared, entryPoints: ["src/client/extension.ts"], outfile: "dist/client.js" },
  { ...shared, entryPoints: ["src/server/server.ts"], outfile: "dist/server.js" },
]

async function main() {
  rmSync("dist", { recursive: true, force: true })
  if (watch) {
    const contexts = await Promise.all(targets.map((t) => esbuild.context(t)))
    await Promise.all(contexts.map((c) => c.watch()))
    console.log("watching for changes…")
    return
  }
  await Promise.all(targets.map((t) => esbuild.build(t)))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
