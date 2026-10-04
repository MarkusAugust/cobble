/*
 * Draws a field of cobblestones as inline SVG.
 *
 * The stones are laid in courses, the way a street is: each row a little offset from the one
 * below, each stone a rounded block whose corners are nudged so no two are the same. A seeded
 * generator keeps the field identical from build to build, so the page does not change under
 * anyone between two deploys of the same commit.
 *
 * The SVG carries no colours of its own. Stones are filled with `var(--stone-1)` to
 * `var(--stone-4)` and the joints show the background of whatever holds the SVG, so the theme
 * decides how the street looks in light and dark.
 */

export interface CobbleOptions {
  width: number
  height: number
  /** Height of one course of stones. */
  course: number
  seed: number
}

/** mulberry32: small, fast and good enough to scatter stones. */
function random(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const round = (n: number) => Math.round(n * 10) / 10

/** A rounded block between (x0, y0) and (x1, y1) whose corners are each nudged a little. */
function stone(x0: number, y0: number, x1: number, y1: number, rnd: () => number): string {
  const w = x1 - x0
  const h = y1 - y0
  const r = Math.min(w, h) * (0.32 + rnd() * 0.18)
  const jitter = () => (rnd() - 0.5) * Math.min(w, h) * 0.16
  // Corners clockwise from the top left, each pulled a little off the grid.
  const corners: [number, number][] = [
    [x0 + jitter(), y0 + jitter()],
    [x1 + jitter(), y0 + jitter()],
    [x1 + jitter(), y1 + jitter()],
    [x0 + jitter(), y1 + jitter()],
  ]
  const toward = (from: [number, number], to: [number, number]): [number, number] => {
    const dx = to[0] - from[0]
    const dy = to[1] - from[1]
    const len = Math.hypot(dx, dy)
    return [from[0] + (dx / len) * r, from[1] + (dy / len) * r]
  }
  let d = ""
  for (let i = 0; i < 4; i++) {
    const corner = corners[i]
    const before = toward(corner, corners[(i + 3) % 4])
    const after = toward(corner, corners[(i + 1) % 4])
    d += `${i === 0 ? "M" : "L"}${round(before[0])} ${round(before[1])}`
    d += `Q${round(corner[0])} ${round(corner[1])} ${round(after[0])} ${round(after[1])}`
  }
  return `${d}Z`
}

export function cobbles({ width, height, course, seed }: CobbleOptions): string {
  const rnd = random(seed)
  const gap = Math.max(2, course * 0.09)
  const paths: string[][] = [[], [], [], []]
  // Granite mostly, sandstone now and then.
  const tones = [0.36, 0.72, 0.84, 1]
  for (let top = 0; top < height; ) {
    // Courses are not all equally deep, and each starts somewhere left of the edge so the
    // joints do not line up.
    // A strip one course deep stays exactly one course deep.
    const depth = height <= course ? height : course * (0.85 + rnd() * 0.3)
    let x = -rnd() * course * 1.2
    while (x < width) {
      const w = depth * (0.8 + rnd() * 0.75)
      const pick = rnd()
      const tone = tones.findIndex((t) => pick < t)
      paths[tone].push(
        stone(x + gap / 2, top + gap / 2, x + w - gap / 2, top + depth - gap / 2, rnd),
      )
      x += w
    }
    top += depth
  }
  const groups = paths
    .map((ds, i) => `<path fill="var(--stone-${i + 1})" d="${ds.join("")}"/>`)
    .join("")
  return (
    `<svg class="cobbles" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ` +
    `preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">${groups}</svg>`
  )
}
