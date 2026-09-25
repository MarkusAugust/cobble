import type { Analysis } from "./analysis"

/** Resolves a template name written in `fromFile` to an absolute path, or null. */
export type TemplateResolver = (
  name: string,
  fromFile: string | undefined,
) => Promise<string | null>

/** Provides the analysis of a template file on disk (or of the open editor buffer). */
export type AnalysisProvider = (filePath: string) => Promise<Analysis | null>

export interface TemplateEntry {
  filePath: string
  analysis: Analysis
}

export interface ParentLink extends TemplateEntry {
  /** Depth in the extends chain: 1 = direct parent. */
  depth: number
}

/**
 * Relationships between templates: the extends chain upwards, and which templates extend or
 * import a given file. Everything is computed on demand from a list of known template files.
 */
export class TemplateGraph {
  constructor(
    private readonly resolve: TemplateResolver,
    private readonly analysisOf: AnalysisProvider,
    /** Absolute paths of every template in the workspace (from the index scan). */
    private readonly allFiles: () => Promise<string[]>,
  ) {}

  /** The extends chain of a template, nearest parent first. Cycle-safe, max 10 levels. */
  async parentChain(filePath: string | undefined, analysis: Analysis): Promise<ParentLink[]> {
    const chain: ParentLink[] = []
    const seen = new Set<string>(filePath ? [filePath] : [])
    let current = { filePath, analysis }
    for (let depth = 1; depth <= 10; depth++) {
      const name = current.analysis.model.extends?.literalName
      if (!name) break
      const parent = await this.resolve(name, current.filePath)
      if (!parent || seen.has(parent)) break
      seen.add(parent)
      const parentAnalysis = await this.analysisOf(parent)
      if (!parentAnalysis) break
      chain.push({ filePath: parent, analysis: parentAnalysis, depth })
      current = { filePath: parent, analysis: parentAnalysis }
    }
    return chain
  }

  /** Block names defined anywhere up the extends chain (nearest definition first, de-duplicated). */
  async inheritedBlocks(
    filePath: string | undefined,
    analysis: Analysis,
  ): Promise<{ name: string; from: ParentLink }[]> {
    const out: { name: string; from: ParentLink }[] = []
    const seen = new Set<string>()
    for (const parent of await this.parentChain(filePath, analysis)) {
      for (const b of parent.analysis.model.blocks) {
        if (seen.has(b.name)) continue
        seen.add(b.name)
        out.push({ name: b.name, from: parent })
      }
    }
    return out
  }

  /** Templates that directly extend the given file. */
  async childrenOf(filePath: string): Promise<TemplateEntry[]> {
    return this.filesWhere(async (entry) => {
      const name = entry.analysis.model.extends?.literalName
      return name !== undefined && (await this.resolve(name, entry.filePath)) === filePath
    })
  }

  /** Every template below the given file in the extends hierarchy (transitively). */
  async descendantsOf(filePath: string): Promise<TemplateEntry[]> {
    const out: TemplateEntry[] = []
    const seen = new Set<string>([filePath])
    const queue = [filePath]
    while (queue.length > 0) {
      const next = queue.shift() as string
      for (const child of await this.childrenOf(next)) {
        if (seen.has(child.filePath)) continue
        seen.add(child.filePath)
        out.push(child)
        queue.push(child.filePath)
      }
    }
    return out
  }

  /** Templates that import (import/from) or include/embed the given file. */
  async importersOf(filePath: string): Promise<TemplateEntry[]> {
    return this.filesWhere(async (entry) => {
      for (const ref of entry.analysis.model.references) {
        if (ref.statement.type === "Extends" || !ref.literalName) continue
        if ((await this.resolve(ref.literalName, entry.filePath)) === filePath) return true
      }
      return false
    })
  }

  private async filesWhere(
    predicate: (entry: TemplateEntry) => Promise<boolean>,
  ): Promise<TemplateEntry[]> {
    const out: TemplateEntry[] = []
    for (const filePath of await this.allFiles()) {
      const analysis = await this.analysisOf(filePath)
      if (!analysis) continue
      const entry = { filePath, analysis }
      if (await predicate(entry)) out.push(entry)
    }
    return out
  }
}
