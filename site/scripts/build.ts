/*
 * Assembles dist/ out of the sources. No bundler: the page is one HTML file and two stylesheets,
 * and a copy step is the honest amount of machinery for that.
 *
 * Three things happen on the way:
 * - the Søbernetics mark is set into the HTML, so it takes its colour from the page;
 * - fristil.css is Fristil's flattened stylesheet followed by our generated theme;
 * - the photographs of the street come from assets/web and the favicons from assets/icons, and
 *   the screenshot and the recording from ../docs, where the README uses them, so the page and
 *   the README never show different pictures.
 */

import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

const root = dirname(import.meta.dir)
const dist = join(root, "dist")
const docs = join(root, "..", "docs")
const fristil = join(root, "node_modules", "@fristil", "designsystem", "dist", "fristil.css")

const read = (path: string) => readFile(path, "utf8")

const sobernetics = (await read(join(root, "sobernetics.svg"))).trim()

const html = (await read(join(root, "index.html"))).replace("<!-- sobernetics -->", sobernetics)

const css = [await read(fristil), await read(join(root, "styles", "theme.css"))].join("\n")

/*
 * Every `fs-` class the page writes has to come from the stylesheet it ships, and every
 * placeholder has to have been filled. Either mistake is silent in a browser, so it fails the
 * build instead.
 */
const used = new Set<string>()
for (const [, value] of html.matchAll(/class="([^"]*)"/g)) {
  for (const name of value.split(/\s+/)) if (name.startsWith("fs-")) used.add(name)
}
const missing = [...used].filter((name) => !css.includes(`.${name}`))
if (missing.length > 0)
  throw new Error(`index.html uses ${missing.join(", ")}, which fristil.css lacks`)
const leftover = html.match(/<!-- sobernetics -->/)
if (leftover) throw new Error(`index.html still has the placeholder ${leftover[0]}`)

await rm(dist, { recursive: true, force: true })
await mkdir(dist, { recursive: true })
await writeFile(join(dist, "index.html"), html)
await writeFile(join(dist, "fristil.css"), css)
await copyFile(join(root, "styles", "site.css"), join(dist, "site.css"))
await copyFile(join(docs, "demo.gif"), join(dist, "demo.gif"))
for (const folder of ["web", "icons"]) {
  for (const name of await readdir(join(root, "assets", folder))) {
    await copyFile(join(root, "assets", folder, name), join(dist, name))
  }
}
await copyFile(join(docs, "screenshot.png"), join(dist, "screenshot.png"))

console.log(`Wrote dist/ (index.html ${Math.round(html.length / 1024)} kB)`)
