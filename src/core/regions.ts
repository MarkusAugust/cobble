import { lex, type Token } from "./lexer"

export type RegionKind = "print" | "execute" | "comment" | "verbatim"

export interface Region {
  kind: RegionKind
  /** Offsets of the whole region including delimiters. */
  start: number
  end: number
  /** Offsets of the content between the delimiters. */
  innerStart: number
  innerEnd: number
}

const PEBBLE_DELIMITER = /\{[{%#]/

/** Cheap check used to skip plain HTML documents entirely. */
export function hasPebble(text: string): boolean {
  return PEBBLE_DELIMITER.test(text)
}

/** Finds every Pebble region in the text. Unclosed regions extend to the end of the text. */
export function findPebbleRegions(text: string, tokens: Token[] = lex(text).tokens): Region[] {
  const regions: Region[] = []
  let i = 0
  while (i < tokens.length) {
    const t = tokens[i]
    if (t.kind === "printOpen" || t.kind === "executeOpen" || t.kind === "commentOpen") {
      const closeKind =
        t.kind === "printOpen"
          ? "printClose"
          : t.kind === "executeOpen"
            ? "executeClose"
            : "commentClose"
      const kind: RegionKind =
        t.kind === "printOpen" ? "print" : t.kind === "executeOpen" ? "execute" : "comment"
      let j = i + 1
      while (j < tokens.length && tokens[j].kind !== closeKind && tokens[j].kind !== "eof") j++
      const close = tokens[j]
      const closed = close.kind === closeKind
      const region: Region = {
        kind,
        start: t.start,
        end: closed ? close.end : text.length,
        innerStart: t.end,
        innerEnd: closed ? close.start : text.length,
      }
      // verbatim: {% verbatim %} … {% endverbatim %} is one region
      if (
        kind === "execute" &&
        tokens[i + 1]?.kind === "name" &&
        tokens[i + 1].value === "verbatim" &&
        closed
      ) {
        let k = j + 1
        while (k < tokens.length && tokens[k].kind !== "eof") {
          if (
            tokens[k].kind === "executeOpen" &&
            tokens[k + 1]?.kind === "name" &&
            tokens[k + 1].value === "endverbatim"
          )
            break
          k++
        }
        let end = text.length
        let innerEnd = text.length
        if (tokens[k]?.kind === "executeOpen") {
          innerEnd = tokens[k].start
          let m = k
          while (m < tokens.length && tokens[m].kind !== "executeClose" && tokens[m].kind !== "eof")
            m++
          end = tokens[m].kind === "executeClose" ? tokens[m].end : text.length
          j = m
        } else {
          j = k
        }
        regions.push({ kind: "verbatim", start: t.start, end, innerStart: close.end, innerEnd })
        i = j + 1
        continue
      }
      regions.push(region)
      i = j + 1
      continue
    }
    i++
  }
  return regions
}

/** The region whose content contains the offset (delimiters excluded), or null. */
export function regionAt(regions: Region[], offset: number): Region | null {
  for (const r of regions) {
    if (offset >= r.innerStart && offset <= r.innerEnd) return r
    if (offset < r.start) break
  }
  return null
}

/** True when the offset is inside a print or execute region where Pebble completion applies. */
export function isInsideExpression(regions: Region[], offset: number): boolean {
  const r = regionAt(regions, offset)
  return r !== null && (r.kind === "print" || r.kind === "execute")
}

/**
 * Replaces every Pebble region with spaces (keeping line breaks) so an HTML language service
 * sees plain HTML with identical offsets.
 */
export function maskPebble(text: string, regions: Region[]): string {
  if (regions.length === 0) return text
  let out = ""
  let pos = 0
  for (const r of regions) {
    out += text.slice(pos, r.start)
    out += text.slice(r.start, r.end).replace(/[^\n\r]/g, " ")
    pos = r.end
  }
  return out + text.slice(pos)
}
