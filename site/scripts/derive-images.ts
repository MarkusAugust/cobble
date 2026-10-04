/*
 * Derives what the page ships from the generated photographs in assets/.
 *
 * The originals are several megabytes each and are not in git (see .gitignore); only what this
 * script writes to assets/web is. Keep the originals somewhere safe to derive again.
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

const derive = async (original: string, name: string, width: number, quality: number) => {
  const resized = join(tmp, `${name}.jpg`)
  await run(["sips", "-Z", String(width), join(assets, original), "--out", resized])
  await run(["cwebp", "-q", String(quality), "-quiet", resized, "-o", join(web, `${name}.webp`)])
}

/*
 * The street at night behind the title. 2400 pixels covers a wide screen; 1200 is for phones,
 * where the picture is cropped to its middle anyway. The photograph is mostly shadow, which
 * compresses well, so the quality can stay high enough to keep the lamp's reflections clean.
 */
await derive("night-street.jpeg", "night-street-2400", 2400, 72)
await derive("night-street.jpeg", "night-street-1200", 1200, 72)

/*
 * Wet stones for the bands between sections. They are laid at about 56rem wide, so 1800 pixels
 * is sharp on a 2x screen.
 */
await derive("night-cobbles.jpeg", "night-cobbles-1800", 1800, 70)

for (const name of (await Array.fromAsync(new Bun.Glob("*.webp").scan(web))).sort()) {
  const size = (await Bun.file(join(web, name)).arrayBuffer()).byteLength
  console.log(`${name}  ${Math.round(size / 1024)} kB`)
}
