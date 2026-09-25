import {
  createConnection,
  type InitializeResult,
  ProposedFeatures,
  TextDocumentSyncKind,
  TextDocuments,
} from "vscode-languageserver/node"
import { TextDocument } from "vscode-languageserver-textdocument"

const connection = createConnection(ProposedFeatures.all)
const documents = new TextDocuments(TextDocument)

connection.onInitialize((): InitializeResult => {
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
    },
  }
})

connection.onInitialized(() => {
  connection.console.log("Pebble language server initialized (no features registered yet)")
})

documents.listen(connection)
connection.listen()
