import { fileURLToPath, pathToFileURL } from "node:url"
import {
  type CodeAction,
  CodeActionKind,
  type CompletionItem,
  type CompletionList,
  CreateFile,
  createConnection,
  DidChangeConfigurationNotification,
  type InitializeResult,
  type LinkedEditingRanges,
  type LocationLink,
  type Definition as LspDefinition,
  type DocumentSymbol as LspDocumentSymbol,
  type FoldingRange as LspFoldingRange,
  type Hover as LspHover,
  MarkupKind,
  ProposedFeatures,
  type SignatureHelp,
  TextDocumentSyncKind,
  TextDocuments,
  TextEdit,
  type WorkspaceEdit,
} from "vscode-languageserver/node"
import { TextDocument } from "vscode-languageserver-textdocument"
import {
  type Analysis,
  analyze,
  autoCloseTag,
  buildSpec,
  completionContext,
  completionsFor,
  codeActions as coreCodeActions,
  diagnostics as coreDiagnostics,
  hover as coreHover,
  signatureHelp as coreSignatureHelp,
  definition,
  documentSymbols,
  foldingRanges,
  hasPebble,
  linkedEditingRanges,
  listTemplates,
  resolveTemplate,
  type Spec,
  type TemplateSettings,
  templateCandidates,
} from "../core"
import { toLspCompletion, toLspDiagnostic, toLspRange, toLspSymbol } from "./convert"
import { NodeTemplateFileSystem } from "./fs"
import { HtmlDelegate } from "./html"
import { defaultSettings, mergeSettings, type PebbleSettings } from "./settings"
import { TemplateIndex } from "./templates"
import { symbolAt, WorkspaceFeatures } from "./workspace-features"

const connection = createConnection(ProposedFeatures.all)
const documents = new TextDocuments(TextDocument)
const fs = new NodeTemplateFileSystem()
const html = new HtmlDelegate()
const index = new TemplateIndex(fs, documents)
const workspaceFeatures = new WorkspaceFeatures(index)

let hasConfigurationCapability = false
const settingsCache = new Map<string, Promise<PebbleSettings>>()
const analysisCache = new Map<string, { version: number; analysis: Analysis; spec: Spec }>()
const specCache = new Map<string, Spec>()
const pendingValidation = new Map<string, ReturnType<typeof setTimeout>>()

connection.onInitialize((params): InitializeResult => {
  hasConfigurationCapability = !!params.capabilities.workspace?.configuration
  fs.setWorkspaceFolders((params.workspaceFolders ?? []).map((f) => f.uri))
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        triggerCharacters: ["{", "%", "|", ".", '"', "'", "(", "<", "/"],
        resolveProvider: false,
      },
      hoverProvider: true,
      signatureHelpProvider: { triggerCharacters: ["(", ","] },
      definitionProvider: true,
      documentSymbolProvider: true,
      foldingRangeProvider: true,
      linkedEditingRangeProvider: true,
      codeActionProvider: { codeActionKinds: [CodeActionKind.QuickFix] },
      referencesProvider: true,
      renameProvider: { prepareProvider: true },
      codeLensProvider: { resolveProvider: false },
      inlayHintProvider: true,
      documentLinkProvider: { resolveProvider: false },
      workspaceSymbolProvider: true,
      workspace: { workspaceFolders: { supported: true, changeNotifications: true } },
    },
  }
})

connection.onInitialized(() => {
  if (hasConfigurationCapability)
    connection.client.register(DidChangeConfigurationNotification.type, undefined)
  connection.workspace.onDidChangeWorkspaceFolders(async () => {
    const folders = await connection.workspace.getWorkspaceFolders()
    fs.setWorkspaceFolders((folders ?? []).map((f) => f.uri))
    fs.invalidate()
  })
  connection.console.log("Pebble language server ready")
})

connection.onDidChangeConfiguration(() => {
  settingsCache.clear()
  analysisCache.clear()
  specCache.clear()
  for (const doc of documents.all()) scheduleValidation(doc)
})

connection.onDidChangeWatchedFiles((params) => {
  fs.invalidate()
  index.invalidate(params.changes.map((c) => filePathOf(c.uri)).filter((p): p is string => !!p))
  for (const doc of documents.all()) scheduleValidation(doc)
})

// ----- settings & analysis -----

function getSettings(uri: string): Promise<PebbleSettings> {
  if (!hasConfigurationCapability) return Promise.resolve(defaultSettings)
  let cached = settingsCache.get(uri)
  if (!cached) {
    cached = connection.workspace
      .getConfiguration({ scopeUri: uri, section: "pebble" })
      .then((value) => mergeSettings(value))
      .catch(() => defaultSettings)
    settingsCache.set(uri, cached)
  }
  return cached
}

function specFor(settings: PebbleSettings): Spec {
  const key = JSON.stringify([
    settings.spring,
    settings.customFilters,
    settings.customFunctions,
    settings.customTests,
    settings.customTags,
  ])
  let spec = specCache.get(key)
  if (!spec) {
    spec = buildSpec({
      spring: settings.spring.enabled,
      customFilters: settings.customFilters,
      customFunctions: settings.customFunctions,
      customTests: settings.customTests,
      customTags: settings.customTags,
    })
    specCache.set(key, spec)
  }
  return spec
}

/** Whether Pebble features should run for this document at all. */
function isActive(doc: TextDocument, settings: PebbleSettings): boolean {
  if (doc.languageId === "pebble") return true
  return doc.languageId === "html" && settings.html.enabled
}

async function getAnalysis(
  doc: TextDocument,
): Promise<{ analysis: Analysis; spec: Spec; settings: PebbleSettings } | null> {
  const settings = await getSettings(doc.uri)
  if (!isActive(doc, settings)) return null
  const spec = specFor(settings)
  const cached = analysisCache.get(doc.uri)
  if (cached && cached.version === doc.version && cached.spec === spec)
    return { ...cached, settings }
  const analysis = analyze(doc.getText(), { customTags: settings.customTags })
  analysisCache.set(doc.uri, { version: doc.version, analysis, spec })
  return { analysis, spec, settings }
}

const templateSettings = (s: PebbleSettings): TemplateSettings => ({
  templateRoots: s.templateRoots,
  templateSuffixes: s.templateSuffixes,
})
const filePathOf = (uri: string): string | undefined =>
  uri.startsWith("file:") ? fileURLToPath(uri) : undefined

// ----- diagnostics -----

documents.onDidChangeContent((e) => scheduleValidation(e.document))
documents.onDidClose((e) => {
  analysisCache.delete(e.document.uri)
  index.invalidateDocument(e.document.uri)
  settingsCache.delete(e.document.uri)
  connection.sendDiagnostics({ uri: e.document.uri, diagnostics: [] })
})

function scheduleValidation(doc: TextDocument) {
  const existing = pendingValidation.get(doc.uri)
  if (existing) clearTimeout(existing)
  pendingValidation.set(
    doc.uri,
    setTimeout(() => {
      pendingValidation.delete(doc.uri)
      validate(doc).catch((err) => connection.console.error(`validation failed: ${err}`))
    }, 150),
  )
}

async function validate(doc: TextDocument) {
  const result = await getAnalysis(doc)
  if (
    !result ||
    !result.settings.diagnostics.enabled ||
    (doc.languageId === "html" && !hasPebble(doc.getText()))
  ) {
    connection.sendDiagnostics({ uri: doc.uri, diagnostics: [] })
    return
  }
  const { analysis, spec, settings } = result
  const resolved = new Map<string, boolean>()
  const fromFile = filePathOf(doc.uri)
  for (const ref of analysis.model.references) {
    if (ref.literalName && !resolved.has(ref.literalName)) {
      resolved.set(
        ref.literalName,
        (await resolveTemplate(ref.literalName, fromFile, templateSettings(settings), fs)) !== null,
      )
    }
  }
  const all = coreDiagnostics(analysis, spec, {
    settings: settings.diagnostics,
    templateExists: (name) =>
      fs.workspaceFolders.length > 0 || fromFile ? resolved.get(name) : undefined,
  })
  connection.sendDiagnostics({ uri: doc.uri, diagnostics: all.map((d) => toLspDiagnostic(doc, d)) })
}

// ----- features -----

connection.onCompletion(async (params): Promise<CompletionList | CompletionItem[]> => {
  const doc = documents.get(params.textDocument.uri)
  if (!doc) return []
  const result = await getAnalysis(doc)
  if (!result) return []
  const { analysis, spec, settings } = result
  const offset = doc.offsetAt(params.position)
  const ctx = completionContext(analysis, offset)
  if (ctx.kind === "outside") {
    if (
      doc.languageId === "pebble" &&
      settings.html.delegate &&
      !HtmlDelegate.insidePebble(analysis.regions, offset)
    ) {
      return html.complete(doc, params.position, analysis.regions)
    }
    return []
  }
  const fromFile = filePathOf(doc.uri)
  const ts = templateSettings(settings)
  const templateNames =
    ctx.kind === "templateName"
      ? (await listTemplates(fromFile, ts, fs)).map((t) => t.name)
      : undefined
  const importedMacros = new Map<string, string[]>()
  if (ctx.kind === "member" || ctx.kind === "macroName") {
    const names =
      ctx.kind === "macroName"
        ? ctx.template
          ? [ctx.template]
          : []
        : analysis.model.imports.map((i) => i.ref.literalName).filter((n): n is string => !!n)
    for (const name of names) {
      const macros = await macrosOf(name, fromFile, ts)
      if (macros) importedMacros.set(name, macros)
    }
  }
  const inheritedBlocks =
    ctx.kind === "blockName" && !ctx.isEnd
      ? (await index.graph(ts, settings.customTags).inheritedBlocks(fromFile, analysis)).map(
          (b) => ({
            name: b.name,
            from: index.displayName(b.from.filePath, ts),
          }),
        )
      : undefined
  const items = completionsFor(ctx, analysis, offset, spec, {
    templateNames,
    importedMacros: (n) => importedMacros.get(n),
    inheritedBlocks,
  })
  return { isIncomplete: false, items: items.map((i) => toLspCompletion(doc, i)) }
})

async function macrosOf(
  templateName: string,
  fromFile: string | undefined,
  ts: TemplateSettings,
): Promise<string[] | undefined> {
  const file = await resolveTemplate(templateName, fromFile, ts, fs)
  if (!file) return undefined
  const text = await fs.readText(file)
  if (text === null) return undefined
  return analyze(text).model.macros.map((m) => m.name)
}

connection.onHover(async (params): Promise<LspHover | null> => {
  const doc = documents.get(params.textDocument.uri)
  if (!doc) return null
  const result = await getAnalysis(doc)
  if (!result) return null
  const { analysis, spec, settings } = result
  const offset = doc.offsetAt(params.position)
  const fromFile = filePathOf(doc.uri)
  const resolvedRefs = new Map<string, string | null>()
  for (const ref of analysis.model.references) {
    if (ref.literalName && offset >= ref.range.start && offset <= ref.range.end) {
      resolvedRefs.set(
        ref.literalName,
        await resolveTemplate(ref.literalName, fromFile, templateSettings(settings), fs),
      )
    }
  }
  const h = coreHover(analysis, offset, spec, { resolveTemplate: (n) => resolvedRefs.get(n) })
  if (h) {
    let value = h.markdown
    const resolvedPath = [...resolvedRefs.values()].find((p) => p)
    if (value.startsWith("Template `") && resolvedPath) {
      const target = await index.analysisOf(resolvedPath, settings.customTags)
      if (target) {
        const blocks = target.model.blocks.map((b) => `\`${b.name}\``)
        const macros = target.model.macros.map((m) => `\`${m.name}(${m.params.join(", ")})\``)
        if (blocks.length > 0) value += `\n\nBlocks: ${blocks.join(", ")}`
        if (macros.length > 0) value += `\n\nMacros: ${macros.join(", ")}`
        if (target.model.extends?.literalName)
          value += `\n\nExtends \`${target.model.extends.literalName}\``
      }
    }
    return { contents: { kind: MarkupKind.Markdown, value }, range: toLspRange(doc, h.range) }
  }
  if (
    doc.languageId === "pebble" &&
    settings.html.delegate &&
    !HtmlDelegate.insidePebble(analysis.regions, offset)
  ) {
    return html.hover(doc, params.position, analysis.regions)
  }
  return null
})

connection.onSignatureHelp(async (params): Promise<SignatureHelp | null> => {
  const doc = documents.get(params.textDocument.uri)
  if (!doc) return null
  const result = await getAnalysis(doc)
  if (!result) return null
  const s = coreSignatureHelp(result.analysis, doc.offsetAt(params.position), result.spec)
  if (!s) return null
  return {
    signatures: [
      {
        label: s.label,
        documentation: s.documentation
          ? { kind: MarkupKind.Markdown, value: s.documentation }
          : undefined,
        parameters: s.parameters.map((p) => ({ label: p.label, documentation: p.documentation })),
      },
    ],
    activeSignature: 0,
    activeParameter: s.activeParameter,
  }
})

connection.onDocumentSymbol(async (params): Promise<LspDocumentSymbol[]> => {
  const doc = documents.get(params.textDocument.uri)
  if (!doc) return []
  const result = await getAnalysis(doc)
  if (!result) return []
  const ours = documentSymbols(result.analysis).map((s) => toLspSymbol(doc, s))
  if (doc.languageId === "pebble" && result.settings.html.delegate) {
    return [...ours, ...html.symbols(doc, result.analysis.regions)]
  }
  return ours
})

connection.onFoldingRanges(async (params): Promise<LspFoldingRange[]> => {
  const doc = documents.get(params.textDocument.uri)
  if (!doc) return []
  const result = await getAnalysis(doc)
  if (!result) return []
  const ours: LspFoldingRange[] = []
  for (const r of foldingRanges(result.analysis)) {
    const start = doc.positionAt(r.start).line
    const end = doc.positionAt(r.end).line
    if (end > start) ours.push({ startLine: start, endLine: end, kind: r.kind })
  }
  if (doc.languageId === "pebble" && result.settings.html.delegate) {
    return [...ours, ...html.foldingRanges(doc, result.analysis.regions)]
  }
  return ours
})

connection.onDefinition(async (params): Promise<LspDefinition | LocationLink[] | null> => {
  const doc = documents.get(params.textDocument.uri)
  if (!doc) return null
  const result = await getAnalysis(doc)
  if (!result) return null
  const { analysis, settings } = result
  const target = definition(analysis, doc.offsetAt(params.position))
  if (!target) return null
  const fromFile = filePathOf(doc.uri)
  const ts = templateSettings(settings)
  const origin = toLspRange(doc, target.originRange)
  const zero = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }

  switch (target.kind) {
    case "template": {
      const file = await resolveTemplate(target.name, fromFile, ts, fs)
      if (!file) return null
      return [
        {
          originSelectionRange: origin,
          targetUri: pathToFileURL(file).toString(),
          targetRange: zero,
          targetSelectionRange: zero,
        },
      ]
    }
    case "variable":
      return [
        {
          originSelectionRange: origin,
          targetUri: doc.uri,
          targetRange: toLspRange(doc, target.localRange),
          targetSelectionRange: toLspRange(doc, target.localSelectionRange),
        },
      ]
    case "macro": {
      if (target.localRange && target.localSelectionRange) {
        return [
          {
            originSelectionRange: origin,
            targetUri: doc.uri,
            targetRange: toLspRange(doc, target.localRange),
            targetSelectionRange: toLspRange(doc, target.localSelectionRange),
          },
        ]
      }
      if (!target.template) return null
      const file = await resolveTemplate(target.template, fromFile, ts, fs)
      if (!file) return null
      const text = await fs.readText(file)
      if (text === null) return null
      const other = TextDocument.create(pathToFileURL(file).toString(), "pebble", 0, text)
      const macro = analyze(text).model.macros.find((m) => m.name === target.name)
      if (!macro)
        return [
          {
            originSelectionRange: origin,
            targetUri: other.uri,
            targetRange: zero,
            targetSelectionRange: zero,
          },
        ]
      return [
        {
          originSelectionRange: origin,
          targetUri: other.uri,
          targetRange: toLspRange(other, macro.node.range),
          targetSelectionRange: toLspRange(other, macro.nameRange),
        },
      ]
    }
    case "block": {
      if (!target.parentOnly && target.localRange && target.localSelectionRange) {
        return [
          {
            originSelectionRange: origin,
            targetUri: doc.uri,
            targetRange: toLspRange(doc, target.localRange),
            targetSelectionRange: toLspRange(doc, target.localSelectionRange),
          },
        ]
      }
      // Walk the extends chain looking for a block with this name.
      let current = { analysis, file: fromFile }
      for (let depth = 0; depth < 10; depth++) {
        const parentName = current.analysis.model.extends?.literalName
        if (!parentName) return null
        const file = await resolveTemplate(parentName, current.file, ts, fs)
        if (!file) return null
        const text = await fs.readText(file)
        if (text === null) return null
        const parentAnalysis = analyze(text)
        const block = parentAnalysis.model.blocks.find((b) => b.name === target.name)
        if (block) {
          const other = TextDocument.create(pathToFileURL(file).toString(), "pebble", 0, text)
          return [
            {
              originSelectionRange: origin,
              targetUri: other.uri,
              targetRange: toLspRange(other, block.node.range),
              targetSelectionRange: toLspRange(other, block.nameRange),
            },
          ]
        }
        current = { analysis: parentAnalysis, file }
      }
      return null
    }
  }
})

// ----- auto close, linked editing, quick fixes -----

connection.onRequest(
  "pebble/autoClose",
  async (params: {
    textDocument: { uri: string }
    position: { line: number; character: number }
  }) => {
    const doc = documents.get(params.textDocument.uri)
    if (!doc) return null
    const result = await getAnalysis(doc)
    if (!result) return null
    return autoCloseTag(result.analysis, doc.offsetAt(params.position))
  },
)

connection.languages.onLinkedEditingRange(async (params): Promise<LinkedEditingRanges | null> => {
  const doc = documents.get(params.textDocument.uri)
  if (!doc) return null
  const result = await getAnalysis(doc)
  if (!result) return null
  const ranges = linkedEditingRanges(result.analysis, doc.offsetAt(params.position))
  if (!ranges) return null
  return { ranges: ranges.map((r) => toLspRange(doc, r)), wordPattern: "[\\p{L}_][\\p{L}\\p{N}_]*" }
})

connection.onCodeAction(async (params): Promise<CodeAction[]> => {
  const doc = documents.get(params.textDocument.uri)
  if (!doc) return []
  const result = await getAnalysis(doc)
  if (!result) return []
  const { analysis, settings } = result
  const start = doc.offsetAt(params.range.start)
  const end = doc.offsetAt(params.range.end)
  const relevant = params.context.diagnostics.filter((d) => d.source === "pebble")
  const coreDiags = relevant.map((d) => ({
    code: String(d.code) as import("../core").DiagnosticCode,
    message: typeof d.message === "string" ? d.message : d.message.value,
    start: doc.offsetAt(d.range.start),
    end: doc.offsetAt(d.range.end),
    severity: "error" as const,
  }))
  const inRange = coreDiags.filter((d) => d.end >= start && d.start <= end)
  const out: CodeAction[] = []
  for (const action of coreCodeActions(analysis, inRange)) {
    const lspDiag = relevant[coreDiags.findIndex((d) => d === action.diagnostic)]
    const base = { kind: CodeActionKind.QuickFix, diagnostics: lspDiag ? [lspDiag] : [] }
    if (action.kind === "edit") {
      const edit: WorkspaceEdit = {
        changes: {
          [doc.uri]: action.edits.map((e) => TextEdit.replace(toLspRange(doc, e), e.newText)),
        },
      }
      out.push({ ...base, title: action.title, edit })
    } else if (action.kind === "createFile") {
      const candidates = templateCandidates(
        action.templateName,
        filePathOf(doc.uri),
        templateSettings(settings),
        fs.workspaceFolders,
      )
      const target = candidates.find((c) => /\.[A-Za-z0-9]+$/.test(c)) ?? candidates[0]
      if (!target) continue
      const uri = pathToFileURL(target).toString()
      out.push({
        ...base,
        title: action.title,
        edit: { documentChanges: [CreateFile.create(uri, { ignoreIfExists: true })] },
      })
    } else {
      out.push({
        ...base,
        title: action.title,
        command: {
          title: action.title,
          command: "pebble.addCustomEntry",
          arguments: [action.entryKind, action.name],
        },
      })
    }
  }
  return out
})

// ----- workspace features -----

connection.onReferences(async (params) => {
  const doc = documents.get(params.textDocument.uri)
  if (!doc) return []
  const result = await getAnalysis(doc)
  if (!result) return []
  const symbol = symbolAt(result.analysis, doc.offsetAt(params.position))
  if (!symbol) return []
  return workspaceFeatures.references(
    doc,
    filePathOf(doc.uri),
    result.analysis,
    symbol,
    templateSettings(result.settings),
    result.settings.customTags,
  )
})

connection.onPrepareRename(async (params) => {
  const doc = documents.get(params.textDocument.uri)
  if (!doc) return null
  const result = await getAnalysis(doc)
  if (!result) return null
  const symbol = symbolAt(result.analysis, doc.offsetAt(params.position))
  if (!symbol) return null
  return {
    range: toLspRange(doc, symbol.range),
    placeholder: symbol.kind === "macro" ? symbol.name : doc.getText(toLspRange(doc, symbol.range)),
  }
})

connection.onRenameRequest(async (params) => {
  const doc = documents.get(params.textDocument.uri)
  if (!doc) return null
  const result = await getAnalysis(doc)
  if (!result) return null
  const symbol = symbolAt(result.analysis, doc.offsetAt(params.position))
  if (!symbol) return null
  if (!/^[\p{L}_][\p{L}\p{N}_]*$/u.test(params.newName))
    throw new Error("Not a valid Pebble identifier")
  return workspaceFeatures.rename(
    doc,
    filePathOf(doc.uri),
    result.analysis,
    symbol,
    params.newName,
    templateSettings(result.settings),
    result.settings.customTags,
  )
})

connection.onCodeLens(async (params) => {
  const doc = documents.get(params.textDocument.uri)
  if (!doc) return []
  const result = await getAnalysis(doc)
  if (!result || !result.settings.codeLens.enabled) return []
  if (doc.languageId === "html" && !hasPebble(doc.getText())) return []
  return workspaceFeatures.codeLenses(
    doc,
    filePathOf(doc.uri),
    result.analysis,
    templateSettings(result.settings),
    result.settings.customTags,
  )
})

connection.languages.inlayHint.on(async (params) => {
  const doc = documents.get(params.textDocument.uri)
  if (!doc) return []
  const result = await getAnalysis(doc)
  if (!result || !result.settings.inlayHints.enabled) return []
  return workspaceFeatures.inlayHints(
    doc,
    result.analysis,
    doc.offsetAt(params.range.start),
    doc.offsetAt(params.range.end),
  )
})

connection.onDocumentLinks(async (params) => {
  const doc = documents.get(params.textDocument.uri)
  if (!doc) return []
  const result = await getAnalysis(doc)
  if (!result) return []
  return workspaceFeatures.documentLinks(
    doc,
    filePathOf(doc.uri),
    result.analysis,
    templateSettings(result.settings),
  )
})

connection.onWorkspaceSymbol(async (params) => {
  const settings = await getSettings(documents.all()[0]?.uri ?? "")
  return workspaceFeatures.workspaceSymbols(
    params.query,
    templateSettings(settings),
    settings.customTags,
  )
})

documents.listen(connection)
connection.listen()
