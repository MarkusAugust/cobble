export interface LoopVariable {
  name: string
  doc: string
}

export const loopVariables: LoopVariable[] = [
  { name: "index", doc: "Zero-based index of the current iteration." },
  { name: "length", doc: "Number of elements being iterated." },
  { name: "first", doc: "True on the first iteration." },
  { name: "last", doc: "True on the last iteration." },
  { name: "revindex", doc: "Number of iterations remaining after this one." },
]

export const escapeStrategies = ["html", "js", "css", "url_param", "json"]

export const constants = ["true", "false", "null", "none"]
