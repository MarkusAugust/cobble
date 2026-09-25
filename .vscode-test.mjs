import { defineConfig } from "@vscode/test-cli"

const workspaceFolder = "test/e2e/fixtures/workspace"
const mocha = { ui: "bdd", timeout: 30000 }

export default defineConfig([
  {
    label: "standard",
    files: "out/test/e2e/*.test.js",
    workspaceFolder,
    mocha,
    launchArgs: ["--disable-extensions"],
  },
  {
    label: "datastar",
    files: "out/test/e2e/datastar/*.test.js",
    workspaceFolder,
    mocha,
    installExtensions: ["starfederation.datastar-vscode"],
  },
])
