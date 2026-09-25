import type { Analysis } from "../analysis"
import type * as ast from "../ast"
import { scopeAt } from "../model"

/** Shape shared with JavaType so the Java model can be plugged in directly. */
export interface TypeInfo {
  raw: string
  name: string
  args: TypeInfo[]
}

export interface PropertyInfo {
  name: string
  type: TypeInfo
  /** e.g. "getter in User (User.java)" */
  detail: string
  filePath?: string
  offset?: number
}

export interface ExternalVariable {
  type: TypeInfo
  /** e.g. "model attribute added in UserController.list" */
  detail: string
  filePath?: string
  offset?: number
}

/** What the editor knows about types from outside the template (Java, for now). */
export interface TypeProvider {
  externalVariable(name: string): ExternalVariable | undefined
  externalVariableNames(): string[]
  propertiesOf(type: TypeInfo): PropertyInfo[]
  elementType(type: TypeInfo): TypeInfo | undefined
}

const simple = (name: string): TypeInfo => ({ raw: name, name, args: [] })
const lowerFirst = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s)

export interface ResolvedVariable {
  type: TypeInfo
  detail: string
  filePath?: string
  offset?: number
}

/** Type of a variable visible at the offset: loop variables, `set` variables and external ones. */
export function typeOfVariable(
  name: string,
  analysis: Analysis,
  offset: number,
  provider: TypeProvider,
  depth = 0,
): ResolvedVariable | undefined {
  if (depth > 5) return undefined
  const scope = scopeAt(analysis.ast, analysis.model, offset)
  const v = scope.variables.find((x) => x.name === name)
  if (!v) return provider.externalVariable(name)
  if (v.kind === "loop-variable") {
    const forNode = [...scope.enclosing]
      .reverse()
      .find((s): s is ast.ForStatement => s.type === "For" && s.variable?.name === name)
    if (!forNode?.iterable) return undefined
    const iterable = typeOfExpression(forNode.iterable, analysis, provider, depth + 1)
    const element = iterable ? provider.elementType(iterable) : undefined
    return element ? { type: element, detail: `element of ${iterable?.raw}` } : undefined
  }
  if (v.kind === "set") {
    const setNode = analysis.model.sets.find((s) => s.nameRange.start === v.range?.start)?.node
    if (!setNode?.value) return undefined
    const type = typeOfExpression(setNode.value, analysis, provider, depth + 1)
    return type ? { type, detail: "set variable" } : undefined
  }
  return undefined
}

/** Best-effort type of an expression. */
export function typeOfExpression(
  expr: ast.Expr,
  analysis: Analysis,
  provider: TypeProvider,
  depth = 0,
): TypeInfo | undefined {
  if (depth > 8) return undefined
  switch (expr.type) {
    case "String":
      return simple("String")
    case "Literal":
      return typeof expr.value === "number"
        ? simple(Number.isInteger(expr.value) ? "Integer" : "Double")
        : typeof expr.value === "boolean"
          ? simple("Boolean")
          : undefined
    case "Variable":
      return typeOfVariable(expr.name, analysis, expr.range.start, provider, depth + 1)?.type
    case "Member": {
      const base = typeOfExpression(expr.object, analysis, provider, depth + 1)
      return base
        ? provider.propertiesOf(base).find((p) => p.name === expr.property.name)?.type
        : undefined
    }
    case "Subscript": {
      const base = typeOfExpression(expr.object, analysis, provider, depth + 1)
      if (!base) return undefined
      if (base.name === "Map") return base.args[1]
      return provider.elementType(base)
    }
    case "Call": {
      if (expr.callee.type !== "Member") return undefined
      const base = typeOfExpression(expr.callee.object, analysis, provider, depth + 1)
      if (!base) return undefined
      const name = expr.callee.property.name
      const props = provider.propertiesOf(base)
      const direct = props.find((p) => p.name === name)
      if (direct) return direct.type
      const getter = /^(get|is|has)([A-Z].*)$/.exec(name)
      return getter ? props.find((p) => p.name === lowerFirst(getter[2]))?.type : undefined
    }
    case "Filter": {
      const inner = typeOfExpression(expr.expr, analysis, provider, depth + 1)
      if (!inner) return undefined
      if (["first", "last"].includes(expr.name.name)) return provider.elementType(inner)
      if (["sort", "rsort", "reverse", "slice", "merge", "default"].includes(expr.name.name))
        return inner
      if (
        [
          "upper",
          "lower",
          "trim",
          "capitalize",
          "title",
          "abbreviate",
          "date",
          "join",
          "escape",
          "raw",
          "urlencode",
          "replace",
          "nl2br",
          "format",
          "base64encode",
          "base64decode",
          "sha256",
          "numberformat",
        ].includes(expr.name.name)
      )
        return simple("String")
      if (expr.name.name === "length") return simple("Integer")
      if (expr.name.name === "split")
        return { raw: "List<String>", name: "List", args: [simple("String")] }
      return undefined
    }
    case "Ternary": {
      return (
        typeOfExpression(expr.then, analysis, provider, depth + 1) ??
        typeOfExpression(expr.else, analysis, provider, depth + 1)
      )
    }
    default:
      return undefined
  }
}

/** Type reached by `base[0].base[1]…` written before a `.` in completion. */
export function typeOfChain(
  base: string[],
  analysis: Analysis,
  offset: number,
  provider: TypeProvider,
): TypeInfo | undefined {
  if (base.length === 0) return undefined
  let current = typeOfVariable(base[0], analysis, offset, provider)?.type
  for (const segment of base.slice(1)) {
    if (!current) return undefined
    current = provider.propertiesOf(current).find((p) => p.name === segment)?.type
  }
  return current
}

/** Property reached by a member access expression, with its declaration site. */
export function propertyAt(
  expr: ast.MemberExpr,
  analysis: Analysis,
  provider: TypeProvider,
): PropertyInfo | undefined {
  const base = typeOfExpression(expr.object, analysis, provider)
  return base ? provider.propertiesOf(base).find((p) => p.name === expr.property.name) : undefined
}

export const noTypes: TypeProvider = {
  externalVariable: () => undefined,
  externalVariableNames: () => [],
  propertiesOf: () => [],
  elementType: () => undefined,
}
