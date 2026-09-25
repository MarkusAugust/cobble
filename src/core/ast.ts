export interface Range {
  start: number
  end: number
}

export interface Identifier {
  name: string
  range: Range
}

// ---------- Expressions ----------

export interface Literal {
  type: "Literal"
  range: Range
  value: number | boolean | null
  raw: string
}

export type StringPartNode =
  | { kind: "text"; value: string; range: Range }
  | { kind: "expr"; expr: Expr; range: Range }

export interface StringLiteral {
  type: "String"
  range: Range
  value: string
  quote: '"' | "'"
  /** Present when the string contains `#{ }` interpolation. */
  parts?: StringPartNode[]
}

export interface ListLiteral {
  type: "List"
  range: Range
  items: Expr[]
}

export interface MapLiteral {
  type: "Map"
  range: Range
  entries: { key: Expr; value: Expr }[]
}

export interface VariableExpr {
  type: "Variable"
  range: Range
  name: string
}

export interface MemberExpr {
  type: "Member"
  range: Range
  object: Expr
  property: Identifier
}

export interface SubscriptExpr {
  type: "Subscript"
  range: Range
  object: Expr
  index: Expr
}

export interface Argument {
  range: Range
  name?: Identifier
  value: Expr
}

export interface CallExpr {
  type: "Call"
  range: Range
  /** A `Variable` for functions and macros, a `Member` for method calls. */
  callee: VariableExpr | MemberExpr
  args: Argument[]
  argsRange: Range
}

export interface FilterExpr {
  type: "Filter"
  range: Range
  expr: Expr
  name: Identifier
  args: Argument[]
  argsRange?: Range
}

export interface TestExpr {
  type: "Test"
  range: Range
  expr: Expr
  name: Identifier
  negated: boolean
  args: Argument[]
  argsRange?: Range
}

export interface UnaryExpr {
  type: "Unary"
  range: Range
  operator: string
  operand: Expr
}

export interface BinaryExpr {
  type: "Binary"
  range: Range
  operator: string
  left: Expr
  right: Expr
}

export interface TernaryExpr {
  type: "Ternary"
  range: Range
  condition: Expr
  then: Expr
  else: Expr
}

export interface ErrorExpr {
  type: "Error"
  range: Range
}

export type Expr =
  | Literal
  | StringLiteral
  | ListLiteral
  | MapLiteral
  | VariableExpr
  | MemberExpr
  | SubscriptExpr
  | CallExpr
  | FilterExpr
  | TestExpr
  | UnaryExpr
  | BinaryExpr
  | TernaryExpr
  | ErrorExpr

// ---------- Nodes ----------

export interface TextNode {
  type: "Text"
  range: Range
  value: string
}

export interface CommentNode {
  type: "Comment"
  range: Range
}

export interface PrintNode {
  type: "Print"
  range: Range
  expr: Expr | null
}

export interface StatementBase {
  /** Full extent including body and end tag. */
  range: Range
  /** The opening `{% … %}`. */
  openRange: Range
  /** The closing `{% end… %}` when present. */
  closeRange?: Range
  /** Range of the tag name token. */
  tagRange: Range
  tag: string
}

export interface IfBranch {
  keyword: "if" | "elseif" | "else"
  range: Range
  tagRange: Range
  condition: Expr | null
  body: Node[]
}

export interface IfStatement extends StatementBase {
  type: "If"
  branches: IfBranch[]
}

export interface ForStatement extends StatementBase {
  type: "For"
  variable: Identifier | null
  iterable: Expr | null
  body: Node[]
  elseBody?: Node[]
  elseRange?: Range
}

export interface BlockStatement extends StatementBase {
  type: "Block"
  name: Identifier | null
  body: Node[]
  endName?: Identifier
}

export interface ExtendsStatement extends StatementBase {
  type: "Extends"
  template: Expr | null
}

export interface IncludeStatement extends StatementBase {
  type: "Include"
  template: Expr | null
  with?: Expr
}

export interface ImportStatement extends StatementBase {
  type: "Import"
  template: Expr | null
  alias?: Identifier
}

export interface FromStatement extends StatementBase {
  type: "From"
  template: Expr | null
  names: { name: Identifier; alias?: Identifier }[]
}

export interface EmbedStatement extends StatementBase {
  type: "Embed"
  template: Expr | null
  with?: Expr
  body: Node[]
}

export interface MacroParam {
  name: Identifier
  default?: Expr
}

export interface MacroStatement extends StatementBase {
  type: "Macro"
  name: Identifier | null
  params: MacroParam[]
  body: Node[]
}

export interface SetStatement extends StatementBase {
  type: "Set"
  name: Identifier | null
  value: Expr | null
}

export interface FilterCall {
  name: Identifier
  args: Argument[]
  argsRange?: Range
}

export interface FilterStatement extends StatementBase {
  type: "FilterBlock"
  filters: FilterCall[]
  body: Node[]
}

export interface AutoescapeStatement extends StatementBase {
  type: "Autoescape"
  strategy: Expr | null
  body: Node[]
}

export interface VerbatimStatement extends StatementBase {
  type: "Verbatim"
  text: string
  textRange: Range
}

export interface CacheStatement extends StatementBase {
  type: "Cache"
  key: Expr | null
  body: Node[]
}

export interface ParallelStatement extends StatementBase {
  type: "Parallel"
  body: Node[]
}

export interface FlushStatement extends StatementBase {
  type: "Flush"
}

/** Unknown tags and stray end tags. */
export interface UnknownStatement extends StatementBase {
  type: "Unknown"
}

export type Statement =
  | IfStatement
  | ForStatement
  | BlockStatement
  | ExtendsStatement
  | IncludeStatement
  | ImportStatement
  | FromStatement
  | EmbedStatement
  | MacroStatement
  | SetStatement
  | FilterStatement
  | AutoescapeStatement
  | VerbatimStatement
  | CacheStatement
  | ParallelStatement
  | FlushStatement
  | UnknownStatement

export type Node = TextNode | CommentNode | PrintNode | Statement

export interface Template {
  type: "Template"
  range: Range
  body: Node[]
}

/** Child bodies of a node, used by generic walkers. */
export function childBodies(node: Node): Node[][] {
  switch (node.type) {
    case "If":
      return node.branches.map((b) => b.body)
    case "For":
      return node.elseBody ? [node.body, node.elseBody] : [node.body]
    case "Block":
    case "Embed":
    case "Macro":
    case "FilterBlock":
    case "Autoescape":
    case "Cache":
    case "Parallel":
      return [node.body]
    default:
      return []
  }
}

/** Depth-first walk over every node, parents before children. */
export function walk(
  nodes: Node[],
  visit: (node: Node, parents: Statement[]) => void,
  parents: Statement[] = [],
): void {
  for (const node of nodes) {
    visit(node, parents)
    const bodies = childBodies(node)
    if (bodies.length > 0) {
      const next = [...parents, node as Statement]
      for (const body of bodies) walk(body, visit, next)
    }
  }
}

/** Every expression reachable from a node (not descending into child bodies). */
export function nodeExpressions(node: Node): Expr[] {
  switch (node.type) {
    case "Print":
      return node.expr ? [node.expr] : []
    case "If":
      return node.branches.flatMap((b) => (b.condition ? [b.condition] : []))
    case "For":
      return node.iterable ? [node.iterable] : []
    case "Extends":
    case "Import":
    case "From":
      return node.template ? [node.template] : []
    case "Include":
    case "Embed":
      return [node.template, node.with].filter((e): e is Expr => !!e)
    case "Macro":
      return node.params.flatMap((p) => (p.default ? [p.default] : []))
    case "Set":
      return node.value ? [node.value] : []
    case "FilterBlock":
      return node.filters.flatMap((f) => f.args.map((a) => a.value))
    case "Autoescape":
      return node.strategy ? [node.strategy] : []
    case "Cache":
      return node.key ? [node.key] : []
    default:
      return []
  }
}

/** Depth-first walk over an expression tree, parents before children. */
export function walkExpr(
  expr: Expr,
  visit: (e: Expr, parent: Expr | null) => void,
  parent: Expr | null = null,
): void {
  visit(expr, parent)
  const children: Expr[] = []
  switch (expr.type) {
    case "String":
      for (const p of expr.parts ?? []) if (p.kind === "expr") children.push(p.expr)
      break
    case "List":
      children.push(...expr.items)
      break
    case "Map":
      for (const e of expr.entries) children.push(e.key, e.value)
      break
    case "Member":
      children.push(expr.object)
      break
    case "Subscript":
      children.push(expr.object, expr.index)
      break
    case "Call":
      children.push(expr.callee, ...expr.args.map((a) => a.value))
      break
    case "Filter":
    case "Test":
      children.push(expr.expr, ...expr.args.map((a) => a.value))
      break
    case "Unary":
      children.push(expr.operand)
      break
    case "Binary":
      children.push(expr.left, expr.right)
      break
    case "Ternary":
      children.push(expr.condition, expr.then, expr.else)
      break
    default:
      break
  }
  for (const c of children) walkExpr(c, visit, expr)
}
