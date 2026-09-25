import type { OperatorSpec } from "./types"

/** Binary operators with Pebble's precedence (higher binds tighter). Source: CoreExtension.java. */
export const binaryOperators: OperatorSpec[] = [
  { name: "or", precedence: 10, type: "binary", doc: "Logical or." },
  { name: "and", precedence: 15, type: "binary", doc: "Logical and." },
  { name: "is", precedence: 20, type: "test", doc: "Applies a test: `value is empty`." },
  { name: "is not", precedence: 20, type: "test", doc: "Negated test: `value is not null`." },
  {
    name: "contains",
    precedence: 20,
    type: "binary",
    doc: "True when a collection, map or string contains the right operand (or all elements of a list).",
  },
  { name: "==", precedence: 30, type: "binary", doc: "Equality (also `equals`)." },
  { name: "equals", precedence: 30, type: "binary", doc: "Equality (same as `==`)." },
  { name: "!=", precedence: 30, type: "binary", doc: "Inequality." },
  { name: ">", precedence: 30, type: "binary", doc: "Greater than." },
  { name: "<", precedence: 30, type: "binary", doc: "Less than." },
  { name: ">=", precedence: 30, type: "binary", doc: "Greater than or equal." },
  { name: "<=", precedence: 30, type: "binary", doc: "Less than or equal." },
  {
    name: "+",
    precedence: 40,
    type: "binary",
    doc: "Addition, list union or string concatenation (4.1.2+).",
  },
  { name: "-", precedence: 40, type: "binary", doc: "Subtraction or list difference." },
  { name: "*", precedence: 60, type: "binary", doc: "Multiplication." },
  { name: "/", precedence: 60, type: "binary", doc: "Division." },
  { name: "%", precedence: 60, type: "binary", doc: "Modulus." },
  { name: "|", precedence: 100, type: "filter", doc: "Applies a filter: `value | upper`." },
  { name: "~", precedence: 110, type: "binary", doc: "String concatenation." },
  { name: "..", precedence: 120, type: "binary", doc: "Range: `1..5` or `'a'..'e'`." },
]

export const unaryOperators: OperatorSpec[] = [
  { name: "not", precedence: 500, type: "unary", doc: "Logical negation." },
  { name: "+", precedence: 500, type: "unary", doc: "Unary plus." },
  { name: "-", precedence: 500, type: "unary", doc: "Unary minus." },
]

export const wordOperators = ["and", "or", "not", "is", "contains", "equals"]
