/*
 * Derives what the page ships from the generated photographs in assets/.
 *
 * This does NOT run on Netlify or in CI. It needs sips and cwebp, which is a macOS plus Homebrew
 * assumption, so the derived files are committed and this script is what you run when an
 * original changes:
 *
 *   bun scripts/derive-images.ts
 */

import { mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"

const root = dirname(import.meta.dir)
const assets = join(root, "assets")
const web = join(assets, "web")
const tmp = join(root, "node_modules", ".cache")

await mkdir(web, { recursive: true })
await mkdir(tmp, { recursive: true })

const run = async (cmd: string[]) => {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" })
  if ((await p.exited) !== 0)
    throw new Error(`${cmd[0]} failed: ${await new Response(p.stderr).text()}`)
}

/*
 * The street behind the plaque, in both themes. The two photographs share one layout, so the
 * stones stay put when the theme changes. 2400 pixels covers a wide screen at 1x and most at 2x
 * once the plaque hides the middle; 1200 is for phones.
 */
for (const theme of ["light", "dark"]) {
  for (const width of [2400, 1200]) {
    const resized = join(tmp, `street-${theme}-${width}.jpg`)
    await run(["sips", "-Z", String(width), join(assets, `street-${theme}.jpeg`), "--out", resized])
    await run([
      "cwebp",
      "-q",
      "70",
      "-quiet",
      resized,
      "-o",
      join(web, `street-${theme}-${width}.webp`),
    ])
  }
}

for (const name of (await Array.fromAsync(new Bun.Glob("*.webp").scan(web))).sort()) {
  const size = (await Bun.file(join(web, name)).arrayBuffer()).byteLength
  console.log(`${name}  ${Math.round(size / 1024)} kB`)
}
