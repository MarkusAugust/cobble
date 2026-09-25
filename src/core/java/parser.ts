/**
 * A deliberately small Java "parser": enough structure (types, members, annotations, method
 * bodies, string literals) to find Spring controllers, model attributes, getters and Pebble
 * extensions. It never throws on odd input; unknown constructs are skipped.
 */

export interface JavaType {
  /** Source text, e.g. `List<Item>`. */
  raw: string
  /** Simple name without package or generics, e.g. `List`. `Array` for `X[]`. */
  name: string
  args: JavaType[]
}

export interface JavaAnnotation {
  name: string
  /** The `value` attribute or first string literal argument, when present. */
  value?: string
  raw: string
}

export interface JavaParam {
  name: string
  type: JavaType
  annotations: JavaAnnotation[]
}

export interface JavaMethod {
  name: string
  returnType: JavaType
  params: JavaParam[]
  annotations: JavaAnnotation[]
  modifiers: string[]
  /** Body text between the braces (empty for abstract methods). */
  body: string
  /** Offset of the body in the file (position right after `{`). */
  bodyOffset: number
  nameOffset: number
}

export interface JavaField {
  name: string
  type: JavaType
  annotations: JavaAnnotation[]
  modifiers: string[]
  nameOffset: number
  /** Initializer expression text, when present. */
  initializer?: string
}

export interface JavaClass {
  name: string
  /** `package.Outer.Inner` */
  fqn: string
  kind: "class" | "interface" | "record" | "enum"
  annotations: JavaAnnotation[]
  modifiers: string[]
  superclass?: JavaType
  interfaces: JavaType[]
  fields: JavaField[]
  methods: JavaMethod[]
  recordComponents: JavaParam[]
  nameOffset: number
  filePath: string
}

export interface JavaFile {
  filePath: string
  package: string
  imports: string[]
  classes: JavaClass[]
  /** Kotlin top-level functions (for example Ktor routing). */
  topLevelFunctions?: JavaMethod[]
}

/** Replaces comments with spaces and string/char literal contents with underscores, keeping offsets. */
export function maskJava(text: string): string {
  const out = text.split("")
  let i = 0
  const n = text.length
  while (i < n) {
    const ch = text[i]
    const next = text[i + 1]
    if (ch === "/" && next === "/") {
      while (i < n && text[i] !== "\n") out[i++] = " "
      continue
    }
    if (ch === "/" && next === "*") {
      out[i++] = " "
      out[i++] = " "
      while (i < n && !(text[i] === "*" && text[i + 1] === "/"))
        out[i++] = text[i] === "\n" ? "\n" : " "
      if (i < n) {
        out[i++] = " "
        out[i++] = " "
      }
      continue
    }
    if (ch === '"' || ch === "'") {
      const quote = ch
      // text blocks """ … """
      if (quote === '"' && text.startsWith('"""', i)) {
        i += 3
        while (i < n && !text.startsWith('"""', i)) out[i++] = text[i] === "\n" ? "\n" : "_"
        i += 3
        continue
      }
      i++
      while (i < n && text[i] !== quote) {
        if (text[i] === "\\") {
          out[i++] = "_"
          if (i < n) out[i++] = "_"
          continue
        }
        out[i] = text[i] === "\n" ? "\n" : "_"
        i++
      }
      i++
      continue
    }
    i++
  }
  return out.join("")
}

/** Index of the brace matching the `{` at `open`, or -1. Works on masked text. */
export function matchBrace(masked: string, open: number): number {
  let depth = 0
  for (let i = open; i < masked.length; i++) {
    if (masked[i] === "{") depth++
    else if (masked[i] === "}") {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/** Splits on commas that are not nested inside <>, (), [] or {}. */
export function splitTopLevel(text: string, separator = ","): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ""
  for (const ch of text) {
    if (ch === "<" || ch === "(" || ch === "[" || ch === "{") depth++
    else if (ch === ">" || ch === ")" || ch === "]" || ch === "}") depth--
    if (ch === separator && depth === 0) {
      parts.push(current)
      current = ""
    } else current += ch
  }
  if (current.trim()) parts.push(current)
  return parts.map((p) => p.trim()).filter((p) => p.length > 0)
}

export function parseType(raw: string): JavaType {
  let text = raw
    .trim()
    .replace(/\bfinal\s+/g, "")
    .replace(/@\w+(\([^)]*\))?\s*/g, "")
  let arrayDepth = 0
  while (text.endsWith("[]")) {
    text = text.slice(0, -2).trim()
    arrayDepth++
  }
  if (text.endsWith("...")) {
    text = text.slice(0, -3).trim()
    arrayDepth++
  }
  let name = text
  let args: JavaType[] = []
  const lt = text.indexOf("<")
  if (lt !== -1 && text.endsWith(">")) {
    name = text.slice(0, lt).trim()
    args = splitTopLevel(text.slice(lt + 1, -1)).map(parseType)
  }
  name = name.split(".").pop() ?? name
  let type: JavaType = { raw: text, name, args }
  for (let i = 0; i < arrayDepth; i++) type = { raw: `${type.raw}[]`, name: "Array", args: [type] }
  return type
}

const ANNOTATION = /@([A-Za-z_][\w.]*)(\s*\(([\s\S]*?)\))?/g

export function parseAnnotations(text: string, original = text): JavaAnnotation[] {
  const out: JavaAnnotation[] = []
  for (const m of text.matchAll(ANNOTATION)) {
    const name = (m[1].split(".").pop() ?? m[1]).trim()
    let value: string | undefined
    if (m[3] !== undefined) {
      const args = original.slice(m.index + m[0].indexOf("(") + 1, m.index + m[0].length - 1)
      const named = /\bvalue\s*=\s*"([^"]*)"/.exec(args)
      const first = /^\s*(?:\{\s*)?"([^"]*)"/.exec(args)
      value = named?.[1] ?? first?.[1]
    }
    out.push({ name, value, raw: original.slice(m.index, m.index + m[0].length) })
  }
  return out
}

const MODIFIERS = new Set([
  "public",
  "private",
  "protected",
  "static",
  "final",
  "abstract",
  "default",
  "synchronized",
  "native",
  "transient",
  "volatile",
  "strictfp",
  "sealed",
  "non-sealed",
])

function splitModifiers(pre: string): { annotations: string; modifiers: string[]; rest: string } {
  const withoutAnnotations = pre.replace(ANNOTATION, " ")
  const tokens = withoutAnnotations.trim().split(/\s+/).filter(Boolean)
  const modifiers: string[] = []
  let i = 0
  while (i < tokens.length && MODIFIERS.has(tokens[i])) modifiers.push(tokens[i++])
  return { annotations: pre, modifiers, rest: tokens.slice(i).join(" ") }
}

/** Like splitTopLevel, but also returns where each part starts in the input. */
export function splitTopLevelWithOffsets(
  text: string,
  separator = ",",
): { text: string; offset: number }[] {
  const parts: { text: string; offset: number }[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i <= text.length; i++) {
    const ch = text[i]
    if (ch === "<" || ch === "(" || ch === "[" || ch === "{") depth++
    else if (ch === ">" || ch === ")" || ch === "]" || ch === "}") depth--
    if ((ch === separator && depth === 0) || i === text.length) {
      const raw = text.slice(start, i)
      const leading = raw.length - raw.trimStart().length
      const trimmed = raw.trim()
      if (trimmed) parts.push({ text: trimmed, offset: start + leading })
      start = i + 1
    }
  }
  return parts
}

function parseParams(masked: string, original: string): JavaParam[] {
  return splitTopLevelWithOffsets(masked).map((part) => {
    const originalPart = original.slice(part.offset, part.offset + part.text.length)
    const annotations = parseAnnotations(part.text, originalPart)
    const withoutAnnotations = part.text
      .replace(ANNOTATION, " ")
      .replace(/\bfinal\s+/g, "")
      .trim()
    const m = /^([\s\S]+?)\s+([A-Za-z_$][\w$]*)$/.exec(withoutAnnotations)
    if (!m) return { name: withoutAnnotations, type: parseType("Object"), annotations }
    return { name: m[2], type: parseType(m[1]), annotations }
  })
}

const TYPE_DECL = /\b(class|interface|record|enum)\s+([A-Za-z_$][\w$]*)/g

/** Parses one Java source file. */
export function parseJava(text: string, filePath: string): JavaFile {
  const masked = maskJava(text)
  const pkg = /^\s*package\s+([\w.]+)\s*;/m.exec(masked)?.[1] ?? ""
  const imports = [...masked.matchAll(/^\s*import\s+(?:static\s+)?([\w.*]+)\s*;/gm)].map(
    (m) => m[1],
  )
  const file: JavaFile = { filePath, package: pkg, imports, classes: [] }
  parseTypeDeclarations(text, masked, 0, masked.length, pkg, file, filePath)
  return file
}

function parseTypeDeclarations(
  text: string,
  masked: string,
  from: number,
  to: number,
  prefix: string,
  file: JavaFile,
  filePath: string,
) {
  const region = masked.slice(from, to)
  TYPE_DECL.lastIndex = 0
  let m: RegExpExecArray | null
  const consumedUntil: number[] = []
  while ((m = TYPE_DECL.exec(region)) !== null) {
    const declStart = from + m.index
    if (consumedUntil.some((end) => declStart < end)) continue
    // `record` is contextual: skip `record` used as an identifier (e.g. `record.get()`).
    if (m[1] === "record" && /[\w.]$/.test(masked.slice(Math.max(0, declStart - 1), declStart)))
      continue
    const kind = m[1] as JavaClass["kind"]
    const name = m[2]
    const nameOffset = declStart + m[0].indexOf(name)
    const open = masked.indexOf("{", declStart)
    if (open === -1) break
    const close = matchBrace(masked, open)
    if (close === -1) break
    consumedUntil.push(close + 1)
    const header = masked.slice(nameOffset + name.length, open)
    const headerOriginal = text.slice(nameOffset + name.length, open)
    // annotations + modifiers precede the keyword, after the previous `;`, `{` or `}`
    const preStart =
      Math.max(
        masked.lastIndexOf(";", declStart),
        masked.lastIndexOf("{", declStart),
        masked.lastIndexOf("}", declStart),
      ) + 1
    const pre = masked.slice(preStart, declStart)
    const { modifiers } = splitModifiers(pre)
    const annotations = parseAnnotations(pre, text.slice(preStart, declStart))
    let recordComponents: JavaParam[] = []
    let rest = header
    let restOriginal = headerOriginal
    if (kind === "record") {
      const paren = header.indexOf("(")
      const endParen = header.indexOf(")", paren)
      if (paren !== -1 && endParen !== -1) {
        recordComponents = parseParams(
          header.slice(paren + 1, endParen),
          headerOriginal.slice(paren + 1, endParen),
        )
        rest = header.slice(endParen + 1)
        restOriginal = headerOriginal.slice(endParen + 1)
      }
    }
    void restOriginal
    const ext = /\bextends\s+([\s\S]*?)(?=\bimplements\b|\bpermits\b|$)/.exec(rest)
    const impl = /\bimplements\s+([\s\S]*?)(?=\bextends\b|\bpermits\b|$)/.exec(rest)
    const superTypes = ext ? splitTopLevel(ext[1]).map(parseType) : []
    const cls: JavaClass = {
      name,
      fqn: prefix ? `${prefix}.${name}` : name,
      kind,
      annotations,
      modifiers,
      superclass: kind === "interface" ? undefined : superTypes[0],
      interfaces:
        kind === "interface" ? superTypes : impl ? splitTopLevel(impl[1]).map(parseType) : [],
      fields: [],
      methods: [],
      recordComponents,
      nameOffset,
      filePath,
    }
    file.classes.push(cls)
    parseMembers(text, masked, open + 1, close, cls, file, filePath)
  }
}

function parseMembers(
  text: string,
  masked: string,
  from: number,
  to: number,
  cls: JavaClass,
  file: JavaFile,
  filePath: string,
) {
  let i = from
  let segmentStart = from
  let parenDepth = 0
  while (i < to) {
    const ch = masked[i]
    if (ch === "(") parenDepth++
    else if (ch === ")") parenDepth--
    else if (ch === "{") {
      const close = matchBrace(masked, i)
      if (close === -1) break
      const head = masked.slice(segmentStart, i)
      if (parenDepth === 0 && !/\b(class|interface|record|enum)\s+[A-Za-z_$][\w$]*/.test(head)) {
        const method = parseMethodHead(text, masked, segmentStart, i, cls)
        if (method) {
          method.body = text.slice(i + 1, close)
          method.bodyOffset = i + 1
          cls.methods.push(method)
        }
      } else if (parenDepth === 0) {
        // nested type: parse it with the outer fqn as prefix
        parseTypeDeclarations(text, masked, segmentStart, close + 1, cls.fqn, file, filePath)
      }
      i = close + 1
      segmentStart = i
      parenDepth = 0
      continue
    } else if (ch === ";" && parenDepth === 0) {
      const head = masked.slice(segmentStart, i)
      if (/\(/.test(head) && /\)\s*(throws[\w., ]+)?$/.test(head.trim())) {
        const method = parseMethodHead(text, masked, segmentStart, i, cls)
        if (method) cls.methods.push(method)
      } else {
        const field = parseFieldHead(text, masked, segmentStart, i)
        if (field) cls.fields.push(field)
      }
      i++
      segmentStart = i
      continue
    }
    i++
  }
}

function parseMethodHead(
  text: string,
  masked: string,
  start: number,
  end: number,
  cls: JavaClass,
): JavaMethod | null {
  const head = masked
    .slice(start, end)
    .replace(/throws[\w.,\s<>]*$/, "")
    .trimEnd()
  if (!head.endsWith(")")) return null
  // the parameter list is the last balanced (...) group; annotations may contain parentheses too
  let depth = 0
  let paren = -1
  for (let k = head.length - 1; k >= 0; k--) {
    if (head[k] === ")") depth++
    else if (head[k] === "(") {
      depth--
      if (depth === 0) {
        paren = k
        break
      }
    }
  }
  if (paren === -1) return null
  const closeParen = head.length - 1
  const before = head.slice(0, paren)
  const nameMatch = /([A-Za-z_$][\w$]*)\s*$/.exec(before)
  if (!nameMatch) return null
  const name = nameMatch[1]
  const pre = before.slice(0, nameMatch.index)
  const { modifiers, rest } = splitModifiers(pre)
  const annotations = parseAnnotations(pre, text.slice(start, start + pre.length))
  // strip generic method type parameters like <T>
  const returnRaw = rest.replace(/^<[^>]*>\s*/, "").trim()
  if (/^(if|for|while|switch|catch|synchronized|return|new|else|try)$/.test(name)) return null
  const isConstructor = name === cls.name && returnRaw === ""
  if (!isConstructor && returnRaw === "") return null
  const paramsMasked = head.slice(paren + 1, closeParen)
  const paramsOriginal = text.slice(start + paren + 1, start + closeParen)
  return {
    name: isConstructor ? "<init>" : name,
    returnType: parseType(isConstructor ? "void" : returnRaw),
    params: parseParams(paramsMasked, paramsOriginal),
    annotations,
    modifiers,
    body: "",
    bodyOffset: -1,
    nameOffset: start + nameMatch.index,
  }
}

function parseFieldHead(
  text: string,
  masked: string,
  start: number,
  end: number,
): JavaField | null {
  const head = masked.slice(start, end)
  const eq = head.indexOf("=")
  const decl = eq === -1 ? head : head.slice(0, eq)
  const m = /([A-Za-z_$][\w$]*)\s*$/.exec(decl)
  if (!m) return null
  const pre = decl.slice(0, m.index)
  const { modifiers, rest } = splitModifiers(pre)
  if (!rest.trim()) return null
  if (/^(return|throw|break|continue)$/.test(rest.trim())) return null
  return {
    name: m[1],
    type: parseType(rest),
    annotations: parseAnnotations(pre, text.slice(start, start + pre.length)),
    modifiers,
    nameOffset: start + m.index,
    initializer: eq === -1 ? undefined : text.slice(start + eq + 1, end).trim(),
  }
}

/** String literals in a piece of source with their offsets (relative to the piece). */
export function stringLiterals(source: string): { value: string; start: number; end: number }[] {
  const out: { value: string; start: number; end: number }[] = []
  const re = /"((?:[^"\\\n]|\\.)*)"/g
  for (const m of source.matchAll(re))
    out.push({ value: m[1].replace(/\\"/g, '"'), start: m.index, end: m.index + m[0].length })
  return out
}
