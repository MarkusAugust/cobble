/*
 * Assembles dist/ out of the sources. No bundler: the page is one HTML file and two stylesheets,
 * and a copy step is the honest amount of machinery for that.
 *
 * Three things happen on the way:
 * - the Søbernetics mark is set into the HTML, so it takes its colour from the page;
 * - fristil.css is Fristil's flattened stylesheet followed by our generated theme;
 * - the photographs of the street come from assets/web, and the screenshot and the recording
 *   from ../docs, where the README uses them, so the page and the README never show different
 *   pictures.
 */

import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

const root = dirname(import.meta.dir)
const dist = join(root, "dist")
const docs = join(root, "..", "docs")
const fristil = join(root, "node_modules", "@fristil", "designsystem", "dist", "fristil.css")

const read = (path: string) => readFile(path, "utf8")

const sobernetics = (await read(join(root, "sobernetics.svg"))).trim()

const favicon =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">` +
  `<path fill="#7D8288" d="M9 4Q4 4 3.5 9L3 23Q3 28 8 28.5L24 28Q29 28 29 23L28.5 9Q28 4 23 3.5Z"/>` +
  `</svg>\n`

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
await writeFile(join(dist, "favicon.svg"), favicon)
await copyFile(join(docs, "demo.gif"), join(dist, "demo.gif"))
for (const name of await readdir(join(root, "assets", "web"))) {
  await copyFile(join(root, "assets", "web", name), join(dist, name))
}
await copyFile(join(docs, "screenshot.png"), join(dist, "screenshot.png"))

console.log(`Wrote dist/ (index.html ${Math.round(html.length / 1024)} kB)`)
