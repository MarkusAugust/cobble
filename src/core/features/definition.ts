import type { Analysis } from "../analysis"
import type * as ast from "../ast"
import { scopeAt } from "../model"
import { locate } from "./locate"
import type { Definition } from "./types"

const contains = (r: ast.Range, offset: number) => offset >= r.start && offset <= r.end

/** What the symbol at the offset refers to; the server turns this into locations. */
export function definition(analysis: Analysis, offset: number): Definition | null {
  const { model } = analysis
  for (const ref of model.references) {
    if (ref.literalName && contains(ref.range, offset)) {
      return { kind: "template", name: ref.literalName, originRange: ref.range }
    }
  }
  const located = locate(analysis.ast, offset)
  const node = located.node
  if (node?.type === "Block") {
    if (node.name && contains(node.name.range, offset)) {
      return { kind: "block", name: node.name.name, originRange: node.name.range, parentOnly: true }
    }
    if (node.endName && contains(node.endName.range, offset)) {
      return {
        kind: "block",
        name: node.endName.name,
        originRange: node.endName.range,
        parentOnly: false,
        localRange: node.range,
        localSelectionRange: node.name?.range ?? node.tagRange,
      }
    }
  }
  if (node?.type === "From") {
    for (const n of node.names) {
      if (contains(n.name.range, offset) && node.template?.type === "String") {
        return {
          kind: "macro",
          name: n.name.name,
          originRange: n.name.range,
          template: node.template.value,
        }
      }
    }
  }
  const chain = located.exprChain
  // Innermost node first; a Variable that is the callee of its parent Call is handled as a call.
  for (let i = chain.length - 1; i >= 0; i--) {
    const e = chain[i]
    const parent = i > 0 ? chain[i - 1] : undefined
    const call =
      e.type === "Call" ? e : parent?.type === "Call" && parent.callee === e ? parent : undefined
    if (call && call.callee.type === "Variable" && contains(call.callee.range, offset)) {
      const name = call.callee.name
      const originRange = call.callee.range
      if (name === "parent") {
        const block = [...located.parents].reverse().find((p) => p.type === "Block")
        if (block?.type === "Block" && block.name) {
          return { kind: "block", name: block.name.name, originRange, parentOnly: true }
        }
        return null
      }
      const macro = model.macros.find((m) => m.name === name)
      if (macro) {
        return {
          kind: "macro",
          name,
          originRange,
          localRange: macro.node.range,
          localSelectionRange: macro.nameRange,
        }
      }
      for (const imp of model.imports) {
        const n = imp.names?.find((x) => (x.alias ?? x.name).name === name)
        if (n && imp.ref.literalName) {
          return { kind: "macro", name: n.name.name, originRange, template: imp.ref.literalName }
        }
      }
      return null
    }
    if (
      e.type === "String" &&
      parent?.type === "Call" &&
      parent.callee.type === "Variable" &&
      parent.callee.name === "block" &&
      parent.args[0]?.value === e
    ) {
      const local = model.blocks.find((b) => b.name === e.value)
      return {
        kind: "block",
        name: e.value,
        originRange: e.range,
        parentOnly: false,
        localRange: local?.node.range,
        localSelectionRange: local?.nameRange,
      }
    }
    if (
      call &&
      call.callee.type === "Member" &&
      contains(call.callee.property.range, offset) &&
      call.callee.object.type === "Variable"
    ) {
      const objectName = call.callee.object.name
      const alias = model.imports.find(
        (imp) => imp.kind === "import" && imp.alias?.name === objectName,
      )
      if (alias?.ref.literalName) {
        return {
          kind: "macro",
          name: call.callee.property.name,
          originRange: call.callee.property.range,
          template: alias.ref.literalName,
        }
      }
    }
    if (e.type === "Variable" && contains(e.range, offset)) {
      const scope = scopeAt(analysis.ast, model, offset)
      const v = scope.variables.find((x) => x.name === e.name)
      if (v?.range && v.kind !== "loop" && v.kind !== "context") {
        const setNode = model.sets.find((s) => s.nameRange.start === v.range?.start)
        return {
          kind: "variable",
          name: e.name,
          originRange: e.range,
          localRange: setNode?.node.range ?? v.range,
          localSelectionRange: v.range,
        }
      }
      return null
    }
  }
  return null
}
