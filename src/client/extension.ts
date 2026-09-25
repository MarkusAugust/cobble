import * as path from "node:path"
import * as vscode from "vscode"
import {
  LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
  TransportKind,
} from "vscode-languageclient/node"
import { enableDatastarSupport, registerDatastarPrompt } from "./datastar"

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
    synchronize: { fileEvents: vscode.workspace.createFileSystemWatcher("**/*.{peb,pebble,html}") },
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
  )
  registerDatastarPrompt(context)
}

export async function deactivate(): Promise<void> {
  if (client) {
    await client.stop()
    client = undefined
  }
}
