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
        // appendRight attaches to what follows the attribute, so it survives an overwrite of that attribute.
        ms.appendRight(last.end, sep + attrToCode(name, value, elIndent))
      } else {
        const after = opening.typeParameters?.end ?? opening.name.end
        ms.appendLeft(after, " " + attrToCode(name, value, elIndent))
      }
    }
  }
  return { source: ms.toString(), template: isTemplate(ancestors) }
}

// --- theme -------------------------------------------------------------------------

const keyName = (p: Node): string | undefined =>
  p.type === "ObjectProperty" && !p.computed ? (p.key.type === "Identifier" ? p.key.name : typeof p.key.value === "string" ? p.key.value : undefined) : undefined

/** The object literal a `theme={brand}` identifier points at (const brand = { ... }). */
function constObject(source: string, name: string): Node | undefined {
  let found: Node | undefined
  walk(parseSource(source), (n) => {
    if (found) return false
    if (n.type === "VariableDeclarator" && n.id.type === "Identifier" && n.id.name === name) {
      let init = n.init
      while (init && (init.type === "TSAsExpression" || init.type === "TSSatisfiesExpression")) init = init.expression
      if (init?.type === "ObjectExpression") found = init
      return false
    }
  })
  return found
}

/**
 * Set (or remove, with undefined) keys of the Deck's theme, keeping the rest as written.
 * A theme name becomes { base: name, ... }; an object only left with `base` turns back into the name.
 * Follows theme={brand} to `const brand = { ... }` so company templates can live in one place.
 */
export function setThemeProps(source: string, deckSrc: number, values: Record<string, unknown>): PatchResult {
  const { node } = locate(source, deckSrc)
  const attr = (node.openingElement.attributes as Node[]).find((a) => a.type === "JSXAttribute" && a.name.name === "theme")
  let name: string | undefined
  let obj: Node | undefined
  const v = attr?.value?.type === "JSXExpressionContainer" ? attr.value.expression : attr?.value
  if (v?.type === "StringLiteral") name = v.value
  else if (v?.type === "ObjectExpression") obj = v
  else if (v?.type === "Identifier") obj = constObject(source, v.name)
  if (attr && !obj && name == null) throw new PatchError("The theme is computed in code. Edit it in the code view.")

  if (!obj) {
    const theme: Record<string, unknown> = { base: name ?? "snow" }
    for (const [k, x] of Object.entries(values)) if (x !== undefined) theme[k] = x
    const keys = Object.keys(theme)
    return setProps(source, deckSrc, { theme: keys.length === 1 ? theme.base : theme })
  }

  const props: Node[] = obj.properties
  const ms = new MagicString(source)
  const multiline = source.slice(obj.start, obj.end).includes("\n")
  const indent = props.length ? indentAt(source, props[0].start) : indentAt(source, obj.start) + "  "
  const removed = new Set<number>()
  const added: [string, unknown][] = []
  for (const [k, x] of Object.entries(values)) {
    const i = props.findIndex((p) => keyName(p) === k)
    if (i === -1) { if (x !== undefined) added.push([k, x]); continue }
    if (x === undefined) { removed.add(i); continue }
    if (!isLiteral(props[i].value)) throw new PatchError(`theme.${k} is computed in code. Edit it in the code view.`)
    ms.overwrite(props[i].value.start, props[i].value.end, valueToCode(x, indent))
  }
  const kept = props.filter((_, i) => !removed.has(i))
  const finalKeys = [...kept.map(keyName), ...added.map(([k]) => k)]
  const baseProp = kept.find((p) => keyName(p) === "base")
  const baseValue = values.base ?? (baseProp && baseProp.value.type === "StringLiteral" ? baseProp.value.value : undefined)
  if (finalKeys.length === 1 && finalKeys[0] === "base" && typeof baseValue === "string" && v?.type === "ObjectExpression") {
    return setProps(source, deckSrc, { theme: baseValue })
  }
  if (!kept.length) {
    ms.overwrite(obj.start, obj.end, valueToCode(Object.fromEntries(added), indentAt(source, obj.start)))
    return { source: ms.toString() }
  }
  // Remove runs of properties together, so their commas go with them.
  for (let i = 0; i < props.length; i++) {
    if (!removed.has(i)) continue
    let j = i
    while (removed.has(j + 1)) j++
    if (j < props.length - 1) ms.remove(props[i].start, props[j + 1].start)
    else ms.remove(props[i - 1].end, props[j].end)
    i = j
  }
  if (added.length) {
    let at = obj.end - 1
    while (/\s/.test(source[at - 1])) at--
    const trailingComma = source[at - 1] === ","
    const code = added.map(([k, x]) => `${IDENT.test(k) ? k : JSON.stringify(k)}: ${valueToCode(x, indent)}`)
    const text = multiline
      ? (trailingComma ? "" : ",") + code.map((c) => `\n${indent}${c}`).join(",") + (trailingComma ? "," : "")
      : (trailingComma ? " " : ", ") + code.join(", ") + (trailingComma ? "," : "")
    ms.appendRight(at, text)
  }
  return { source: multiline ? ms.toString() : wrapLongObject(ms.toString(), obj.start) }
}

/** Break an inline object literal that grew too long into one property per line. */
function wrapLongObject(source: string, start: number): string {
  let obj: Node | undefined
  walk(parseSource(source), (n) => {
    if (obj || n.end < start || n.start > start) return false
    if (n.type === "ObjectExpression" && n.start === start) { obj = n; return false }
  })
  if (!obj || obj.end - obj.start <= 80 || source.slice(obj.start, obj.end).includes("\n")) return source
  const indent = indentAt(source, start)
  const props = (obj.properties as Node[]).map((p) => `${indent}  ${source.slice(p.start, p.end)},`)
  return source.slice(0, obj.start) + `{\n${props.join("\n")}\n${indent}}` + source.slice(obj.end)
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
  } else if (meaningful.some((k) => k.type === "JSXElement") && meaningful.every((k) => k.type === "JSXText" || k.type === "JSXElement")) {
    // A label followed by nested elements (<Node>CEO<Node>…</Node></Node>): replace only the leading label.
    const first = kids.find((k) => k.type === "JSXElement")!
    const label = escapeJsxText(text.replace(/\s*\n\s*/g, " ").trim())
    ms.overwrite(node.openingElement.end, first.start, label ? `\n${inner}${label}\n${inner}` : `\n${inner}`)
    return { source: ms.toString(), template: isTemplate(ancestors) }
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

/**
 * Insert an element (as code) into a slide or container element: before its `index`-th child element,
 * or at the end (before <Notes>, if present) when `index` is omitted.
 */
export function insertElement(source: string, parentSrc: number, code: string, index?: number): PatchResult {
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
  const placed = kids.filter((k) => k !== notes)
  if (index != null && index >= 0 && index < placed.length) {
    ms.appendLeft(placed[index].start, `${snippet}\n${childIndent}`)
    return { source: ms.toString() }
  }
  const lastEl = placed[placed.length - 1]
  if (notes && (!lastEl || lastEl.start < notes.start)) {
    ms.appendLeft(notes.start, `${snippet}\n${childIndent}`)
  } else {
    // Text children (a Node's label) stay before the inserted element.
    const lastText = [...(node.children as Node[])].reverse().find((k) => k.type === "JSXText" && k.value.trim())
    const at = Math.max(lastEl?.end ?? node.openingElement.end, lastText ? lastText.start + lastText.value.trimEnd().length : 0)
    ms.appendLeft(at, `\n${childIndent}${snippet}` + (source.slice(at, node.closingElement.start).includes("\n") ? "" : `\n${indent}`))
  }
  return { source: ms.toString() }
}

/** The element's code, dedented as if it started at column 0. */
export function elementSource(source: string, src: number): string {
  const { node } = locate(source, src)
  return dedentText(" ".repeat(node.start - lineStart(source, node.start)) + source.slice(node.start, node.end))
}

/**
 * Move an element into `parentSrc` (a slide or container), before its `index`-th child element
 * (counted before the move), or to the end when `index` is omitted.
 */
export function moveElement(source: string, src: number, parentSrc: number, index?: number): PatchResult {
  const { node, ancestors } = locate(source, src)
  if (isTemplate(ancestors)) throw new PatchError("This element is generated by code (a loop or function). Move it in the code view.")
  if (parentSrc >= node.start && parentSrc < node.end) throw new PatchError("Can't move an element into itself.")
  const parent = locate(source, parentSrc).node
  const siblings: Node[] = parent.children.filter((k: Node) => k.type === "JSXElement" && tagName(source, k) !== "Notes")
  const from = siblings.findIndex((k) => k.start === node.start)
  if (from !== -1 && index != null && (index === from || index === from + 1)) return { source }
  if (from !== -1 && index == null && from === siblings.length - 1) return { source }
  const code = elementSource(source, src)
  const removed = removeElement(source, src).source
  const shift = source.length - removed.length
  const target = parentSrc > node.start ? parentSrc - shift : parentSrc
  const at = index != null && from !== -1 && from < index ? index - 1 : index
  return insertElement(removed, target, code, at)
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

// --- components ---------------------------------------------------------------------------

/** `const X = component(…)` declarations, in source order. */
function componentDecls(source: string): { name: string; statement: Node; call: Node; id: Node }[] {
  const out: { name: string; statement: Node; call: Node; id: Node }[] = []
  for (const st of parseSource(source).program.body as Node[]) {
    const decl = st.type === "ExportNamedDeclaration" ? st.declaration : st
    if (decl?.type !== "VariableDeclaration") continue
    for (const d of decl.declarations as Node[]) {
      if (d.id.type === "Identifier" && d.init?.type === "CallExpression" && d.init.callee.type === "Identifier" && d.init.callee.name === "component") {
        out.push({ name: d.id.name, statement: st, call: d.init, id: d.id })
      }
    }
  }
  return out
}

const COMPONENT_NAME = /^[A-Z][A-Za-z0-9]*$/

/** Turn "my callout" into "MyCallout". Returns "" when nothing usable is left. */
export function componentName(input: string): string {
  return input.replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : "")).replace(/^[^A-Za-z]+/, "").replace(/^./, (c) => c.toUpperCase())
}

function checkName(source: string, name: string) {
  if (!COMPONENT_NAME.test(name)) throw new PatchError("Component names start with a capital letter and use only letters and digits, like Callout or PriceCard.")
  if (TAGS[name.toLowerCase()] === name || ["Deck", "Slide", "Notes", "Slot", "Fragment"].includes(name)) throw new PatchError(`${name} is a built-in element. Pick another name.`)
  const taken = new Set<string>()
  walk(parseSource(source), (n) => {
    if (n.type === "VariableDeclarator" && n.id.type === "Identifier") taken.add(n.id.name)
    if ((n.type === "FunctionDeclaration" || n.type === "ClassDeclaration") && n.id) taken.add(n.id.name)
    if (n.type === "ImportSpecifier") taken.add(n.local.name)
  })
  if (taken.has(name)) throw new PatchError(`The code already has something called ${name}.`)
}

/** Define a new component from JSX code, after the other components (or before the deck). */
export function defineComponent(source: string, name: string, code: string): PatchResult {
  checkName(source, name)
  const decls = componentDecls(source)
  const body = parseSource(source).program.body as Node[]
  const anchor = decls[decls.length - 1]?.statement
  const text = `const ${name} = component(\n  ${reindent(code, "  ")}\n)\n`
  if (anchor) return { source: source.slice(0, anchor.end) + "\n\n" + text.trimEnd() + source.slice(anchor.end) }
  const before = body.find((st) => st.type === "ExportDefaultDeclaration") ?? body.find((st) => st.type !== "ImportDeclaration")
  const at = before ? before.start : source.length
  return { source: source.slice(0, at) + text + "\n" + source.slice(at) }
}

const INSTANCE_PROPS = ["x", "y", "w", "h", "slot", "step", "animate", "rotate", "id"]

/**
 * Make the element at `src` a component: its code becomes the definition (with a <Slot /> at the end
 * when `slot` is set and the root is a container), and the element becomes an instance that keeps
 * its position, size and build step.
 */
export function componentFromElement(source: string, src: number, name: string, opts: { slot?: boolean } = {}): PatchResult {
  checkName(source, name)
  const { node, ancestors } = locate(source, src)
  if (isTemplate(ancestors)) throw new PatchError("This element is generated by code. Make the component in the code view.")
  const attrs: Node[] = node.openingElement.attributes
  const keep: Record<string, unknown> = {}
  for (const a of attrs) {
    if (a.type !== "JSXAttribute" || !INSTANCE_PROPS.includes(a.name.name)) continue
    if (!isLiteral(a.value)) throw new PatchError(`"${a.name.name}" is computed in code. Make the component in the code view.`)
    keep[a.name.name] = a.value == null ? true : literalValue(a.value)
  }
  let template = elementSource(source, src)
  if (Object.keys(keep).length) template = setProps(template, 0, Object.fromEntries(Object.keys(keep).map((k) => [k, undefined]))).source
  if (opts.slot) template = insertElement(template, 0, "<Slot />").source
  const instance = elementCode(name, keep)
  const replaced = source.slice(0, node.start) + instance + source.slice(node.end)
  return defineComponent(replaced, name, template)
}

function literalValue(n: Node): unknown {
  if (n.type === "JSXExpressionContainer") return literalValue(n.expression)
  if (n.type === "UnaryExpression") return -literalValue(n.argument)!
  if (n.type === "NullLiteral") return null
  if (n.type === "TemplateLiteral") return n.quasis.map((q: Node) => q.value.cooked).join("")
  if (n.type === "ArrayExpression") return n.elements.map(literalValue)
  if (n.type === "ObjectExpression") return Object.fromEntries(n.properties.map((p: Node) => [p.key.name ?? p.key.value, literalValue(p.value)]))
  return n.value
}

/** Rename a component: its declaration and every <Old>…</Old> that uses it. */
export function renameComponent(source: string, from: string, to: string): PatchResult {
  if (from === to) return { source }
  checkName(source, to)
  const decl = componentDecls(source).find((d) => d.name === from)
  if (!decl) throw new PatchError(`No component called ${from}.`)
  const ms = new MagicString(source)
  ms.overwrite(decl.id.start, decl.id.end, to)
  walk(parseSource(source), (n) => {
    if ((n.type === "JSXOpeningElement" || n.type === "JSXClosingElement") && n.name.type === "JSXIdentifier" && n.name.name === from) ms.overwrite(n.name.start, n.name.end, to)
    if (n.type === "Identifier" && n.name === from && n !== decl.id && n.start !== decl.id.start) ms.overwrite(n.start, n.end, to)
  })
  return { source: ms.toString() }
}

/** Remove a component's definition. Refused while slides still use it. */
export function removeComponent(source: string, name: string): PatchResult {
  const decl = componentDecls(source).find((d) => d.name === name)
  if (!decl) throw new PatchError(`No component called ${name}.`)
  let used = false
  walk(parseSource(source), (n) => {
    if (n.type === "JSXOpeningElement" && n.name.type === "JSXIdentifier" && n.name.name === name) used = true
  })
  if (used) throw new PatchError(`${name} is still used. Remove its uses first.`)
  let { start, end } = decl.statement
  while (start > 0 && source[start - 1] === "\n" && source[start - 2] === "\n") start--
  if (source[end] === "\n") end++
  return { source: source.slice(0, start) + source.slice(end) }
}
