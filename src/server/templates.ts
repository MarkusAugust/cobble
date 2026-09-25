import * as path from "node:path"
import { fileURLToPath } from "node:url"
import type { TextDocument, TextDocuments } from "vscode-languageserver/node"
import {
  type Analysis,
  analyze,
  listTemplates,
  resolveTemplate,
  TemplateGraph,
  type TemplateSettings,
} from "../core"
import type { NodeTemplateFileSystem } from "./fs"

/**
 * Knows every template in the workspace: resolves names, caches analyses of files on disk
 * (open editors take precedence) and builds the relationship graph.
 */
export class TemplateIndex {
  private readonly diskCache = new Map<string, Analysis>()
  private readonly docCache = new Map<string, { version: number; analysis: Analysis }>()
  private listing: { key: string; files: Promise<string[]> } | undefined

  constructor(
    private readonly fs: NodeTemplateFileSystem,
    private readonly documents: TextDocuments<TextDocument>,
  ) {}

  /** Drops disk caches; called on watched-file events. */
  invalidate(changedPaths?: string[]) {
    if (!changedPaths) {
      this.diskCache.clear()
      this.listing = undefined
      return
    }
    for (const p of changedPaths) this.diskCache.delete(p)
    this.listing = undefined
  }

  invalidateDocument(uri: string) {
    this.docCache.delete(uri)
  }

  resolver(settings: TemplateSettings) {
    return (name: string, fromFile: string | undefined) =>
      resolveTemplate(name, fromFile, settings, this.fs)
  }

  async allFiles(settings: TemplateSettings): Promise<string[]> {
    const key = JSON.stringify([settings, this.fs.workspaceFolders])
    if (!this.listing || this.listing.key !== key) {
      const files = listTemplates(undefined, settings, this.fs, 6).then((list) => [
        ...new Set(list.map((t) => t.filePath)),
      ])
      this.listing = { key, files }
    }
    return this.listing.files
  }

  /** Analysis of a template file, from the open editor when available, otherwise from disk. */
  async analysisOf(filePath: string, customTags: string[] = []): Promise<Analysis | null> {
    const open = this.documents
      .all()
      .find((d) => d.uri.startsWith("file:") && fileURLToPath(d.uri) === filePath)
    if (open) {
      const cached = this.docCache.get(open.uri)
      if (cached && cached.version === open.version) return cached.analysis
      const analysis = analyze(open.getText(), { customTags })
      this.docCache.set(open.uri, { version: open.version, analysis })
      return analysis
    }
    const cached = this.diskCache.get(filePath)
    if (cached) return cached
    const text = await this.fs.readText(filePath)
    if (text === null) return null
    const analysis = analyze(text, { customTags })
    this.diskCache.set(filePath, analysis)
    return analysis
  }

  graph(settings: TemplateSettings, customTags: string[] = []): TemplateGraph {
    return new TemplateGraph(
      this.resolver(settings),
      (p) => this.analysisOf(p, customTags),
      () => this.allFiles(settings),
    )
  }

  /** Short display name of a template file, relative to the nearest template root or workspace folder. */
  displayName(filePath: string, settings: TemplateSettings): string {
    let best = path.basename(filePath)
    let bestLength = Number.POSITIVE_INFINITY
    for (const folder of this.fs.workspaceFolders) {
      for (const root of [...settings.templateRoots.map((r) => path.resolve(folder, r)), folder]) {
        if (filePath.startsWith(`${root}${path.sep}`)) {
          const rel = path.relative(root, filePath).split(path.sep).join("/")
          if (rel.length < bestLength) {
            best = rel
            bestLength = rel.length
          }
        }
      }
    }
    return best
  }
}
