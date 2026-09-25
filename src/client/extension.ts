import * as path from "node:path"
import * as vscode from "vscode"
import {
  LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
  TransportKind,
} from "vscode-languageclient/node"
import { registerAutoClose } from "./autoclose"
import { enableDatastarSupport, registerDatastarPrompt } from "./datastar"
import { addCustomEntry } from "./settings"

let client: LanguageClient | undefined

function createClient(
  context: vscode.ExtensionContext,
  output: vscode.LogOutputChannel,
): LanguageClient {
  const serverModule = context.asAbsolutePath(path.join("dist", "server.js"))
  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: { execArgv: ["--nolazy", "--inspect=6009"] },
    },
  }
  const htmlEnabled = vscode.workspace.getConfiguration("pebble").get<boolean>("html.enabled", true)
  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: "file", language: "pebble" },
      { scheme: "untitled", language: "pebble" },
      ...(htmlEnabled ? [{ scheme: "file", language: "html" }] : []),
    ],
    synchronize: {
      fileEvents: vscode.workspace.createFileSystemWatcher("**/*.{peb,pebble,html,java,kt}"),
    },
    outputChannel: output,
    traceOutputChannel: output,
  }
  return new LanguageClient("pebble", "Pebble Language Server", serverOptions, clientOptions)
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel("Pebble", { log: true })
  context.subscriptions.push(output)

  client = createClient(context, output)
  await client.start()
  output.info("Pebble language server started")

  context.subscriptions.push(
    vscode.commands.registerCommand("pebble.restartServer", async () => {
      await client?.stop()
      client = createClient(context, output)
      await client.start()
      output.info("Pebble language server restarted")
    }),
    vscode.commands.registerCommand("pebble.enableDatastarSupport", enableDatastarSupport),
    vscode.commands.registerCommand("pebble.addCustomEntry", addCustomEntry),
    vscode.commands.registerCommand("pebble.showLocations", showLocations),
    vscode.commands.registerCommand("pebble.goTo", goTo),
  )
  registerDatastarPrompt(context)
  registerAutoClose(context, () => client)
}

interface LspRange {
  start: { line: number; character: number }
  end: { line: number; character: number }
}
const toRange = (r: LspRange) =>
  new vscode.Range(r.start.line, r.start.character, r.end.line, r.end.character)

async function showLocations(
  uri: string,
  position: LspRange["start"],
  locations: { uri: string; range: LspRange }[],
) {
  await vscode.commands.executeCommand(
    "editor.action.showReferences",
    vscode.Uri.parse(uri),
    new vscode.Position(position.line, position.character),
    locations.map((l) => new vscode.Location(vscode.Uri.parse(l.uri), toRange(l.range))),
  )
}

async function goTo(uri: string, range: LspRange) {
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(uri))
  await vscode.window.showTextDocument(doc, { selection: toRange(range) })
}

export async function deactivate(): Promise<void> {
  if (client) {
    await client.stop()
    client = undefined
  }
}
