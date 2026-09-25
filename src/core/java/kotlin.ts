import {
  type JavaAnnotation,
  type JavaClass,
  type JavaFile,
  type JavaMethod,
  type JavaParam,
  maskJava,
  matchBrace,
  parseAnnotations,
  parseType,
  splitTopLevelWithOffsets,
} from "./parser"

/**
 * Kotlin support built on the same structures as the Java parser: classes (including data
 * classes and objects) with properties and functions, plus top-level functions (Ktor routes).
 */

const KOTLIN_MODIFIERS = new Set([
  "public",
  "private",
  "protected",
  "internal",
  "override",
  "open",
  "abstract",
  "final",
  "suspend",
  "lateinit",
  "const",
  "inline",
  "infix",
  "operator",
  "data",
  "sealed",
  "enum",
  "annotation",
  "inner",
  "companion",
  "value",
  "external",
  "tailrec",
  "vararg",
  "crossinline",
  "noinline",
  "actual",
  "expect",
])

/** Kotlin nullable/generic types map onto the Java shape; `?` is dropped. */
export function parseKotlinType(raw: string): ReturnType<typeof parseType> {
  let text = raw.trim().replace(/\?/g, "")
  if (/^Array<(.+)>$/.test(text)) text = text.replace(/^Array<(.+)>$/, "$1[]")
  return parseType(text)
}

function kotlinAnnotations(pre: string, original: string): JavaAnnotation[] {
  return parseAnnotations(pre, original)
}

function splitKotlinModifiers(pre: string): { modifiers: string[]; rest: string } {
  const tokens = pre
    .replace(/@[\w.]+(\([^)]*\))?/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  const modifiers = tokens.filter((t) => KOTLIN_MODIFIERS.has(t))
  return { modifiers, rest: tokens.filter((t) => !KOTLIN_MODIFIERS.has(t)).join(" ") }
}

function parseKotlinParams(masked: string, original: string): JavaParam[] {
  return splitTopLevelWithOffsets(masked).map((part) => {
    const originalPart = original.slice(part.offset, part.offset + part.text.length)
    const annotations = kotlinAnnotations(part.text, originalPart)
    const cleaned = part.text
      .replace(/@[\w.]+(\([^)]*\))?/g, " ")
      .replace(
        /\b(val|var|vararg|crossinline|noinline|private|protected|internal|public|override|open)\b/g,
        " ",
      )
      .trim()
    const m = /^([A-Za-z_$][\w$]*)\s*:\s*([^=]+?)(?:\s*=[\s\S]*)?$/.exec(cleaned)
    if (!m) return { name: cleaned, type: parseType("Object"), annotations }
    return { name: m[1], type: parseKotlinType(m[2]), annotations }
  })
}

const KT_TYPE_DECL = /\b(class|interface|object)\s+([A-Za-z_$][\w$]*)/g
const KT_FUN =
  /\bfun\s+(?:<[^>]*>\s*)?(?:([A-Za-z_$][\w$.<>?]*)\.)?([A-Za-z_$][\w$]*|`[^`]+`)\s*\(/g

/** Parses one Kotlin source file into the Java structures. */
export function parseKotlin(text: string, filePath: string): JavaFile {
  const masked = maskJava(text)
  const pkg = /^\s*package\s+([\w.]+)/m.exec(masked)?.[1] ?? ""
  const imports = [...masked.matchAll(/^\s*import\s+([\w.*]+)/gm)].map((m) => m[1])
  const file: JavaFile = { filePath, package: pkg, imports, classes: [], topLevelFunctions: [] }
  parseKotlinTypes(text, masked, 0, masked.length, pkg, file, filePath)
  // top-level functions: any `fun` outside class bodies
  const classRanges = collectClassBodyRanges(masked)
  for (const fn of parseKotlinFunctions(text, masked, 0, masked.length, (offset) =>
    classRanges.some(([a, b]) => offset > a && offset < b),
  )) {
    file.topLevelFunctions?.push(fn)
  }
  return file
}

function collectClassBodyRanges(masked: string): [number, number][] {
  const out: [number, number][] = []
  KT_TYPE_DECL.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = KT_TYPE_DECL.exec(masked)) !== null) {
    const open = findBodyOpen(masked, m.index + m[0].length)
    if (open === -1) continue
    const close = matchBrace(masked, open)
    if (close !== -1) out.push([open, close])
  }
  return out
}

/** Index of the `{` that opens a class body after the header (skipping the primary constructor and supertype list). */
function findBodyOpen(masked: string, from: number): number {
  let depth = 0
  for (let i = from; i < masked.length; i++) {
    const ch = masked[i]
    if (ch === "(") depth++
    else if (ch === ")") depth--
    else if (depth === 0 && ch === "{") return i
    else if (depth === 0 && ch === ";") return -1
    else if (depth === 0 && ch === "\n") {
      const next = masked.slice(i + 1).trimStart()
      if (!(next.startsWith("{") || next.startsWith(":") || next.startsWith(","))) return -1
    }
  }
  return -1
}

function parseKotlinTypes(
  text: string,
  masked: string,
  from: number,
  to: number,
  prefix: string,
  file: JavaFile,
  filePath: string,
) {
  const region = masked.slice(from, to)
  const re = new RegExp(KT_TYPE_DECL.source, "g")
  let m: RegExpExecArray | null
  const consumed: number[] = []
  while ((m = re.exec(region)) !== null) {
    const declStart = from + m.index
    if (consumed.some((end) => declStart < end)) continue
    if (/[\w.]$/.test(masked.slice(Math.max(0, declStart - 1), declStart))) continue
    const keyword = m[1]
    const name = m[2]
    const nameOffset = declStart + m[0].indexOf(name)
    const headerStart = nameOffset + name.length
    const open = findBodyOpen(masked, headerStart)
    const close = open === -1 ? -1 : matchBrace(masked, open)
    const headerEnd = open === -1 ? findHeaderEnd(masked, headerStart) : open
    if (close !== -1) consumed.push(close + 1)
    const preStart =
      Math.max(
        masked.lastIndexOf(";", declStart),
        masked.lastIndexOf("{", declStart),
        masked.lastIndexOf("}", declStart),
        masked.lastIndexOf("\n\n", declStart),
      ) + 1
    const pre = masked.slice(preStart, declStart)
    const { modifiers } = splitKotlinModifiers(pre)
    const annotations = kotlinAnnotations(pre, text.slice(preStart, declStart))
    const header = masked.slice(headerStart, headerEnd)
    const headerOriginal = text.slice(headerStart, headerEnd)
    // primary constructor
    let recordComponents: JavaParam[] = []
    const fields: JavaClass["fields"] = []
    let rest = header
    const paren = header.indexOf("(")
    if (
      paren !== -1 &&
      (header.slice(0, paren).trim() === "" ||
        /^\s*(private|internal|public|protected)?\s*constructor\s*$/.test(header.slice(0, paren)))
    ) {
      let depth = 0
      let endParen = -1
      for (let k = paren; k < header.length; k++) {
        if (header[k] === "(") depth++
        else if (header[k] === ")") {
          depth--
          if (depth === 0) {
            endParen = k
            break
          }
        }
      }
      if (endParen !== -1) {
        const params = splitTopLevelWithOffsets(header.slice(paren + 1, endParen))
        for (const p of params) {
          const isProperty = /\b(val|var)\b/.test(p.text)
          const parsed = parseKotlinParams(
            p.text,
            headerOriginal.slice(paren + 1 + p.offset, paren + 1 + p.offset + p.text.length),
          )[0]
          if (!parsed) continue
          if (isProperty) {
            const isPrivate = /\bprivate\b/.test(p.text)
            fields.push({
              name: parsed.name,
              type: parsed.type,
              annotations: parsed.annotations,
              modifiers: isPrivate ? ["private"] : ["public"],
              nameOffset: headerStart + paren + 1 + p.offset + p.text.indexOf(parsed.name),
            })
          }
          if (modifiers.includes("data"))
            recordComponents = [...recordComponents, ...(isProperty ? [parsed] : [])]
        }
        rest = header.slice(endParen + 1)
      }
    }
    const supers = rest.includes(":") ? rest.slice(rest.indexOf(":") + 1) : ""
    const superTypes = supers
      ? splitTopLevelWithOffsets(supers.replace(/\bby\s+[\w.]+/g, "")).map((p) =>
          parseKotlinType(p.text.replace(/\([^)]*\)\s*$/, "")),
        )
      : []
    const cls: JavaClass = {
      name,
      fqn: prefix ? `${prefix}.${name}` : name,
      kind: keyword === "interface" ? "interface" : modifiers.includes("enum") ? "enum" : "class",
      annotations,
      modifiers: [...modifiers, "kotlin"],
      superclass: superTypes.find((t) => this_isClassLike(t.name)) ?? superTypes[0],
      interfaces: superTypes.slice(1),
      fields,
      methods: [],
      recordComponents: [],
      nameOffset,
      filePath,
    }
    file.classes.push(cls)
    if (open !== -1 && close !== -1) {
      parseKotlinMembers(text, masked, open + 1, close, cls, file, filePath)
    }
  }
}

function this_isClassLike(_name: string): boolean {
  return false
}

function findHeaderEnd(masked: string, from: number): number {
  const nl = masked.indexOf("\n", from)
  return nl === -1 ? masked.length : nl
}

function parseKotlinMembers(
  text: string,
  masked: string,
  from: number,
  to: number,
  cls: JavaClass,
  file: JavaFile,
  filePath: string,
) {
  // nested classes
  parseKotlinTypes(text, masked, from, to, cls.fqn, file, filePath)
  const nested = collectClassBodyRanges(masked.slice(from, to)).map(
    ([a, b]) => [a + from, b + from] as [number, number],
  )
  const insideNested = (offset: number) => nested.some(([a, b]) => offset > a && offset < b)
  // properties at depth 1: val/var name: Type
  const region = masked.slice(from, to)
  const propRe =
    /(?:^|[\n;{}])([ \t]*(?:(?:public|private|protected|internal|override|open|lateinit|const|abstract|final)\s+)*)(val|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*([^=\n{]+?))?\s*(?:=|\n|$|\{|get\(\))/g
  let m: RegExpExecArray | null
  while ((m = propRe.exec(region)) !== null) {
    const offset = from + m.index + m[0].indexOf(m[2])
    if (insideNested(offset) || depthAt(region, m.index) !== 0) continue
    const pre = m[1]
    const isPrivate = /\b(private|protected)\b/.test(pre)
    const typeText = m[4]?.trim()
    const init = m[0].includes("=")
      ? text.slice(
          from + m.index + m[0].indexOf("="),
          text.indexOf("\n", from + m.index + m[0].length),
        )
      : undefined
    cls.fields.push({
      name: m[3],
      type: typeText ? parseKotlinType(typeText) : inferKotlinLiteralType(init ?? ""),
      annotations: [],
      modifiers: isPrivate ? ["private"] : ["public"],
      nameOffset: from + m.index + m[0].indexOf(m[3]),
      initializer: init?.replace(/^=\s*/, "").trim(),
    })
  }
  for (const fn of parseKotlinFunctions(text, masked, from, to, insideNested)) cls.methods.push(fn)
}

function depthAt(region: string, index: number): number {
  let depth = 0
  for (let i = 0; i < index; i++) {
    if (region[i] === "{") depth++
    else if (region[i] === "}") depth--
  }
  return depth
}

function inferKotlinLiteralType(init: string): ReturnType<typeof parseType> {
  const e = init.replace(/^=\s*/, "").trim()
  if (/^"/.test(e)) return parseType("String")
  if (/^(true|false)$/.test(e)) return parseType("Boolean")
  if (/^-?\d+L$/.test(e)) return parseType("Long")
  if (/^-?\d+$/.test(e)) return parseType("Int")
  if (/^-?\d*\.\d+/.test(e)) return parseType("Double")
  const ctor = /^([A-Z][\w.]*)\s*\(/.exec(e)
  if (ctor) return parseType(ctor[1])
  if (/^(listOf|mutableListOf|arrayListOf)\s*\(/.test(e)) return parseType("List<Object>")
  if (/^(mapOf|mutableMapOf|hashMapOf)\s*\(/.test(e)) return parseType("Map<Object, Object>")
  return parseType("Object")
}

function parseKotlinFunctions(
  text: string,
  masked: string,
  from: number,
  to: number,
  skip: (offset: number) => boolean,
): JavaMethod[] {
  const out: JavaMethod[] = []
  const region = masked.slice(from, to)
  const re = new RegExp(KT_FUN.source, "g")
  let m: RegExpExecArray | null
  while ((m = re.exec(region)) !== null) {
    const funStart = from + m.index
    if (skip(funStart)) continue
    const outer = depthAt(region, m.index)
    if (from !== 0 && outer !== 0) continue
    if (from === 0 && outer !== 0) continue
    const paren = funStart + m[0].length - 1
    let depth = 0
    let closeParen = -1
    for (let k = paren; k < to; k++) {
      if (masked[k] === "(") depth++
      else if (masked[k] === ")") {
        depth--
        if (depth === 0) {
          closeParen = k
          break
        }
      }
    }
    if (closeParen === -1) continue
    const name = m[2].replace(/`/g, "")
    const receiver = m[1]
    const nameOffset = funStart + m[0].lastIndexOf(m[2])
    const preStart =
      Math.max(
        masked.lastIndexOf(";", funStart),
        masked.lastIndexOf("{", funStart),
        masked.lastIndexOf("}", funStart),
        masked.lastIndexOf("\n\n", funStart),
      ) + 1
    const pre = masked.slice(preStart, funStart)
    const { modifiers } = splitKotlinModifiers(pre)
    const annotations = kotlinAnnotations(pre, text.slice(preStart, funStart))
    // return type and body
    let cursor = closeParen + 1
    let returnRaw = "Unit"
    const afterParen = masked.slice(cursor, Math.min(to, cursor + 200))
    const typeMatch = /^\s*:\s*([^={\n]+)/.exec(afterParen)
    if (typeMatch) {
      returnRaw = typeMatch[1].trim()
      cursor += typeMatch[0].length
    }
    let body = ""
    let bodyOffset = -1
    const rest = masked.slice(cursor, Math.min(to, cursor + 50))
    const braceMatch = /^\s*\{/.exec(rest)
    const exprMatch = /^\s*=/.exec(rest)
    if (braceMatch) {
      const open = cursor + braceMatch[0].length - 1
      const close = matchBrace(masked, open)
      if (close !== -1) {
        body = text.slice(open + 1, close)
        bodyOffset = open + 1
      }
    } else if (exprMatch) {
      const start = cursor + exprMatch[0].length
      const end = expressionEnd(masked, start, to)
      body = `return ${text.slice(start, end)}`
      bodyOffset = start
      if (returnRaw === "Unit") returnRaw = "Object"
    }
    out.push({
      name,
      returnType: parseKotlinType(returnRaw === "Unit" ? "void" : returnRaw),
      params: parseKotlinParams(
        masked.slice(paren + 1, closeParen),
        text.slice(paren + 1, closeParen),
      ),
      annotations: receiver
        ? [...annotations, { name: "Receiver", value: receiver, raw: receiver }]
        : annotations,
      modifiers,
      body,
      bodyOffset,
      nameOffset,
    })
  }
  return out
}

/** End of a single-expression function body: the first newline at depth 0 that is not inside brackets. */
function expressionEnd(masked: string, start: number, to: number): number {
  let depth = 0
  for (let i = start; i < to; i++) {
    const ch = masked[i]
    if (ch === "(" || ch === "{" || ch === "[") depth++
    else if (ch === ")" || ch === "}" || ch === "]") {
      if (depth === 0) return i
      depth--
    } else if (ch === "\n" && depth === 0) {
      const next = masked.slice(i + 1, i + 20)
      if (!/^\s*[.?:]/.test(next)) return i
    }
  }
  return to
}
