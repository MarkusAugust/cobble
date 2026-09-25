import { pathToFileURL } from "node:url"
import type {
  CodeLens,
  DocumentLink,
  InlayHint,
  Location,
  SymbolInformation,
  WorkspaceEdit,
} from "vscode-languageserver/node"
import { SymbolKind, TextEdit } from "vscode-languageserver/node"
import { TextDocument } from "vscode-languageserver-textdocument"
import {
  type Analysis,
  documentLinks as coreDocumentLinks,
  inlayHints as coreInlayHints,
  lensAnchors,
  localReferences,
  type Symbol,
  symbolAt,
  type TemplateSettings,
} from "../core"
import { toLspRange } from "./convert"
import type { TemplateIndex } from "./templates"

const docFor = (filePath: string, analysis: Analysis) =>
  TextDocument.create(pathToFileURL(filePath).toString(), "pebble", 0, analysis.text)

/** Cross-file references, lenses, links and rename built on the template index. */
export class WorkspaceFeatures {
  constructor(private readonly index: TemplateIndex) {}

  /** Every location referring to the symbol, across the extends chain and importers. */
  async references(
    doc: TextDocument,
    filePath: string | undefined,
    analysis: Analysis,
    symbol: Symbol,
    settings: TemplateSettings,
    customTags: string[],
    forRename = false,
  ): Promise<Location[]> {
    const out: Location[] = []
    const push = (d: TextDocument, ranges: { start: number; end: number }[]) => {
      for (const r of ranges) out.push({ uri: d.uri, range: toLspRange(d, r) })
    }
    push(doc, localReferences(analysis, symbol, forRename))
    const graph = this.index.graph(settings, customTags)
    const resolve = this.index.resolver(settings)

    if (symbol.kind === "block") {
      for (const parent of await graph.parentChain(filePath, analysis)) {
        push(
          docFor(parent.filePath, parent.analysis),
          localReferences(parent.analysis, symbol, forRename),
        )
      }
      if (filePath) {
        for (const child of await graph.descendantsOf(filePath)) {
          push(
            docFor(child.filePath, child.analysis),
            localReferences(child.analysis, symbol, forRename),
          )
        }
      }
      return dedupe(out)
    }

    if (symbol.kind === "macro") {
      // Find the file that defines the macro.
      let definingFile = filePath
      if (symbol.template) definingFile = (await resolve(symbol.template, filePath)) ?? undefined
      if (!definingFile) return out
      if (definingFile !== filePath) {
        const defining = await this.index.analysisOf(definingFile, customTags)
        if (defining) {
          const macro = defining.model.macros.find((m) => m.name === symbol.name)
          push(
            docFor(definingFile, defining),
            localReferences(
              defining,
              { kind: "macro", name: symbol.name, range: macro?.nameRange ?? { start: 0, end: 0 } },
              forRename,
            ),
          )
        }
      }
      for (const importer of await graph.importersOf(definingFile)) {
        if (importer.filePath === filePath) continue
        for (const imp of importer.analysis.model.imports) {
          if (
            !imp.ref.literalName ||
            (await resolve(imp.ref.literalName, importer.filePath)) !== definingFile
          )
            continue
          push(
            docFor(importer.filePath, importer.analysis),
            localReferences(
              importer.analysis,
              {
                kind: "macro",
                name: symbol.name,
                range: { start: 0, end: 0 },
                template: imp.ref.literalName,
              },
              forRename,
            ),
          )
        }
      }
      return dedupe(out)
    }
    return out
  }

  async rename(
    doc: TextDocument,
    filePath: string | undefined,
    analysis: Analysis,
    symbol: Symbol,
    newName: string,
    settings: TemplateSettings,
    customTags: string[],
  ): Promise<WorkspaceEdit> {
    const locations = await this.references(
      doc,
      filePath,
      analysis,
      symbol,
      settings,
      customTags,
      true,
    )
    const changes: Record<string, TextEdit[]> = {}
    for (const loc of locations) {
      ;(changes[loc.uri] ??= []).push(TextEdit.replace(loc.range, newName))
    }
    return { changes }
  }

  async codeLenses(
    doc: TextDocument,
    filePath: string | undefined,
    analysis: Analysis,
    settings: TemplateSettings,
    customTags: string[],
  ): Promise<CodeLens[]> {
    const out: CodeLens[] = []
    const graph = this.index.graph(settings, customTags)
    const parents = await graph.parentChain(filePath, analysis)
    const descendants = filePath ? await graph.descendantsOf(filePath) : []
    const top = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }
    if (descendants.length > 0) {
      out.push({
        range: top,
        command: {
          title: `${descendants.length} template${descendants.length === 1 ? " extends" : "s extend"} this template`,
          command: "pebble.showLocations",
          arguments: [
            doc.uri,
            top.start,
            descendants.map((d) => ({ uri: pathToFileURL(d.filePath).toString(), range: top })),
          ],
        },
      })
    }
    for (const anchor of lensAnchors(analysis)) {
      const range = toLspRange(doc, anchor.range)
      if (anchor.kind === "block") {
        const overridden = parents.find((p) =>
          p.analysis.model.blocks.some((b) => b.name === anchor.name),
        )
        if (overridden) {
          const block = overridden.analysis.model.blocks.find((b) => b.name === anchor.name)
          const target = docFor(overridden.filePath, overridden.analysis)
          if (block) {
            out.push({
              range,
              command: {
                title: `overrides block in ${this.index.displayName(overridden.filePath, settings)}`,
                command: "pebble.goTo",
                arguments: [target.uri, toLspRange(target, block.nameRange)],
              },
            })
          }
        }
        const overriders = descendants.filter((d) =>
          d.analysis.model.blocks.some((b) => b.name === anchor.name),
        )
        if (overriders.length > 0) {
          out.push({
            range,
            command: {
              title: `overridden in ${overriders.length} template${overriders.length === 1 ? "" : "s"}`,
              command: "pebble.showLocations",
              arguments: [
                doc.uri,
                range.start,
                overriders.map((d) => {
                  const b = d.analysis.model.blocks.find((x) => x.name === anchor.name)
                  const t = docFor(d.filePath, d.analysis)
                  return { uri: t.uri, range: b ? toLspRange(t, b.nameRange) : top }
                }),
              ],
            },
          })
        }
      } else if (anchor.kind === "macro") {
        const macro = analysis.model.macros.find((m) => m.name === anchor.name)
        const refs = await this.references(
          doc,
          filePath,
          analysis,
          { kind: "macro", name: anchor.name, range: macro?.nameRange ?? { start: 0, end: 0 } },
          settings,
          customTags,
        )
        const usages = refs.filter(
          (r) =>
            !(
              r.uri === doc.uri &&
              macro &&
              r.range.start.line === doc.positionAt(macro.nameRange.start).line &&
              r.range.start.character === doc.positionAt(macro.nameRange.start).character
            ),
        )
        out.push({
          range,
          command: {
            title: `${usages.length} usage${usages.length === 1 ? "" : "s"}`,
            command: "pebble.showLocations",
            arguments: [doc.uri, range.start, usages],
          },
        })
      } else if (anchor.kind === "extends" && parents.length > 0) {
        const parent = parents[0]
        out.push({
          range,
          command: {
            title: `extends ${this.index.displayName(parent.filePath, settings)}${parents.length > 1 ? ` (${parents.length} levels)` : ""}`,
            command: "pebble.goTo",
            arguments: [pathToFileURL(parent.filePath).toString(), top],
          },
        })
      }
    }
    return out
  }

  inlayHints(doc: TextDocument, analysis: Analysis, start: number, end: number): InlayHint[] {
    return coreInlayHints(analysis, start, end).map((h) => ({
      position: doc.positionAt(h.offset),
      label: h.label,
      paddingLeft: false,
    }))
  }

  async documentLinks(
    doc: TextDocument,
    filePath: string | undefined,
    analysis: Analysis,
    settings: TemplateSettings,
  ): Promise<DocumentLink[]> {
    const resolve = this.index.resolver(settings)
    const out: DocumentLink[] = []
    for (const link of coreDocumentLinks(analysis)) {
      const target = await resolve(link.templateName, filePath)
      out.push({
        range: toLspRange(doc, link.range),
        target: target ? pathToFileURL(target).toString() : undefined,
        tooltip: target ? "Open template" : "Template not found",
      })
    }
    return out
  }

  async workspaceSymbols(
    query: string,
    settings: TemplateSettings,
    customTags: string[],
  ): Promise<SymbolInformation[]> {
    const q = query.toLowerCase()
    const out: SymbolInformation[] = []
    for (const filePath of await this.index.allFiles(settings)) {
      const analysis = await this.index.analysisOf(filePath, customTags)
      if (!analysis) continue
      const d = docFor(filePath, analysis)
      const container = this.index.displayName(filePath, settings)
      for (const b of analysis.model.blocks) {
        if (b.name.toLowerCase().includes(q))
          out.push({
            name: b.name,
            kind: SymbolKind.Namespace,
            containerName: container,
            location: { uri: d.uri, range: toLspRange(d, b.nameRange) },
          })
      }
      for (const m of analysis.model.macros) {
        if (m.name.toLowerCase().includes(q))
          out.push({
            name: `${m.name}(${m.params.join(", ")})`,
            kind: SymbolKind.Function,
            containerName: container,
            location: { uri: d.uri, range: toLspRange(d, m.nameRange) },
          })
      }
      if (out.length > 500) break
    }
    return out
  }
}

export { symbolAt }

function dedupe(locations: Location[]): Location[] {
  const seen = new Set<string>()
  return locations.filter((l) => {
    const key = `${l.uri}:${l.range.start.line}:${l.range.start.character}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
