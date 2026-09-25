import type * as ast from "./ast"
import { childBodies, walk } from "./ast"

export interface TemplateRef {
  expr: ast.Expr
  /** The template name when it is a plain string literal. */
  literalName?: string
  range: ast.Range
  statement: ast.Statement
}

export interface BlockInfo {
  name: string
  nameRange: ast.Range
  node: ast.BlockStatement
}

export interface MacroInfo {
  name: string
  nameRange: ast.Range
  params: string[]
  node: ast.MacroStatement
}

export interface ImportInfo {
  ref: TemplateRef
  kind: "import" | "from"
  alias?: ast.Identifier
  names?: { name: ast.Identifier; alias?: ast.Identifier }[]
}

export interface TemplateModel {
  extends?: TemplateRef
  includes: TemplateRef[]
  imports: ImportInfo[]
  blocks: BlockInfo[]
  macros: MacroInfo[]
  sets: { name: string; nameRange: ast.Range; node: ast.SetStatement }[]
  /** Every template reference (extends, include, embed, import, from). */
  references: TemplateRef[]
}

function ref(expr: ast.Expr | null, statement: ast.Statement): TemplateRef | undefined {
  if (!expr) return undefined
  return {
    expr,
    literalName: expr.type === "String" && !expr.parts ? expr.value : undefined,
    range: expr.range,
    statement,
  }
}

/** Collects declarations and references from a parsed template. */
export function buildModel(template: ast.Template): TemplateModel {
  const model: TemplateModel = {
    includes: [],
    imports: [],
    blocks: [],
    macros: [],
    sets: [],
    references: [],
  }
  walk(template.body, (node) => {
    switch (node.type) {
      case "Extends": {
        const r = ref(node.template, node)
        if (r) {
          model.extends ??= r
          model.references.push(r)
        }
        break
      }
      case "Include":
      case "Embed": {
        const r = ref(node.template, node)
        if (r) {
          model.includes.push(r)
          model.references.push(r)
        }
        break
      }
      case "Import": {
        const r = ref(node.template, node)
        if (r) {
          model.imports.push({ ref: r, kind: "import", alias: node.alias })
          model.references.push(r)
        }
        break
      }
      case "From": {
        const r = ref(node.template, node)
        if (r) {
          model.imports.push({ ref: r, kind: "from", names: node.names })
          model.references.push(r)
        }
        break
      }
      case "Block":
        if (node.name) model.blocks.push({ name: node.name.name, nameRange: node.name.range, node })
        break
      case "Macro":
        if (node.name)
          model.macros.push({
            name: node.name.name,
            nameRange: node.name.range,
            params: node.params.map((p) => p.name.name),
            node,
          })
        break
      case "Set":
        if (node.name) model.sets.push({ name: node.name.name, nameRange: node.name.range, node })
        break
      default:
        break
    }
  })
  return model
}

export type VariableKind =
  | "set"
  | "loop"
  | "loop-variable"
  | "macro-parameter"
  | "context"
  | "import-alias"
  | "global"

export interface VariableInScope {
  name: string
  kind: VariableKind
  /** Where the variable is introduced. */
  range?: ast.Range
  detail?: string
}

export interface Scope {
  variables: VariableInScope[]
  /** Enclosing statements, outermost first. */
  enclosing: ast.Statement[]
  inFor: boolean
  inMacro: boolean
  inBlock: boolean
}

const contains = (r: ast.Range, offset: number) => offset >= r.start && offset <= r.end

/** Variables and enclosing statements visible at an offset. */
export function scopeAt(template: ast.Template, model: TemplateModel, offset: number): Scope {
  const variables = new Map<string, VariableInScope>()
  const enclosing: ast.Statement[] = []
  const add = (v: VariableInScope) => {
    if (!variables.has(v.name)) variables.set(v.name, v)
  }
  for (const imp of model.imports) {
    if (imp.kind === "import" && imp.alias)
      add({
        name: imp.alias.name,
        kind: "import-alias",
        range: imp.alias.range,
        detail: `macros from ${imp.ref.literalName ?? "template"}`,
      })
  }

  function visitBody(body: ast.Node[]) {
    for (const node of body) {
      if (node.type === "Set" && node.name && node.range.end <= offset) {
        add({ name: node.name.name, kind: "set", range: node.name.range })
        continue
      }
      if (!contains(node.range, offset)) continue
      if (node.type === "Text" || node.type === "Comment" || node.type === "Print") return
      enclosing.push(node)
      if (node.type === "For") {
        if (node.variable && !(node.elseBody && node.elseRange && offset >= node.elseRange.start)) {
          add({ name: node.variable.name, kind: "loop-variable", range: node.variable.range })
          add({
            name: "loop",
            kind: "loop",
            range: node.tagRange,
            detail: "loop.index, loop.length, loop.first, loop.last, loop.revindex",
          })
        }
      } else if (node.type === "Macro") {
        for (const p of node.params)
          add({ name: p.name.name, kind: "macro-parameter", range: p.name.range })
        add({
          name: "_context",
          kind: "context",
          range: node.tagRange,
          detail: "the caller's context",
        })
      }
      for (const child of childBodies(node)) {
        if (
          child.length > 0 &&
          offset >= child[0].range.start &&
          offset <= child[child.length - 1].range.end
        ) {
          visitBody(child)
          return
        }
      }
      // Offset is inside the node's header or between bodies: still inside the statement.
      return
    }
  }
  visitBody(template.body)
  return {
    variables: [...variables.values()],
    enclosing,
    inFor: enclosing.some((s) => s.type === "For"),
    inMacro: enclosing.some((s) => s.type === "Macro"),
    inBlock: enclosing.some((s) => s.type === "Block"),
  }
}
