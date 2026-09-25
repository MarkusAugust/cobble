import * as assert from "node:assert/strict"
import * as vscode from "vscode"
import {
  after,
  completionsAt,
  definitionAt,
  hoverAt,
  label,
  open,
  openUntitled,
  ours,
  pebbleDiagnostics,
  sleep,
  waitFor,
} from "./helpers"

const detailOf = (item: vscode.CompletionItem) =>
  typeof item.detail === "string" ? item.detail : ""

describe("java and kotlin awareness", () => {
  it("completes model attributes with their types and bean properties", async () => {
    const doc = await open("pages/typed.peb")
    const untyped = await openUntitled("pebble", "{{ ")
    void untyped
    await vscode.window.showTextDocument(doc)
    const position = after(doc, "<h1>{{ ")
    const items = await waitFor(
      () => completionsAt(doc, position),
      () => true,
    )
    let list = await items
    for (let i = 0; i < 20 && !list.some((it) => label(it) === "user"); i++) {
      await sleep(250)
      list = await completionsAt(doc, position)
    }
    const user = list.find((it) => label(it) === "user")
    assert.ok(user, `expected 'user' in ${list.map(label).join(",")}`)
    assert.equal(detailOf(user), "User")
    const items2 = list.find((it) => label(it) === "items")
    assert.equal(detailOf(items2 as vscode.CompletionItem), "List<String>")

    const props = ours(await completionsAt(doc, after(doc, "<h1>{{ user."))).map(label)
    assert.deepEqual(props.sort(), ["address", "email", "name"])
    const nested = ours(await completionsAt(doc, after(doc, "user.address."))).map(label)
    assert.deepEqual(nested.sort(), ["city", "zip"])
  })

  it("shows types on hover and jumps into the Java sources", async () => {
    const doc = await open("pages/typed.peb")
    const hover = await hoverAt(doc, after(doc, "<h1>{{ us"))
    assert.match(hover, /User user/)
    assert.match(hover, /PageController\.typed/)
    const propertyHover = await hoverAt(doc, after(doc, "user.address.ci"))
    assert.match(propertyHover, /String city/)

    const toController = await definitionAt(doc, after(doc, "<h1>{{ us"))
    assert.ok(
      toController[0]?.targetUri.path.endsWith("PageController.java"),
      "variable should jump to the controller",
    )
    const toGetter = await definitionAt(doc, after(doc, "<h1>{{ user.na"))
    assert.ok(toGetter[0]?.targetUri.path.endsWith("User.java"), "property should jump to the bean")
  })

  it("discovers filters declared in Java and stops reporting them as unknown", async () => {
    const doc = await open("pages/typed.peb")
    await sleep(800)
    assert.deepEqual(
      pebbleDiagnostics(doc.uri).map((d) => d.code),
      [],
    )
    const items = ours(await completionsAt(doc, after(doc, "{{ price | ")))
    const money = items.find((it) => label(it) === "money")
    assert.ok(money, "money filter from MoneyFilter.java should be offered")
    const insert = money?.insertText
    assert.ok(insert && typeof insert !== "string" && insert.value.includes("${1:currency}"))
  })

  it("understands ktor routes in kotlin", async () => {
    const doc = await open("pages/ktor.peb")
    const props = ours(await completionsAt(doc, after(doc, "{{ product."))).map(label)
    assert.deepEqual(props.sort(), ["name", "price"])
  })

  it("provides semantic tokens", async () => {
    const doc = await open("templates/child.peb")
    const tokens = await waitFor(
      () =>
        vscode.commands.executeCommand<vscode.SemanticTokens>(
          "vscode.provideDocumentSemanticTokens",
          doc.uri,
        ),
      () => true,
    )
    const result = await tokens
    assert.ok(result && result.data.length > 0, "semantic tokens expected")
  })
})
