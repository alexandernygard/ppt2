// Source patches: the way visual edits flow back into code.
//
// Every edit is a minimal text change at the exact JSX element the model
// node came from (via its `src` offset). Formatting, comments and any code
// we don't touch are preserved. If an edit would have to change a computed
// value (an expression, a loop), it is refused with a PatchError rather than
// silently rewriting the user's logic.

import MagicString from "magic-string"
import { parseSource, walk, findElementAt, isTemplate, tagName, indentAt, lineStart, escapeJsxText, dedentText, type Node } from "./ast"
import { TAGS } from "./runtime"

export class PatchError extends Error {}

export interface PatchResult {
  source: string
  /** True when the edited element is a template (inside a component or loop) — the change affects every instance. */
  template?: boolean
}

function locate(source: string, src: number) {
  const ast = parseSource(source)
  const hit = findElementAt(ast, src)
  if (!hit) throw new PatchError("Element not found in source (the code changed since it was compiled).")
  return hit
}

// --- values -> code ----------------------------------------------------------

const IDENT = /^[A-Za-z_$][\w$]*$/

export function valueToCode(v: unknown, indent = ""): string {
  if (v === null) return "null"
  if (typeof v === "string") return JSON.stringify(v)
  if (typeof v === "number") return String(Math.round(v * 100) / 100)
  if (typeof v === "boolean") return String(v)
  if (Array.isArray(v)) {
    const parts = v.map((x) => valueToCode(x, indent + "  "))
    const flat = `[${parts.join(", ")}]`
    if (flat.length <= 72 && !flat.includes("\n")) return flat
    return `[\n${parts.map((p) => indent + "  " + p).join(",\n")},\n${indent}]`
  }
  if (typeof v === "object") {
    const entries = Object.entries(v as object).filter(([, x]) => x !== undefined)
    const parts = entries.map(([k, x]) => `${IDENT.test(k) ? k : JSON.stringify(k)}: ${valueToCode(x, indent + "  ")}`)
    const flat = `{ ${parts.join(", ")} }`
    if (!parts.length) return "{}"
    if (flat.length <= 72 && !flat.includes("\n")) return flat
    return `{\n${parts.map((p) => indent + "  " + p).join(",\n")},\n${indent}}`
  }
  throw new PatchError(`Cannot write ${typeof v} values into code`)
}

export function attrToCode(name: string, v: unknown, indent = ""): string {
  if (v === true) return name
  if (typeof v === "string" && !v.includes('"') && !v.includes("\n")) return `${name}="${v}"`
  return `${name}={${valueToCode(v, indent)}}`
}

const LITERAL_TYPES = new Set(["StringLiteral", "NumericLiteral", "BooleanLiteral", "NullLiteral"])
function isLiteral(n: Node | null | undefined): boolean {
  if (!n) return true // boolean shorthand: <Text bold>
  if (LITERAL_TYPES.has(n.type)) return true
  if (n.type === "JSXExpressionContainer") return isLiteral(n.expression)
  if (n.type === "UnaryExpression") return n.operator === "-" && n.argument.type === "NumericLiteral"
  if (n.type === "TemplateLiteral") return n.expressions.length === 0
  if (n.type === "ArrayExpression") return n.elements.every((e: Node) => e && isLiteral(e))
  if (n.type === "ObjectExpression") return n.properties.every((p: Node) => p.type === "ObjectProperty" && !p.computed && isLiteral(p.value))
  return false
}

// --- element props --------------------------------------------------------------

/** Set (or remove, with undefined) JSX attributes on the element at `src`. */
export function setProps(source: string, src: number, props: Record<string, unknown>): PatchResult {
  const { node, ancestors } = locate(source, src)
  const ms = new MagicString(source)
  const opening = node.openingElement
  const attrs: Node[] = opening.attributes
  const multiline = attrs.length > 1 && source.slice(opening.start, opening.end).includes("\n") && attrs.some((a, i) => i > 0 && source.slice(attrs[i - 1].end, a.start).includes("\n"))
  const elIndent = indentAt(source, node.start)

  for (const [name, value] of Object.entries(props)) {
    const attr = attrs.find((a) => a.type === "JSXAttribute" && a.name.name === name)
    if (attr) {
      if (value === undefined) {
        let start = attr.start
        while (start > 0 && /\s/.test(source[start - 1])) start--
        ms.remove(start, attr.end)
      } else {
        if (!isLiteral(attr.value)) throw new PatchError(`"${name}" is computed in code (${source.slice(attr.value.start, attr.value.end).slice(0, 40)}). Edit it in the code view.`)
        ms.overwrite(attr.start, attr.end, attrToCode(name, value, elIndent))
      }
    } else if (value !== undefined) {
      const last = attrs[attrs.length - 1]
      if (last) {
        const sep = multiline ? "\n" + indentAt(source, last.start) : " "
        ms.appendLeft(last.end, sep + attrToCode(name, value, elIndent))
      } else {
        const after = opening.typeParameters?.end ?? opening.name.end
        ms.appendLeft(after, " " + attrToCode(name, value, elIndent))
      }
    }
  }
  return { source: ms.toString(), template: isTemplate(ancestors) }
}

// --- element text -----------------------------------------------------------------

/** Replace the text content of a text-bearing element. */
export function setText(source: string, src: number, text: string): PatchResult {
  const { node, ancestors } = locate(source, src)
  const ms = new MagicString(source)
  const indent = indentAt(source, node.start)
  const inner = indent + "  "
  const name = tagName(source, node)
  const kids: Node[] = node.children
  const meaningful = kids.filter((k) => !(k.type === "JSXText" && !k.value.trim()))

  let style: "text" | "template" = "text"
  if (meaningful.length === 1 && meaningful[0].type === "JSXExpressionContainer") {
    const e = meaningful[0].expression
    if (e.type === "TemplateLiteral" && e.expressions.length === 0) style = "template"
    else if (e.type !== "StringLiteral") throw new PatchError("This text is computed in code. Edit it in the code view.")
  } else if (meaningful.some((k) => k.type !== "JSXText")) {
    throw new PatchError("This text mixes code and text. Edit it in the code view.")
  }

  let body: string
  if (style === "template") {
    const escaped = text.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${")
    body = `{\`${escaped}\`}`
  } else {
    const wasMultiline = kids.some((k) => k.type === "JSXText" && k.value.includes("\n") && k.value.trim())
    const lines = escapeJsxText(text).split("\n")
    body = lines.length > 1 || wasMultiline || text.length > 60
      ? "\n" + lines.map((l) => (l ? inner + l : "")).join("\n") + "\n" + indent
      : lines[0]
  }

  if (node.openingElement.selfClosing) {
    const opening = node.openingElement
    // "<Text ... />" -> "<Text ...>body</Text>"
    const closeStart = source.lastIndexOf("/", opening.end)
    let s = closeStart
    while (/\s/.test(source[s - 1])) s--
    ms.overwrite(s, opening.end, `>${body}</${name}>`)
  } else {
    const from = node.openingElement.end
    const to = node.closingElement.start
    if (from === to) ms.appendLeft(from, body)
    else ms.overwrite(from, to, body)
  }
  return { source: ms.toString(), template: isTemplate(ancestors) }
}

// --- slides -------------------------------------------------------------------------

function deckSlides(source: string, deckSrc: number) {
  const { node } = locate(source, deckSrc)
  const kids: Node[] = node.children
  const bad = kids.find((k) => k.type === "JSXExpressionContainer" && k.expression.type !== "JSXEmptyExpression")
  if (bad) throw new PatchError("Slides are generated by code, so they can't be rearranged visually. Edit the code view.")
  const slides = kids.filter((k) => k.type === "JSXElement")
  const open = node.openingElement.end
  const chunks = slides.map((s, i) => ({ start: i === 0 ? open : slides[i - 1].end, end: s.end, node: s }))
  return { deck: node, slides, chunks, open }
}

function slideIndent(source: string, deck: Node, slides: Node[]) {
  return slides.length ? indentAt(source, slides[0].start) : indentAt(source, deck.start) + "  "
}

/** Re-indent a code snippet so its first line can sit at `indent`. */
export function reindent(code: string, indent: string) {
  const lines = code.replace(/\t/g, "  ").split("\n")
  while (lines.length && !lines[0].trim()) lines.shift()
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
  const min = Math.min(...lines.filter((l) => l.trim()).map((l) => /^ */.exec(l)![0].length))
  return lines.map((l, i) => (i === 0 ? l.trimStart() : l.trim() ? indent + l.slice(min) : "")).join("\n")
}

export function moveSlide(source: string, deckSrc: number, from: number, to: number): PatchResult {
  const { chunks } = deckSlides(source, deckSrc)
  if (from === to || from < 0 || from >= chunks.length) return { source }
  const texts = chunks.map((c) => source.slice(c.start, c.end))
  // The first chunk may not start with a newline; normalize so every chunk does.
  const sep = /^\s*/.exec(texts[1] ?? texts[0])![0]
  const norm = texts.map((t) => sep + t.replace(/^\s*/, ""))
  const [moved] = norm.splice(from, 1)
  norm.splice(Math.max(0, Math.min(to, norm.length)), 0, moved)
  const start = chunks[0].start
  const end = chunks[chunks.length - 1].end
  return { source: source.slice(0, start) + norm.join("") + source.slice(end) }
}

export function insertSlide(source: string, deckSrc: number, index: number, code: string): PatchResult {
  const { deck, slides, open } = deckSlides(source, deckSrc)
  const indent = slideIndent(source, deck, slides)
  const at = index <= 0 ? open : slides[Math.min(index, slides.length) - 1].end
  const ms = new MagicString(source)
  let text = "\n" + indent + reindent(code, indent)
  if (!slides.length && !source.slice(open, deck.closingElement.start).includes("\n")) text += "\n" + indentAt(source, deck.start)
  ms.appendLeft(at, text)
  return { source: ms.toString() }
}

export function removeSlide(source: string, deckSrc: number, index: number): PatchResult {
  const { chunks } = deckSlides(source, deckSrc)
  const c = chunks[index]
  if (!c) return { source }
  return { source: source.slice(0, c.start) + source.slice(c.end) }
}

export function replaceSlide(source: string, deckSrc: number, index: number, code: string): PatchResult {
  const { slides } = deckSlides(source, deckSrc)
  const s = slides[index]
  if (!s) throw new PatchError(`No slide ${index + 1}`)
  const indent = indentAt(source, s.start)
  return { source: source.slice(0, s.start) + reindent(code, indent) + source.slice(s.end) }
}

export function duplicateSlide(source: string, deckSrc: number, index: number): PatchResult {
  const { slides } = deckSlides(source, deckSrc)
  const s = slides[index]
  if (!s) return { source }
  let code = source.slice(s.start, s.end)
  code = code.replace(/(<Slide\b[^>]*?\bid=")([^"]*)"/, (_m, a, id) => `${a}${id}-copy"`)
  const indent = indentAt(source, s.start)
  return { source: source.slice(0, s.end) + "\n" + indent + code + source.slice(s.end) }
}

export function slideCode(source: string, deckSrc: number, index: number): string {
  const { slides } = deckSlides(source, deckSrc)
  const s = slides[index]
  if (!s) throw new PatchError(`No slide ${index + 1}`)
  return dedentText(" ".repeat(s.start - lineStart(source, s.start)) + source.slice(s.start, s.end))
}

// --- elements -------------------------------------------------------------------------

/** Append an element (as code) to a slide or container element. Inserted before <Notes> if present. */
export function insertElement(source: string, parentSrc: number, code: string): PatchResult {
  const { node } = locate(source, parentSrc)
  const ms = new MagicString(source)
  const indent = indentAt(source, node.start)
  const kids: Node[] = node.children.filter((k: Node) => k.type === "JSXElement")
  const childIndent = kids.length ? indentAt(source, kids[0].start) : indent + "  "
  const snippet = reindent(code, childIndent)
  if (node.openingElement.selfClosing) {
    const name = tagName(source, node)
    let s = source.lastIndexOf("/", node.openingElement.end)
    while (/\s/.test(source[s - 1])) s--
    ms.overwrite(s, node.end, `>\n${childIndent}${snippet}\n${indent}</${name}>`)
    return { source: ms.toString() }
  }
  const notes = kids.find((k) => tagName(source, k) === "Notes")
  const lastEl = [...kids].reverse().find((k) => k !== notes)
  if (notes && (!lastEl || lastEl.start < notes.start)) {
    ms.appendLeft(notes.start, `${snippet}\n${childIndent}`)
  } else {
    const at = lastEl ? lastEl.end : node.openingElement.end
    ms.appendLeft(at, `\n${childIndent}${snippet}` + (lastEl ? "" : `\n${indent}`))
  }
  return { source: ms.toString() }
}

export function removeElement(source: string, src: number): PatchResult {
  const { node, ancestors } = locate(source, src)
  if (isTemplate(ancestors)) throw new PatchError("This element is generated by code (a component or loop). Remove it in the code view.")
  let start = node.start
  let end = node.end
  const ls = lineStart(source, start)
  if (!source.slice(ls, start).trim()) {
    const nl = source.indexOf("\n", end)
    const tail = nl === -1 ? source.slice(end) : source.slice(end, nl)
    if (!tail.trim()) {
      start = ls
      end = nl === -1 ? source.length : nl + 1
    }
  }
  return { source: source.slice(0, start) + source.slice(end) }
}

export function duplicateElement(source: string, src: number, offset: { x?: number; y?: number } = {}): PatchResult {
  const { node } = locate(source, src)
  const indent = indentAt(source, node.start)
  let code = source.slice(node.start, node.end)
  let out = source.slice(0, node.end) + "\n" + indent + code + source.slice(node.end)
  if (offset.x != null || offset.y != null) {
    const copyStart = node.end + 1 + indent.length
    out = setProps(out, copyStart, offset).source
  }
  return { source: out }
}

/** Build code for a new element. */
export function elementCode(type: string, props: Record<string, unknown> = {}, text?: string): string {
  const tag = TAGS[type] ?? type
  const attrs = Object.entries(props).filter(([, v]) => v !== undefined).map(([k, v]) => attrToCode(k, v))
  const open = `<${tag}${attrs.length ? " " + attrs.join(" ") : ""}`
  if (text == null || text === "") return `${open} />`
  const lines = escapeJsxText(text).split("\n")
  return lines.length > 1 ? `${open}>\n${lines.map((l) => "  " + l).join("\n")}\n</${tag}>` : `${open}>${lines[0]}</${tag}>`
}

/** Apply exact-match string replacements (the AI's surgical edit primitive). */
export function applyEdits(source: string, edits: { old: string; new: string }[]): string {
  let out = source
  for (const [i, e] of edits.entries()) {
    const first = out.indexOf(e.old)
    if (!e.old || first === -1) throw new PatchError(`Edit ${i + 1}: text to replace was not found. Copy it exactly from the current source.`)
    if (out.indexOf(e.old, first + 1) !== -1) throw new PatchError(`Edit ${i + 1}: text to replace appears more than once; include more surrounding lines.`)
    out = out.slice(0, first) + e.new + out.slice(first + e.old.length)
  }
  return out
}

// --- source <-> model lookup ------------------------------------------------------

/** Start offset of the innermost JSX element containing `offset` (for code → canvas selection). */
export function elementAtOffset(source: string, offset: number): number[] {
  const chain: number[] = []
  try {
    walk(parseSource(source), (n) => {
      if (n.end < offset || n.start > offset) return false
      if (n.type === "JSXElement") chain.push(n.start)
    })
  } catch { /* unparsable while typing */ }
  return chain
}

/** Source range of the element starting at `src` (for canvas → code highlighting). */
export function elementRange(source: string, src: number): { start: number; end: number } | undefined {
  try {
    const hit = findElementAt(parseSource(source), src)
    return hit && { start: hit.node.start, end: hit.node.end }
  } catch { return undefined }
}
