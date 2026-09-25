import * as assert from "node:assert/strict"
import * as vscode from "vscode"

export const EXTENSION_ID = "MarkusAugust.pebble-support"

export function workspaceUri(): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0]
  assert.ok(folder, "test workspace is not open")
  return folder.uri
}

export const fileUri = (relative: string) => vscode.Uri.joinPath(workspaceUri(), relative)

export async function activate(): Promise<void> {
  const ext = vscode.extensions.getExtension(EXTENSION_ID)
  assert.ok(ext, `extension ${EXTENSION_ID} not found`)
  if (!ext.isActive) await ext.activate()
}

export async function open(relative: string): Promise<vscode.TextDocument> {
  const doc = await vscode.workspace.openTextDocument(fileUri(relative))
  await vscode.window.showTextDocument(doc)
  await activate()
  return doc
}

export async function openUntitled(
  language: "pebble" | "html",
  content: string,
): Promise<vscode.TextDocument> {
  const doc = await vscode.workspace.openTextDocument({ language, content })
  await vscode.window.showTextDocument(doc)
  await activate()
  return doc
}

/** Position right after the first occurrence of `text` (plus `delta` characters). */
export function after(
  doc: vscode.TextDocument,
  text: string,
  delta = 0,
  occurrence = 0,
): vscode.Position {
  const full = doc.getText()
  let index = -1
  for (let i = 0; i <= occurrence; i++) index = full.indexOf(text, index + 1)
  assert.ok(index >= 0, `text not found in document: ${text}`)
  return doc.positionAt(index + text.length + delta)
}

export const label = (item: vscode.CompletionItem) =>
  typeof item.label === "string" ? item.label : item.label.label

export async function completionsAt(
  doc: vscode.TextDocument,
  position: vscode.Position,
): Promise<vscode.CompletionItem[]> {
  const list = await vscode.commands.executeCommand<vscode.CompletionList>(
    "vscode.executeCompletionItemProvider",
    doc.uri,
    position,
  )
  return list?.items ?? []
}

/** Items that come from this extension (they carry a Pebble documentation link or a Pebble sort prefix). */
export function ours(items: vscode.CompletionItem[]): vscode.CompletionItem[] {
  return items.filter((i) => {
    const doc = typeof i.documentation === "string" ? i.documentation : i.documentation?.value
    return (doc?.includes("pebbletemplates.io") ?? false) || /^[0-5]_/.test(i.sortText ?? "")
  })
}

export async function hoverAt(
  doc: vscode.TextDocument,
  position: vscode.Position,
): Promise<string> {
  const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
    "vscode.executeHoverProvider",
    doc.uri,
    position,
  )
  return (hovers ?? [])
    .flatMap((h) => h.contents)
    .map((c) => (typeof c === "string" ? c : c.value))
    .join("\n")
}

export async function definitionAt(
  doc: vscode.TextDocument,
  position: vscode.Position,
): Promise<vscode.LocationLink[]> {
  const result = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
    "vscode.executeDefinitionProvider",
    doc.uri,
    position,
  )
  return (result ?? []).map((r) =>
    "targetUri" in r
      ? r
      : { targetUri: r.uri, targetRange: r.range, targetSelectionRange: r.range },
  )
}

export async function symbolsOf(doc: vscode.TextDocument): Promise<vscode.DocumentSymbol[]> {
  return (
    (await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
      "vscode.executeDocumentSymbolProvider",
      doc.uri,
    )) ?? []
  )
}

export async function foldingOf(doc: vscode.TextDocument): Promise<vscode.FoldingRange[]> {
  return (
    (await vscode.commands.executeCommand<vscode.FoldingRange[]>(
      "vscode.executeFoldingRangeProvider",
      doc.uri,
    )) ?? []
  )
}

export async function signatureAt(
  doc: vscode.TextDocument,
  position: vscode.Position,
): Promise<vscode.SignatureHelp | undefined> {
  return await vscode.commands.executeCommand<vscode.SignatureHelp>(
    "vscode.executeSignatureHelpProvider",
    doc.uri,
    position,
    "(",
  )
}

export async function waitFor<T>(
  produce: () => T,
  ok: (value: T) => boolean,
  timeoutMs = 10000,
): Promise<T> {
  const started = Date.now()
  for (;;) {
    const value = produce()
    if (ok(value)) return value
    if (Date.now() - started > timeoutMs) return value
    await new Promise((r) => setTimeout(r, 100))
  }
}

export const pebbleDiagnostics = (uri: vscode.Uri) =>
  vscode.languages.getDiagnostics(uri).filter((d) => d.source === "pebble")

export async function diagnosticsFor(
  uri: vscode.Uri,
  expectedCount: number,
): Promise<vscode.Diagnostic[]> {
  return waitFor(
    () => pebbleDiagnostics(uri),
    (d) => d.length === expectedCount,
  )
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
