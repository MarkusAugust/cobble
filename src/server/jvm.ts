import * as path from "node:path"
import {
  type CustomEntry,
  type ExternalVariable,
  type JavaFile,
  JavaModel,
  type PropertyInfo,
  parseJava,
  parseKotlin,
  resolveTemplate,
  type TemplateAttribute,
  type TemplateSettings,
  type TypeInfo,
  type TypeProvider,
} from "../core"
import type { NodeTemplateFileSystem } from "./fs"

const SKIP_DIRS = new Set([
  "build",
  "target",
  "node_modules",
  ".git",
  ".gradle",
  ".idea",
  "out",
  "dist",
  "generated",
])
const MAX_FILES = 4000

/**
 * Scans Java and Kotlin sources, keeps parsed files cached and exposes the model to the
 * language features through the core's TypeProvider interface.
 */
export class JvmIndex {
  private readonly parsed = new Map<string, { text: string; file: JavaFile }>()
  private model: JavaModel | undefined
  private listing: { key: string; files: Promise<string[]> } | undefined
  private viewCache = new Map<string, string | null>()
  /** Increments whenever sources change; part of the spec cache key. */
  version = 0

  constructor(private readonly fs: NodeTemplateFileSystem) {}

  invalidate(changedPaths?: string[]) {
    if (!changedPaths) {
      this.parsed.clear()
      this.listing = undefined
    } else {
      for (const p of changedPaths) this.parsed.delete(p)
      if (changedPaths.some((p) => !this.parsed.has(p))) this.listing = undefined
    }
    this.model = undefined
    this.viewCache.clear()
    this.version++
  }

  async sourceFiles(sourceRoots: string[]): Promise<string[]> {
    const key = JSON.stringify([sourceRoots, this.fs.workspaceFolders])
    if (!this.listing || this.listing.key !== key) {
      this.listing = { key, files: this.scan(sourceRoots) }
    }
    return this.listing.files
  }

  private async scan(sourceRoots: string[]): Promise<string[]> {
    const out: string[] = []
    const visit = async (dir: string, depth: number) => {
      if (out.length >= MAX_FILES || depth > 12) return
      for (const entry of await this.fs.readDir(dir)) {
        if (entry.isDirectory) {
          if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith("."))
            await visit(path.join(dir, entry.name), depth + 1)
        } else if (entry.name.endsWith(".java") || entry.name.endsWith(".kt"))
          out.push(path.join(dir, entry.name))
      }
    }
    for (const folder of this.fs.workspaceFolders) {
      for (const root of sourceRoots) await visit(path.resolve(folder, root), 0)
    }
    return out
  }

  async getModel(sourceRoots: string[]): Promise<JavaModel> {
    if (this.model) return this.model
    const files: JavaFile[] = []
    for (const filePath of await this.sourceFiles(sourceRoots)) {
      let entry = this.parsed.get(filePath)
      if (!entry) {
        const text = await this.fs.readText(filePath)
        if (text === null) continue
        const file = filePath.endsWith(".kt")
          ? parseKotlin(text, filePath)
          : parseJava(text, filePath)
        entry = { text, file }
        this.parsed.set(filePath, entry)
      }
      files.push(entry.file)
    }
    this.model = new JavaModel(files)
    return this.model
  }

  /** Source text of an indexed file (for converting offsets to positions). */
  async textOf(filePath: string): Promise<string | null> {
    return this.parsed.get(filePath)?.text ?? (await this.fs.readText(filePath))
  }

  /** Pebble extensions found in the sources, as custom spec entries. */
  async extensions(
    sourceRoots: string[],
  ): Promise<{ filters: CustomEntry[]; functions: CustomEntry[]; tests: CustomEntry[] }> {
    const model = await this.getModel(sourceRoots)
    const out = {
      filters: [] as CustomEntry[],
      functions: [] as CustomEntry[],
      tests: [] as CustomEntry[],
    }
    for (const e of model.extensions) {
      const entry: CustomEntry = {
        name: e.name,
        params: e.params,
        description: `Declared by \`${e.className}\` in ${path.basename(e.filePath)}.`,
      }
      if (e.kind === "filter") out.filters.push(entry)
      else if (e.kind === "function") out.functions.push(entry)
      else out.tests.push(entry)
    }
    return out
  }

  /** Model attributes reaching a template file, from every controller or route that renders it. */
  async attributesFor(
    templateFile: string | undefined,
    sourceRoots: string[],
    templates: TemplateSettings,
  ): Promise<TemplateAttribute[]> {
    const model = await this.getModel(sourceRoots)
    if (!templateFile) return model.allGlobalAttributes()
    const out: TemplateAttribute[] = []
    const seen = new Set<string>()
    for (const view of model.viewNames()) {
      let resolved = this.viewCache.get(view)
      if (resolved === undefined) {
        resolved = await resolveTemplate(view, undefined, templates, this.fs)
        this.viewCache.set(view, resolved)
      }
      if (resolved !== templateFile) continue
      for (const a of model.attributesForView(view)) {
        if (seen.has(a.name)) continue
        seen.add(a.name)
        out.push(a)
      }
    }
    if (out.length === 0) return model.allGlobalAttributes()
    return out
  }

  async typeProvider(
    templateFile: string | undefined,
    sourceRoots: string[],
    templates: TemplateSettings,
  ): Promise<TypeProvider> {
    const model = await this.getModel(sourceRoots)
    const attributes = await this.attributesFor(templateFile, sourceRoots, templates)
    const byName = new Map(attributes.map((a) => [a.name, a]))
    const describe = (a: TemplateAttribute): ExternalVariable => ({
      type: a.type,
      detail: a.global
        ? `Global model attribute from \`${a.className}.${a.methodName}\` (${path.basename(a.filePath)})`
        : `Model attribute added in \`${a.className}.${a.methodName}\` (${path.basename(a.filePath)})`,
      filePath: a.filePath,
      offset: a.offset,
    })
    return {
      externalVariable: (name) => {
        const a = byName.get(name)
        return a ? describe(a) : undefined
      },
      externalVariableNames: () => [...byName.keys()],
      propertiesOf: (type: TypeInfo): PropertyInfo[] =>
        model.propertiesOf(type).map((p) => ({
          name: p.name,
          type: p.type,
          detail: `${p.kind === "getter" ? "Property" : p.kind === "record" ? "Record component" : p.kind === "field" ? "Field" : "Method"} of \`${p.className}\` (${path.basename(p.filePath)})`,
          filePath: p.filePath,
          offset: p.offset,
        })),
      elementType: (type) => model.elementType(type),
    }
  }
}
