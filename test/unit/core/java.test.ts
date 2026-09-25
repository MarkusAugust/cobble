import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { type JavaFile, JavaModel, parseJava, parseType } from "../../../src/core"

const root = join(import.meta.dir, "..", "fixtures", "java")
function loadAll(dir: string, out: JavaFile[] = []): JavaFile[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) loadAll(full, out)
    else if (entry.endsWith(".java")) out.push(parseJava(readFileSync(full, "utf8"), full))
  }
  return out
}
const files = loadAll(root)
const model = new JavaModel(files)
const cls = (name: string) => files.flatMap((f) => f.classes).find((c) => c.name === name)

describe("java parser", () => {
  test("types", () => {
    expect(parseType("List<Item>")).toMatchObject({ name: "List", args: [{ name: "Item" }] })
    expect(parseType("java.util.Map<String, List<Item>>")).toMatchObject({
      name: "Map",
      args: [{ name: "String" }, { name: "List", args: [{ name: "Item" }] }],
    })
    expect(parseType("Item[]")).toMatchObject({ name: "Array", args: [{ name: "Item" }] })
    expect(parseType("final @Nonnull String")).toMatchObject({ name: "String" })
  })

  test("classes, members and annotations", () => {
    const user = cls("User")
    expect(user).toBeDefined()
    expect(user?.fqn).toBe("com.example.User")
    expect(user?.superclass?.name).toBe("BaseEntity")
    expect(user?.interfaces.map((i) => i.name)).toEqual(["Named"])
    expect(user?.fields.map((f) => f.name)).toEqual([
      "name",
      "active",
      "address",
      "orders",
      "loginCount",
      "CONSTANT",
    ])
    expect(user?.methods.map((m) => m.name)).toEqual([
      "getName",
      "isActive",
      "getAddress",
      "getOrders",
      "hasOrders",
      "displayName",
      "setName",
      "secret",
      "of",
    ])
    expect(user?.methods.find((m) => m.name === "of")?.modifiers).toContain("static")
    const controller = cls("UserController")
    expect(controller?.annotations.map((a) => `${a.name}${a.value ? `=${a.value}` : ""}`)).toEqual([
      "Controller",
      "RequestMapping=/users",
    ])
    const list = controller?.methods.find((m) => m.name === "list")
    expect(list?.annotations[0].name).toBe("GetMapping")
    expect(list?.params.map((p) => `${p.type.name} ${p.name}`)).toEqual(["Model model", "int page"])
    expect(list?.params[1].annotations[0]).toMatchObject({ name: "RequestParam" })
    expect(list?.body).toContain('return "users/list"')
    const address = cls("Address")
    expect(address?.kind).toBe("record")
    expect(address?.recordComponents.map((c) => `${c.type.name} ${c.name}`)).toEqual([
      "String street",
      "String city",
      "int zip",
    ])
    expect(cls("ShoutFilter")?.fqn).toBe("com.example.pebble.AppExtension.ShoutFilter")
  })
})

describe("java model", () => {
  test("properties from getters, records, lombok, public fields and inheritance", () => {
    const names = (t: string) => model.propertiesOf(t).map((p) => `${p.name}:${p.type.name}`)
    expect(names("User")).toEqual(
      [
        "name:String",
        "active:boolean",
        "address:Address",
        "orders:List",
        "orders:boolean".replace("orders:boolean", "loginCount:int"),
        "displayName:String",
        "id:Long",
      ].filter((x) => !x.startsWith("orders:boolean")),
    )
    expect(names("Address")).toEqual(["street:String", "city:String", "zip:int"])
    expect(names("Order")).toEqual(["number:String", "total:BigDecimal"])
    expect(names("String")).toEqual([])
    expect(model.elementType(parseType("List<Order>"))?.name).toBe("Order")
    expect(model.resolveChain(parseType("User"), ["address", "city"])?.name).toBe("String")
    expect(model.resolveChain(parseType("User"), ["nope"])).toBeUndefined()
  })

  test("controllers: view names and typed attributes", () => {
    expect(model.viewNames().sort()).toEqual(["users/detail", "users/list"])
    const list = model.attributesForView("users/list")
    expect(list.map((a) => `${a.name}:${a.type.raw}${a.global ? "!" : ""}`)).toEqual([
      "siteName:String",
      "users:List<User>",
      "page:int",
      "title:String",
      "year:Integer!",
      "settings:Settings!",
    ])
    const detail = model.attributesForView("users/detail")
    expect(detail.map((a) => `${a.name}:${a.type.raw}`)).toEqual([
      "siteName:String",
      "user:User",
      "orders:List<Order>",
      "current:User",
      "form:UserForm",
      "saved:Boolean",
      "year:Integer",
      "settings:Settings",
    ])
    expect(detail.find((a) => a.name === "user")?.methodName).toBe("detail")
    expect(model.attributesForView("unknown").map((a) => a.name)).toEqual(["year", "settings"])
  })

  test("pebble extensions from registrations and implementations", () => {
    const ext = model.extensions
      .map((e) => `${e.kind}:${e.name}(${e.params.join(",")})@${e.className}`)
      .sort()
    expect(ext).toEqual([
      "filter:money(currency,locale)@MoneyFilter",
      "filter:shout()@ShoutFilter",
      "filter:slugify(separator)@UnregisteredFilter",
      "function:asset(path)@AssetFunction",
      "test:adult()@AdultTest",
    ])
  })
})
