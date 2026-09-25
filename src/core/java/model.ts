import {
  type JavaClass,
  type JavaFile,
  type JavaMethod,
  type JavaType,
  maskJava,
  parseType,
  splitTopLevel,
  stringLiterals,
} from "./parser"

export interface JavaProperty {
  name: string
  type: JavaType
  kind: "getter" | "field" | "record" | "method"
  className: string
  filePath: string
  offset: number
}

export interface TemplateAttribute {
  name: string
  type: JavaType
  /** Where it is added, for hover and go-to-definition. */
  className: string
  methodName: string
  filePath: string
  offset: number
  /** True for `@ControllerAdvice` attributes available to every template. */
  global: boolean
}

export interface JavaExtensionEntry {
  kind: "filter" | "function" | "test"
  name: string
  params: string[]
  className: string
  filePath: string
  offset: number
}

const MAPPING_ANNOTATIONS = new Set([
  "GetMapping",
  "PostMapping",
  "PutMapping",
  "DeleteMapping",
  "PatchMapping",
  "RequestMapping",
])
const COLLECTIONS = new Set([
  "List",
  "Set",
  "Collection",
  "Iterable",
  "ArrayList",
  "LinkedList",
  "HashSet",
  "TreeSet",
  "LinkedHashSet",
  "Stream",
  "Array",
  "Optional",
  "SortedSet",
])
const NO_PROPERTIES = new Set([
  "String",
  "Integer",
  "Long",
  "Double",
  "Float",
  "Short",
  "Byte",
  "Boolean",
  "Character",
  "int",
  "long",
  "double",
  "float",
  "short",
  "byte",
  "boolean",
  "char",
  "void",
  "Object",
  "BigDecimal",
  "BigInteger",
  "UUID",
])

const lowerFirst = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s)

/**
 * Everything the language server wants to know from Java sources: Spring controllers and the
 * templates they render with which model attributes, bean properties, and Pebble extensions.
 */
export class JavaModel {
  readonly classes = new Map<string, JavaClass[]>()
  readonly byFqn = new Map<string, JavaClass>()
  private readonly viewAttributes = new Map<string, TemplateAttribute[]>()
  private readonly globalAttributes: TemplateAttribute[] = []
  readonly extensions: JavaExtensionEntry[] = []

  constructor(files: JavaFile[]) {
    for (const f of files) {
      for (const c of f.classes) {
        const list = this.classes.get(c.name) ?? []
        list.push(c)
        this.classes.set(c.name, list)
        this.byFqn.set(c.fqn, c)
      }
    }
    for (const f of files) {
      for (const c of f.classes) this.collectController(c)
      if (f.topLevelFunctions?.length) {
        const synthetic: JavaClass = {
          name: fileStem(f.filePath),
          fqn: `${f.package}.${fileStem(f.filePath)}`,
          kind: "class",
          annotations: [],
          modifiers: ["kotlin"],
          interfaces: [],
          fields: [],
          methods: f.topLevelFunctions,
          recordComponents: [],
          nameOffset: 0,
          filePath: f.filePath,
        }
        this.collectController(synthetic)
      }
    }
    for (const f of files) for (const c of f.classes) this.collectExtensions(c)
  }

  classNamed(name: string): JavaClass | undefined {
    return this.byFqn.get(name) ?? this.classes.get(name.split(".").pop() ?? name)?.[0]
  }

  /** View names (as written in the controller) that have model attributes. */
  viewNames(): string[] {
    return [...this.viewAttributes.keys()]
  }

  /** Attributes available in a template rendered under `viewName`, plus global ones. */
  attributesForView(viewName: string): TemplateAttribute[] {
    const specific = this.viewAttributes.get(viewName) ?? []
    const seen = new Set(specific.map((a) => a.name))
    return [...specific, ...this.globalAttributes.filter((g) => !seen.has(g.name))]
  }

  allGlobalAttributes(): TemplateAttribute[] {
    return this.globalAttributes
  }

  /** Element type of a collection/array/optional, or undefined. */
  elementType(type: JavaType | undefined): JavaType | undefined {
    if (!type) return undefined
    if (COLLECTIONS.has(type.name)) return type.args[0]
    if (type.name === "Map") return undefined
    return undefined
  }

  /** Readable properties of a type: getters, record components and public fields, including inherited ones. */
  propertiesOf(type: JavaType | string | undefined, depth = 0): JavaProperty[] {
    if (!type) return []
    const name = typeof type === "string" ? parseType(type).name : type.name
    if (NO_PROPERTIES.has(name) || depth > 6) return []
    const cls = this.classNamed(name)
    if (!cls) return []
    const out = new Map<string, JavaProperty>()
    const add = (p: JavaProperty) => {
      if (!out.has(p.name)) out.set(p.name, p)
    }
    for (const c of cls.recordComponents)
      add({
        name: c.name,
        type: c.type,
        kind: "record",
        className: cls.name,
        filePath: cls.filePath,
        offset: cls.nameOffset,
      })
    for (const m of cls.methods) {
      if (m.params.length > 0 || m.modifiers.includes("static") || m.modifiers.includes("private"))
        continue
      const getter = /^(get|is|has)([A-Z].*)$/.exec(m.name)
      if (getter && m.returnType.name !== "void")
        add({
          name: lowerFirst(getter[2]),
          type: m.returnType,
          kind: "getter",
          className: cls.name,
          filePath: cls.filePath,
          offset: m.nameOffset,
        })
    }
    for (const f of cls.fields) {
      if (f.modifiers.includes("static")) continue
      if (f.modifiers.includes("public") || cls.kind === "record")
        add({
          name: f.name,
          type: f.type,
          kind: cls.modifiers.includes("kotlin") ? "getter" : "field",
          className: cls.name,
          filePath: cls.filePath,
          offset: f.nameOffset,
        })
    }
    // Lombok-style: @Data / @Getter classes expose private fields as getters.
    if (
      cls.annotations.some((a) => a.name === "Data" || a.name === "Getter" || a.name === "Value")
    ) {
      for (const f of cls.fields) {
        if (!f.modifiers.includes("static"))
          add({
            name: f.name,
            type: f.type,
            kind: "getter",
            className: cls.name,
            filePath: cls.filePath,
            offset: f.nameOffset,
          })
      }
    }
    // Plain methods without parameters are reachable too (Pebble calls foo.bar() / foo.bar)
    for (const m of cls.methods) {
      if (
        m.params.length > 0 ||
        m.modifiers.includes("static") ||
        m.modifiers.includes("private") ||
        m.returnType.name === "void"
      )
        continue
      if (/^(get|is|has)[A-Z]/.test(m.name)) continue
      add({
        name: m.name,
        type: m.returnType,
        kind: "method",
        className: cls.name,
        filePath: cls.filePath,
        offset: m.nameOffset,
      })
    }
    if (cls.superclass) for (const p of this.propertiesOf(cls.superclass, depth + 1)) add(p)
    for (const i of cls.interfaces) for (const p of this.propertiesOf(i, depth + 1)) add(p)
    return [...out.values()]
  }

  /** Type of `base.segment.segment…` starting from a known root type. */
  resolveChain(root: JavaType | undefined, segments: string[]): JavaType | undefined {
    let current = root
    for (const segment of segments) {
      if (!current) return undefined
      const prop = this.propertiesOf(current).find((p) => p.name === segment)
      current = prop?.type
    }
    return current
  }

  // ----- controllers -----

  private collectController(cls: JavaClass) {
    const isAdvice = cls.annotations.some((a) => a.name === "ControllerAdvice")
    const isController =
      cls.annotations.some((a) => a.name === "Controller" || a.name === "RestController") ||
      isAdvice
    const classLevelModel: TemplateAttribute[] = []
    for (const m of cls.methods) {
      const modelAttr = m.annotations.find((a) => a.name === "ModelAttribute")
      if (
        modelAttr &&
        m.params.every((p) => !p.annotations.some((a) => a.name === "ModelAttribute"))
      ) {
        if (m.returnType.name === "void") continue
        const name = modelAttr.value ?? lowerFirst(m.returnType.name)
        const attr: TemplateAttribute = {
          name,
          type: m.returnType,
          className: cls.name,
          methodName: m.name,
          filePath: cls.filePath,
          offset: m.nameOffset,
          global: isAdvice,
        }
        if (isAdvice) this.globalAttributes.push(attr)
        else classLevelModel.push(attr)
      }
    }
    for (const m of cls.methods) {
      if (
        m.annotations.some(
          (a) =>
            a.name === "ModelAttribute" || a.name === "ExceptionHandler" || a.name === "InitBinder",
        )
      ) {
        continue
      }
      const isHandler = m.annotations.some((a) => MAPPING_ANNOTATIONS.has(a.name))
      const perView = new Map<string, TemplateAttribute[]>()
      for (const call of this.renderCallsOf(m)) {
        const list = perView.get(call.view) ?? []
        list.push(
          ...call.attributes.map((a) => ({
            ...a,
            className: cls.name,
            methodName: m.name,
            filePath: cls.filePath,
            global: false,
          })),
        )
        perView.set(call.view, list)
      }
      if (
        isHandler ||
        (isController && (m.returnType.name === "String" || m.returnType.name === "ModelAndView"))
      ) {
        const springAttributes = [...classLevelModel, ...this.attributesOf(cls, m)]
        for (const v of this.springViewNamesOf(m))
          perView.set(v, [...(perView.get(v) ?? []), ...springAttributes])
      }
      for (const [view, attributes] of perView) {
        const list = this.viewAttributes.get(view) ?? []
        for (const a of attributes) if (!list.some((x) => x.name === a.name)) list.push(a)
        this.viewAttributes.set(view, list)
      }
    }
  }

  /**
   * Explicit render calls used outside Spring MVC: Ktor `PebbleContent("x", mapOf(…))` and
   * `call.respondTemplate("x", …)`, Javalin `ctx.render("x", Map.of(…))`, and plain Pebble
   * `engine.getTemplate("x")` + `template.evaluate(writer, Map.of(…))`.
   */
  private renderCallsOf(
    method: JavaMethod,
  ): { view: string; attributes: { name: string; type: JavaType; offset: number }[] }[] {
    const body = method.body
    const masked = maskJava(body)
    const calls: {
      view: string
      attributes: { name: string; type: JavaType; offset: number }[]
    }[] = []
    let pendingTemplate: string | undefined
    const re = /\b(PebbleContent|respondTemplate|render|getTemplate|evaluate|renderTemplate)\s*\(/g
    for (const m of masked.matchAll(re)) {
      const argsStart = m.index + m[0].length
      const argsEnd = closingParen(masked, argsStart - 1)
      if (argsEnd === -1) continue
      const args = splitTopLevel(body.slice(argsStart, argsEnd))
      const nameLit = args[0] ? /^"([^"]*)"$/.exec(args[0]) : null
      if (m[1] === "getTemplate") {
        if (nameLit) pendingTemplate = nameLit[1]
        continue
      }
      let view: string | undefined
      let mapArg: string | undefined
      if (m[1] === "evaluate") {
        view = pendingTemplate
        mapArg = args[1]
      } else {
        if (!nameLit) continue
        view = nameLit[1]
        mapArg = args[1]
      }
      if (!view) continue
      const attributes = mapArg
        ? this.mapEntries(mapArg, method).map((entry) => ({
            ...entry,
            offset: method.bodyOffset + m.index,
          }))
        : []
      calls.push({ view, attributes })
    }
    return calls
  }

  /** Entries of an inline map literal, or of a local map variable initialised and mutated in the method. */
  private mapEntries(
    expr: string,
    method: JavaMethod,
    depth = 0,
  ): { name: string; type: JavaType }[] {
    if (depth > 3) return []
    const cls = this.ownerOf(method)
    const e = expr.trim()
    const out: { name: string; type: JavaType }[] = []
    const inner =
      /^(?:mapOf|mutableMapOf|hashMapOf|linkedMapOf|Map\.of|model)\s*(?:<[^>]*>)?\s*\(([\s\S]*)\)$/.exec(
        e,
      )
    if (inner) {
      const parts = splitTopLevel(inner[1])
      if (parts.some((p) => /\bto\b/.test(p))) {
        for (const p of parts) {
          const pair = /^"([^"]*)"\s+to\s+([\s\S]+)$/.exec(p.trim())
          if (pair)
            out.push({
              name: pair[1],
              type: this.inferType(pair[2], cls, method) ?? parseType("Object"),
            })
        }
      } else {
        for (let i = 0; i + 1 < parts.length; i += 2) {
          const key = /^"([^"]*)"$/.exec(parts[i].trim())
          if (key)
            out.push({
              name: key[1],
              type: this.inferType(parts[i + 1], cls, method) ?? parseType("Object"),
            })
        }
      }
      return out
    }
    if (/^[A-Za-z_$][\w$]*$/.test(e)) {
      const masked = maskJava(method.body)
      const init = new RegExp(`\\b${e}\\s*(?::[^=\\n]+)?=\\s*`).exec(masked)
      if (init) {
        const end = statementEnd(masked, init.index + init[0].length)
        out.push(
          ...this.mapEntries(
            method.body.slice(init.index + init[0].length, end),
            method,
            depth + 1,
          ),
        )
      }
      for (const m of masked.matchAll(
        new RegExp(`\\b${e}\\s*\\[\\s*"(_*)"\\s*\\]\\s*=\\s*`, "g"),
      )) {
        const q = m.index + m[0].indexOf('"') + 1
        const name = method.body.slice(q, q + m[1].length)
        const end = statementEnd(masked, m.index + m[0].length)
        out.push({
          name,
          type:
            this.inferType(method.body.slice(m.index + m[0].length, end), cls, method) ??
            parseType("Object"),
        })
      }
      for (const m of masked.matchAll(new RegExp(`\\b${e}\\.put\\s*\\(`, "g"))) {
        const argsStart = m.index + m[0].length
        const argsEnd = closingParen(masked, argsStart - 1)
        if (argsEnd === -1) continue
        const args = splitTopLevel(method.body.slice(argsStart, argsEnd))
        const key = args[0] ? /^"([^"]*)"$/.exec(args[0]) : null
        if (key && args[1])
          out.push({
            name: key[1],
            type: this.inferType(args[1], cls, method) ?? parseType("Object"),
          })
      }
    }
    return out
  }

  private ownerOf(method: JavaMethod): JavaClass {
    for (const list of this.classes.values())
      for (const c of list) if (c.methods.includes(method)) return c
    return {
      name: "",
      fqn: "",
      kind: "class",
      annotations: [],
      modifiers: [],
      interfaces: [],
      fields: [],
      methods: [],
      recordComponents: [],
      nameOffset: 0,
      filePath: "",
    }
  }

  private springViewNamesOf(method: JavaMethod): string[] {
    const masked = maskJava(method.body)
    const out = new Set<string>()
    for (const lit of stringLiterals(method.body)) {
      const before = masked.slice(Math.max(0, lit.start - 40), lit.start)
      const isView =
        /\breturn\s*\(?\s*$/.test(before) ||
        /(new\s+)?ModelAndView\s*\(\s*$/.test(before) ||
        /\.setViewName\s*\(\s*$/.test(before) ||
        /\bview\s*=\s*$/.test(before)
      if (!isView) continue
      if (/^(redirect|forward):/.test(lit.value) || lit.value.includes(" ")) continue
      out.add(lit.value)
    }
    // `String view = "x"; … return view;` is covered by the `view =` heuristic above.
    return [...out]
  }

  private attributesOf(cls: JavaClass, method: JavaMethod): TemplateAttribute[] {
    const out: TemplateAttribute[] = []
    const body = method.body
    const masked = maskJava(body)
    for (const p of method.params) {
      const ann = p.annotations.find((a) => a.name === "ModelAttribute")
      if (ann)
        out.push({
          name: ann.value ?? lowerFirst(p.type.name),
          type: p.type,
          className: cls.name,
          methodName: method.name,
          filePath: cls.filePath,
          offset: method.nameOffset,
          global: false,
        })
    }
    for (const m of masked.matchAll(/\b(model|mav|modelAndView)\s*\[\s*"(_*)"\s*\]\s*=\s*/g)) {
      const q = m.index + m[0].indexOf('"') + 1
      const name = body.slice(q, q + m[2].length)
      const end = statementEnd(masked, m.index + m[0].length)
      const type =
        this.inferType(body.slice(m.index + m[0].length, end), cls, method) ?? parseType("Object")
      out.push({
        name,
        type,
        className: cls.name,
        methodName: method.name,
        filePath: cls.filePath,
        offset: method.bodyOffset + m.index,
        global: false,
      })
    }
    for (const m of masked.matchAll(/ModelAndView\s*\(/g)) {
      const argsEnd = closingParen(masked, m.index + m[0].length - 1)
      if (argsEnd === -1) continue
      const args = splitTopLevel(body.slice(m.index + m[0].length, argsEnd))
      if (!args[1]) continue
      for (const entry of this.mapEntries(args[1], method)) {
        out.push({
          ...entry,
          className: cls.name,
          methodName: method.name,
          filePath: cls.filePath,
          offset: method.bodyOffset + m.index,
          global: false,
        })
      }
    }
    const re = /\.(addAttribute|put|addObject|addAttributeIfAbsent)\s*\(/g
    for (const m of masked.matchAll(re)) {
      const argsStart = m.index + m[0].length
      const argsEnd = closingParen(masked, argsStart - 1)
      if (argsEnd === -1) continue
      const args = splitTopLevel(body.slice(argsStart, argsEnd))
      if (args.length < 2) continue
      const nameLit = /^"([^"]*)"$/.exec(args[0])
      if (!nameLit) continue
      const type = this.inferType(args[1], cls, method) ?? parseType("Object")
      out.push({
        name: nameLit[1],
        type,
        className: cls.name,
        methodName: method.name,
        filePath: cls.filePath,
        offset: method.bodyOffset + m.index,
        global: false,
      })
    }
    return out
  }

  /** Best-effort type of an expression inside a method body. */
  inferType(expr: string, cls: JavaClass, method: JavaMethod, depth = 0): JavaType | undefined {
    const e = expr.trim()
    if (!e || depth > 5) return undefined
    if (/^"/.test(e)) return parseType("String")
    if (/^(true|false)$/.test(e)) return parseType("Boolean")
    if (/^-?\d+L$/.test(e)) return parseType("Long")
    if (/^-?\d+$/.test(e)) return parseType("Integer")
    if (/^-?\d*\.\d+/.test(e)) return parseType("Double")
    const ctor = /^new\s+([\w.<>, ]+?)\s*[\[(]/.exec(e)
    if (ctor) return parseType(ctor[1].replace(/<>$/, ""))
    const ktCtor = /^([A-Z][\w.]*(?:<[^>]*>)?)\s*\(/.exec(e)
    if (ktCtor && this.classNamed(ktCtor[1].replace(/<.*$/, ""))) return parseType(ktCtor[1])
    const ktFactory =
      /^(listOf|mutableListOf|arrayListOf|setOf|mutableSetOf)\s*\(([\s\S]*)\)$/.exec(e)
    if (ktFactory) {
      const first = splitTopLevel(ktFactory[2])[0]
      const element = first ? this.inferType(first, cls, method, depth + 1) : undefined
      const container = ktFactory[1].toLowerCase().includes("set") ? "Set" : "List"
      return parseType(`${container}<${element?.raw ?? "Object"}>`)
    }
    if (/^(mapOf|mutableMapOf|hashMapOf)\s*\(/.test(e)) return parseType("Map<Object, Object>")
    const factory = /^(List|Arrays|Set|Stream)\.(of|asList)\s*\(([\s\S]*)\)$/.exec(e)
    if (factory) {
      const first = splitTopLevel(factory[3])[0]
      const element = first ? this.inferType(first, cls, method, depth + 1) : undefined
      const container = factory[1] === "Set" ? "Set" : "List"
      return parseType(`${container}<${element?.raw ?? "Object"}>`)
    }
    if (/^Map\.of\s*\(/.test(e)) return parseType("Map<Object, Object>")
    // trailing method call chain: base.method(...)
    const call = splitCall(e)
    if (call) {
      const baseType = this.inferType(call.base, cls, method, depth + 1)
      const target = baseType ? this.classNamed(baseType.name) : undefined
      const m = target?.methods.find((x) => x.name === call.name)
      if (m) return m.returnType
      if (baseType && /^(get|is|has)[A-Z]/.test(call.name)) {
        return this.propertiesOf(baseType).find(
          (p) => p.name === lowerFirst(call.name.replace(/^(get|is|has)/, "")),
        )?.type
      }
      if (
        baseType &&
        (call.name === "stream" ||
          call.name === "toList" ||
          call.name === "collect" ||
          call.name === "sorted" ||
          call.name === "filter")
      )
        return baseType
      if (
        baseType?.name === "Optional" &&
        ["orElseThrow", "orElse", "get", "orElseGet"].includes(call.name)
      )
        return baseType.args[0]
      if (baseType?.name === "Map" && call.name === "get") return baseType.args[1]
      if (
        baseType &&
        COLLECTIONS.has(baseType.name) &&
        ["get", "getFirst", "getLast", "iterator"].includes(call.name)
      )
        return baseType.args[0]
      return undefined
    }
    const member = /^([\s\S]+?)\.([A-Za-z_$][\w$]*)$/.exec(e)
    if (member) {
      const baseType = this.inferType(member[1], cls, method, depth + 1)
      return baseType
        ? this.propertiesOf(baseType).find((p) => p.name === member[2])?.type
        : undefined
    }
    if (/^[A-Za-z_$][\w$]*$/.test(e)) {
      if (e === "this") return parseType(cls.name)
      const param = method.params.find((p) => p.name === e)
      if (param) return param.type
      const local = this.localVariableType(e, cls, method, depth)
      if (local) return local
      const field = cls.fields.find((f) => f.name === e)
      if (field) return field.type
      // A class name used statically
      if (/^[A-Z]/.test(e) && this.classNamed(e)) return parseType(e)
    }
    return undefined
  }

  private localVariableType(
    name: string,
    cls: JavaClass,
    method: JavaMethod,
    depth: number,
  ): JavaType | undefined {
    const masked = maskJava(method.body)
    // Kotlin: val name: Type = … / val name = expr
    const kt = new RegExp(`\\b(?:val|var)\\s+${name}\\s*(?::\\s*([^=\\n]+?))?\\s*=\\s*`).exec(
      masked,
    )
    if (kt) {
      if (kt[1]) return parseType(kt[1].replace(/\?/g, "").trim())
      const end = statementEnd(masked, kt.index + kt[0].length)
      return this.inferType(method.body.slice(kt.index + kt[0].length, end), cls, method, depth + 1)
    }
    const re = new RegExp(
      `(?:^|[;{}(\\s])(?:final\\s+)?([A-Za-z_$][\\w$<>,.\\[\\] ?]*?)\\s+${name}\\s*(=|:|;)`,
      "g",
    )
    for (const m of masked.matchAll(re)) {
      const typeText = m[1].trim()
      if (typeText === "var") {
        const eq = method.body.indexOf("=", m.index + m[0].length - 1)
        const end = method.body.indexOf(";", eq)
        if (eq !== -1 && end !== -1)
          return this.inferType(method.body.slice(eq + 1, end), cls, method, depth + 1)
        return undefined
      }
      if (/^(return|throw|new|else|import)$/.test(typeText)) continue
      return parseType(typeText)
    }
    return undefined
  }

  // ----- Pebble extensions -----

  private collectExtensions(cls: JavaClass) {
    const implementsAny = (names: string[]) =>
      cls.interfaces.some((i) => names.includes(i.name)) ||
      (cls.superclass && names.includes(cls.superclass.name))
    const kind: JavaExtensionEntry["kind"] | undefined = implementsAny(["Filter"])
      ? "filter"
      : implementsAny(["Function"])
        ? "function"
        : implementsAny(["Test"])
          ? "test"
          : undefined
    // Registrations in extensions: filters.put("name", new NameFilter())
    const registrations = new Map<
      string,
      { kind: JavaExtensionEntry["kind"]; name: string; className: string; offset: number }
    >()
    for (const m of cls.methods) {
      const k =
        m.name === "getFilters"
          ? "filter"
          : m.name === "getFunctions"
            ? "function"
            : m.name === "getTests"
              ? "test"
              : undefined
      if (!k) continue
      const masked = maskJava(m.body)
      for (const r of masked.matchAll(/\.put\s*\(\s*"(_*)"\s*,\s*new\s+([A-Za-z_$][\w$.]*)/g)) {
        const name = m.body.slice(
          r.index + r[0].indexOf('"') + 1,
          r.index + r[0].indexOf('"') + 1 + r[1].length,
        )
        registrations.set(`${k}:${name}`, {
          kind: k,
          name,
          className: r[2].split(".").pop() ?? r[2],
          offset: m.bodyOffset + r.index,
        })
      }
      for (const r of masked.matchAll(/Map\.of\s*\(([\s\S]*?)\)/g)) {
        const entries = splitTopLevel(
          m.body.slice(r.index + r[0].indexOf("(") + 1, r.index + r[0].length - 1),
        )
        for (let i = 0; i + 1 < entries.length; i += 2) {
          const nameLit = /^"([^"]*)"$/.exec(entries[i])
          const ctor = /new\s+([A-Za-z_$][\w$.]*)/.exec(entries[i + 1])
          if (nameLit && ctor)
            registrations.set(`${k}:${nameLit[1]}`, {
              kind: k,
              name: nameLit[1],
              className: ctor[1].split(".").pop() ?? ctor[1],
              offset: m.bodyOffset + r.index,
            })
        }
      }
    }
    for (const reg of registrations.values()) {
      const impl = this.classNamed(reg.className)
      this.extensions.push({
        kind: reg.kind,
        name: reg.name,
        params: impl ? argumentNamesOf(impl) : [],
        className: reg.className,
        filePath: impl?.filePath ?? cls.filePath,
        offset: impl?.nameOffset ?? reg.offset,
      })
    }
    if (kind && !this.extensions.some((e) => e.className === cls.name)) {
      // Unregistered implementation: derive the name from the class name (MoneyFilter -> money)
      const derived = lowerFirst(cls.name.replace(/(Filter|Function|Test)$/, ""))
      const nameField = cls.fields.find((f) => /NAME$/.test(f.name) && f.initializer)
      const literal = nameField?.initializer
        ? /"([^"]*)"/.exec(nameField.initializer)?.[1]
        : undefined
      this.extensions.push({
        kind,
        name: literal ?? derived,
        params: argumentNamesOf(cls),
        className: cls.name,
        filePath: cls.filePath,
        offset: cls.nameOffset,
      })
    }
  }
}

function argumentNamesOf(cls: JavaClass): string[] {
  const m = cls.methods.find((x) => x.name === "getArgumentNames")
  const names: string[] = []
  const sources = [m?.body ?? "", ...cls.fields.map((f) => f.initializer ?? "")]
  // also constructor/initializer bodies: argumentNames.add("x") appears in methods named like the class (constructors are skipped) - scan all method bodies
  for (const method of cls.methods) sources.push(method.body)
  for (const src of sources) {
    for (const lit of src.matchAll(
      /(?:\.add|List\.of|listOf|mutableListOf|Arrays\.asList|singletonList|of)\s*\(\s*((?:"[^"]*"\s*,?\s*)+)\)/g,
    )) {
      for (const s of stringLiterals(lit[1])) if (!names.includes(s.value)) names.push(s.value)
    }
  }
  return names
}

/** Splits `a.b(c).name(args)` into base `a.b(c)`, name and args when the expression ends with a call. */
function splitCall(e: string): { base: string; name: string; args: string } | null {
  if (!e.endsWith(")")) return null
  let depth = 0
  let open = -1
  for (let k = e.length - 1; k >= 0; k--) {
    if (e[k] === ")") depth++
    else if (e[k] === "(") {
      depth--
      if (depth === 0) {
        open = k
        break
      }
    }
  }
  if (open <= 0) return null
  const prefix = e.slice(0, open).trimEnd()
  const m = /^([\s\S]+?)\.([A-Za-z_$][\w$]*)$/.exec(prefix)
  if (!m) return null
  return { base: m[1], name: m[2], args: e.slice(open + 1, -1) }
}

/** End of the statement/expression starting at `from`: the next `;`, newline or closing bracket at depth 0. */
function statementEnd(masked: string, from: number): number {
  let depth = 0
  for (let i = from; i < masked.length; i++) {
    const ch = masked[i]
    if (ch === "(" || ch === "{" || ch === "[") depth++
    else if (ch === ")" || ch === "}" || ch === "]") {
      if (depth === 0) return i
      depth--
    } else if ((ch === ";" || ch === "\n") && depth === 0) return i
  }
  return masked.length
}

function fileStem(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? filePath
  return base.replace(/\.(java|kt)$/, "")
}

function closingParen(masked: string, open: number): number {
  let depth = 0
  for (let i = open; i < masked.length; i++) {
    if (masked[i] === "(") depth++
    else if (masked[i] === ")") {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}
