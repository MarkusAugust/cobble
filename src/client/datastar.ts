import * as vscode from "vscode"

export const DATASTAR_EXTENSION_ID = "starfederation.datastar-vscode"
const DISMISSED_KEY = "pebble.datastarPromptDismissed"

/** True when the Datastar extension is installed and `pebble` is not yet in its language list. */
export function datastarNeedsPebble(): boolean {
  if (!vscode.extensions.getExtension(DATASTAR_EXTENSION_ID)) return false
  const languages =
    vscode.workspace.getConfiguration("datastar").get<string[]>("enabledLanguages") ?? []
  return !languages.some((l) => l === "pebble" || l === ".peb" || l === ".pebble")
}

/**
 * Adds `pebble` to `datastar.enabledLanguages` in the scope where the setting is defined
 * (workspace folder, workspace, or user), keeping every existing entry.
 */
export async function enableDatastarSupport(): Promise<void> {
  if (!vscode.extensions.getExtension(DATASTAR_EXTENSION_ID)) {
    const open = "Open in Marketplace"
    const choice = await vscode.window.showInformationMessage(
      "The Datastar extension is not installed.",
      open,
    )
    if (choice === open)
      await vscode.commands.executeCommand("workbench.extensions.search", DATASTAR_EXTENSION_ID)
    return
  }
  const config = vscode.workspace.getConfiguration("datastar")
  const info = config.inspect<string[]>("enabledLanguages")
  let target = vscode.ConfigurationTarget.Global
  let current = info?.globalValue
  if (info?.workspaceFolderValue) {
    target = vscode.ConfigurationTarget.WorkspaceFolder
    current = info.workspaceFolderValue
  } else if (info?.workspaceValue) {
    target = vscode.ConfigurationTarget.Workspace
    current = info.workspaceValue
  }
  const base = current ?? info?.defaultValue ?? []
  if (base.includes("pebble")) {
    vscode.window.showInformationMessage("Datastar support is already enabled for Pebble files.")
    return
  }
  await config.update("enabledLanguages", [...base, "pebble"], target)
  vscode.window.showInformationMessage(
    "Datastar completion, hover and diagnostics are now enabled in Pebble files.",
  )
}

/** Offers to enable Datastar support once, the first time a Pebble document is opened. */
export function registerDatastarPrompt(context: vscode.ExtensionContext): void {
  let asked = false
  const maybeAsk = async (doc: vscode.TextDocument) => {
    if (asked || doc.languageId !== "pebble") return
    if (context.globalState.get<boolean>(DISMISSED_KEY)) return
    if (!datastarNeedsPebble()) return
    asked = true
    const enable = "Enable"
    const never = "Don't ask again"
    const choice = await vscode.window.showInformationMessage(
      "Enable Datastar completion and hover in Pebble (.peb) files?",
      enable,
      "Not now",
      never,
    )
    if (choice === enable) await enableDatastarSupport()
    else if (choice === never) await context.globalState.update(DISMISSED_KEY, true)
  }
  context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(maybeAsk))
  for (const doc of vscode.workspace.textDocuments) void maybeAsk(doc)
}
