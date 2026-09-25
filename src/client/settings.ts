import * as vscode from "vscode"

const sections = {
  filter: "customFilters",
  function: "customFunctions",
  test: "customTests",
  tag: "customTags",
} as const

/** Appends a custom filter/function/test/tag declaration to the workspace settings. */
export async function addCustomEntry(kind: keyof typeof sections, name: string): Promise<void> {
  const section = sections[kind]
  const config = vscode.workspace.getConfiguration("pebble")
  const info = config.inspect<unknown[]>(section)
  const target = info?.workspaceFolderValue
    ? vscode.ConfigurationTarget.WorkspaceFolder
    : vscode.workspace.workspaceFolders?.length
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global
  const current = (info?.workspaceFolderValue ??
    info?.workspaceValue ??
    info?.globalValue ??
    []) as unknown[]
  const exists = current.some((e) =>
    typeof e === "string" ? e === name : (e as { name?: string })?.name === name,
  )
  if (exists) return
  const entry = kind === "tag" ? name : { name }
  await config.update(section, [...current, entry], target)
  vscode.window.showInformationMessage(`Added '${name}' to pebble.${section}.`)
}
