import * as path from "node:path"
import * as vscode from "vscode"
import {
  LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
  TransportKind,
} from "vscode-languageclient/node"

let client: LanguageClient | undefined

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel("Pebble", { log: true })
  context.subscriptions.push(output)

  const serverModule = context.asAbsolutePath(path.join("dist", "server.js"))
  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: { execArgv: ["--nolazy", "--inspect=6009"] },
    },
  }

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: "file", language: "pebble" },
      { scheme: "untitled", language: "pebble" },
      { scheme: "file", language: "html" },
    ],
    outputChannel: output,
  }

  client = new LanguageClient("pebble", "Pebble Language Server", serverOptions, clientOptions)
  await client.start()
  output.appendLine("Pebble language server started")
}

export async function deactivate(): Promise<void> {
  if (client) {
    await client.stop()
    client = undefined
  }
}
