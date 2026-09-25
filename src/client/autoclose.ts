import * as vscode from "vscode"
import type { LanguageClient } from "vscode-languageclient/node"

/**
 * Inserts the matching end tag after an opening block tag has been typed, like HTML's auto
 * closing tags. Triggered by typing the `%` or `}` that completes `%}`.
 */
export function registerAutoClose(
  context: vscode.ExtensionContext,
  getClient: () => LanguageClient | undefined,
): void {
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(async (event) => {
      const doc = event.document
      if (doc.languageId !== "pebble" && doc.languageId !== "html") return
      if (!vscode.workspace.getConfiguration("pebble", doc).get<boolean>("autoClosingTags", true))
        return
      const editor = vscode.window.activeTextEditor
      if (!editor || editor.document !== doc || event.contentChanges.length !== 1) return
      const change = event.contentChanges[0]
      if (change.text !== "%" && change.text !== "}") return
      const client = getClient()
      if (!client) return
      // Position right after the `%}` that was just completed.
      const cursor = editor.selection.active
      const text = doc.getText()
      const cursorOffset = doc.offsetAt(cursor)
      let closeEnd: number | undefined
      if (text.slice(cursorOffset - 2, cursorOffset) === "%}") closeEnd = cursorOffset
      else if (text[cursorOffset - 1] === "%" && text[cursorOffset] === "}")
        closeEnd = cursorOffset + 1
      if (closeEnd === undefined) return
      const position = doc.positionAt(closeEnd)
      const endTag = await client.sendRequest<string | null>("pebble/autoClose", {
        textDocument: { uri: doc.uri.toString() },
        position: { line: position.line, character: position.character },
      })
      if (!endTag || editor.document !== doc || doc.version !== event.document.version) return
      await editor.insertSnippet(
        new vscode.SnippetString(`$0${endTag.replace(/[$}\\]/g, "\\$&")}`),
        position,
      )
    }),
  )
}
