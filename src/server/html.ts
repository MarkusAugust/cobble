import {
  getLanguageService,
  type HTMLDocument,
  type LanguageService,
} from "vscode-html-languageservice"
import type {
  CompletionList,
  DocumentSymbol,
  FoldingRange,
  Hover,
  Position,
} from "vscode-languageserver/node"
import { TextDocument } from "vscode-languageserver-textdocument"
import { maskPebble, type Region, regionAt } from "../core"

/**
 * Delegates HTML features to vscode-html-languageservice for `pebble` documents. Pebble regions
 * are masked with spaces so the HTML parser sees plain markup with identical offsets.
 */
export class HtmlDelegate {
  private readonly service: LanguageService = getLanguageService()
  private cache: { uri: string; version: number; doc: TextDocument; html: HTMLDocument } | undefined

  private masked(
    document: TextDocument,
    regions: Region[],
  ): { doc: TextDocument; html: HTMLDocument } {
    if (this.cache && this.cache.uri === document.uri && this.cache.version === document.version)
      return this.cache
    const doc = TextDocument.create(
      document.uri,
      "html",
      document.version,
      maskPebble(document.getText(), regions),
    )
    const html = this.service.parseHTMLDocument(doc)
    this.cache = { uri: document.uri, version: document.version, doc, html }
    return this.cache
  }

  /** True when the position is inside a Pebble region (where HTML features must stay quiet). */
  static insidePebble(regions: Region[], offset: number): boolean {
    return regionAt(regions, offset) !== null
  }

  complete(document: TextDocument, position: Position, regions: Region[]): CompletionList {
    const { doc, html } = this.masked(document, regions)
    return this.service.doComplete(doc, position, html)
  }

  hover(document: TextDocument, position: Position, regions: Region[]): Hover | null {
    const { doc, html } = this.masked(document, regions)
    return this.service.doHover(doc, position, html)
  }

  foldingRanges(document: TextDocument, regions: Region[]): FoldingRange[] {
    const { doc } = this.masked(document, regions)
    return this.service.getFoldingRanges(doc)
  }

  symbols(document: TextDocument, regions: Region[]): DocumentSymbol[] {
    const { doc, html } = this.masked(document, regions)
    return this.service.findDocumentSymbols2(doc, html)
  }
}
