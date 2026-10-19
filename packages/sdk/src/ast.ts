import { parse } from "@babel/parser"

// Babel's AST types are large; ppt2 only touches a handful of fields.
export type Node = { type: string; start: number; end: number; [k: string]: any }

let cache: { source: string; ast: Node } | undefined

export function parseSource(source: string): Node {
  if (cache?.source === source) return cache.ast
  const ast = parse(source, {
    sourceType: "module",
    plugins: ["jsx", "typescript"],
  }) as unknown as Node
  cache = { source, ast }
  return ast
}

/** Depth-first walk with ancestor chain. Return false from visit to skip children. */
export function walk(node: Node, visit: (node: Node, ancestors: Node[]) => boolean | void, ancestors: Node[] = []) {
  if (visit(node, ancestors) === false) return
  ancestors.push(node)
  for (const key in node) {
    if (key === "loc" || key === "extra" || key === "leadingComments" || key === "trailingComments" || key === "innerComments") continue
    const v = node[key]
    if (Array.isArray(v)) {
      for (const c of v) if (c && typeof c.type === "string") walk(c, visit, ancestors)
    } else if (v && typeof v === "object" && typeof v.type === "string") {
      walk(v, visit, ancestors)
    }
  }
  ancestors.pop()
}

export function findElementAt(ast: Node, start: number): { node: Node; ancestors: Node[] } | undefined {
  let found: { node: Node; ancestors: Node[] } | undefined
  walk(ast, (n, anc) => {
    if (found) return false
    if (n.end < start || n.start > start) return false
    if (n.type === "JSXElement" && n.start === start) {
      found = { node: n, ancestors: [...anc] }
      return false
    }
  })
  return found
}

const FUNCTION_TYPES = new Set(["ArrowFunctionExpression", "FunctionExpression", "FunctionDeclaration", "ObjectMethod", "ClassMethod"])

/** An element is a template if it sits inside a function: a component, or a `.map()` callback. */
export function isTemplate(ancestors: Node[]) {
  return ancestors.some((a) => FUNCTION_TYPES.has(a.type))
}

export function tagName(source: string, el: Node): string {
  const n = el.openingElement.name
  return source.slice(n.start, n.end)
}

export function lineStart(source: string, pos: number) {
  const i = source.lastIndexOf("\n", pos - 1)
  return i + 1
}

/** Leading whitespace of the line containing pos. */
export function indentAt(source: string, pos: number) {
  const ls = lineStart(source, pos)
  return /^[ \t]*/.exec(source.slice(ls))![0]
}

export function lineCol(source: string, offset: number) {
  let line = 1, last = 0
  for (let i = 0; i < offset && i < source.length; i++) if (source[i] === "\n") { line++; last = i + 1 }
  return { line, column: offset - last + 1 }
}

/** Remove common indentation and surrounding blank lines from JSX text. */
export function dedentText(raw: string): string {
  const lines = raw.split("\n")
  if (lines.length === 1) return raw.trim()
  const first = lines[0].trim()
  const rest = lines.slice(1)
  const indents = rest.filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)![0].length)
  const min = indents.length ? Math.min(...indents) : 0
  const out = [first, ...rest.map((l) => l.slice(min).trimEnd())]
  while (out.length && !out[0].trim()) out.shift()
  while (out.length && !out[out.length - 1].trim()) out.pop()
  return out.join("\n")
}

export function escapeJsxText(text: string) {
  return text.replace(/[{}<>]/g, (c) => ({ "{": "&#123;", "}": "&#125;", "<": "&lt;", ">": "&gt;" })[c]!)
}
