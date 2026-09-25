import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { type JavaFile, JavaModel, parseJava, parseKotlin } from "../../../src/core"

function loadAll(dir: string, out: JavaFile[] = []): JavaFile[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) loadAll(full, out)
    else if (entry.endsWith(".kt")) out.push(parseKotlin(readFileSync(full, "utf8"), full))
    else if (entry.endsWith(".java")) out.push(parseJava(readFileSync(full, "utf8"), full))
  }
  return out
}
const files = loadAll(join(import.meta.dir, "..", "fixtures", "kotlin"))
const model = new JavaModel(files)
const cls = (name: string) => files.flatMap((f) => f.classes).find((c) => c.name === name)

describe("kotlin parser", () => {
  test("classes, data classes, properties and functions", () => {
    const product = cls("Product")
    expect(product?.modifiers).toContain("data")
    expect(product?.fields.map((f) => `${f.modifiers[0]} ${f.name}:${f.type.name}`)).toEqual([
      "public id:Long",
      "public name:String",
      "public price:Double",
      "private secret:String",
      "public displayName:String",
    ])
    expect(product?.methods.map((m) => `${m.name}:${m.returnType.name}`)).toEqual([
      "discounted:Double",
      "internalOnly:Object",
    ])
    expect(product?.methods[1].modifiers).toContain("private")
    const cart = cls("Cart")
    expect(cart?.fields.map((f) => `${f.name}:${f.type.raw}`)).toEqual([
      "owner:Customer",
      "items:List<Product>",
      "mutableThing:Int",
      "total:Double",
    ])
    expect(cart?.methods[0]).toMatchObject({ name: "isEmpty", returnType: { name: "Boolean" } })
    expect(cls("Customer")?.fields[0].type.name).toBe("String")
    expect(cls("Config")?.fields[0]).toMatchObject({ name: "version", type: { name: "String" } })
    const controller = cls("ShopController")
    expect(controller?.annotations[0].name).toBe("Controller")
    expect(
      controller?.methods.map(
        (m) =>
          `${m.name}(${m.params.map((p) => `${p.name}:${p.type.name}`).join(",")}):${m.returnType.name}`,
      ),
    ).toEqual(["shop(model:Model):String", "item(id:Long):ModelAndView"])
    expect(controller?.methods[0].annotations.map((a) => `${a.name}=${a.value}`)).toEqual([
      "GetMapping=/shop",
    ])
  })
  test("top-level functions and their bodies", () => {
    const routes = files.find((f) => f.filePath.endsWith("Routes.kt"))
    expect(routes?.topLevelFunctions?.map((f) => f.name)).toEqual(["configureRouting"])
    expect(routes?.topLevelFunctions?.[0].body).toContain('PebbleContent("products/list.peb"')
    expect(
      routes?.topLevelFunctions?.[0].annotations.find((a) => a.name === "Receiver")?.value,
    ).toBe("Application")
  })
})

describe("kotlin model", () => {
  test("properties from kotlin classes", () => {
    const names = (t: string) => model.propertiesOf(t).map((p) => `${p.name}:${p.type.name}`)
    expect(names("Product")).toEqual([
      "id:Long",
      "name:String",
      "price:Double",
      "displayName:String",
      "discounted:Double",
    ])
    expect(names("Cart").sort()).toEqual([
      "empty:Boolean",
      "items:List",
      "owner:Customer",
      "total:Double",
    ])
  })
  test("ktor routes render templates with typed attributes", () => {
    expect(model.viewNames().sort()).toEqual([
      "products/detail.peb",
      "products/list.peb",
      "shop/index",
      "shop/item",
    ])
    expect(
      model.attributesForView("products/list.peb").map((a) => `${a.name}:${a.type.raw}`),
    ).toEqual(["products:List<Product>", "title:String"])
    expect(
      model.attributesForView("products/detail.peb").map((a) => `${a.name}:${a.type.raw}`),
    ).toEqual(["product:Product", "cart:Cart"])
  })
  test("spring in kotlin: index assignment, addAttribute and ModelAndView maps", () => {
    expect(model.attributesForView("shop/index").map((a) => `${a.name}:${a.type.raw}`)).toEqual([
      "products:List<Product>",
      "cart:Cart",
    ])
    expect(model.attributesForView("shop/item").map((a) => `${a.name}:${a.type.raw}`)).toEqual([
      "product:Product",
    ])
  })
  test("kotlin pebble extensions", () => {
    expect(model.extensions.map((e) => `${e.kind}:${e.name}(${e.params})@${e.className}`)).toEqual([
      "filter:price(currency)@PriceFilter",
    ])
  })
})

describe("javalin and plain pebble", () => {
  const app = parseJava(
    readFileSync(join(import.meta.dir, "..", "fixtures", "javalin", "App.java"), "utf8"),
    "/x/App.java",
  )
  const m = new JavaModel([app, ...files])
  test("ctx.render with Map.of and getTemplate + evaluate", () => {
    expect(m.attributesForView("hello.peb").map((a) => `${a.name}:${a.type.raw}`)).toEqual([
      "greeting:String",
      "count:Integer",
    ])
    expect(m.attributesForView("emails/welcome").map((a) => `${a.name}:${a.type.raw}`)).toEqual([
      "customer:Customer",
    ])
  })
})
