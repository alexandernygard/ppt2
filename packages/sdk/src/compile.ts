// Compile ppt2 source (TSX) into a Deck model.
//
// 1. Parse with Babel to get exact source offsets.
// 2. Instrument: every JSX element gets __src={offset}, so each model node
//    knows where it came from. Pure-text children become a dedented string
//    literal so Markdown-ish line breaks survive JSX whitespace rules.
// 3. Transform TS/JSX with sucrase and execute against the ppt2 runtime.
// 4. Normalize the element tree into the typed Deck model.

import MagicString from "magic-string"
import { transform } from "sucrase"
import { parseSource, walk, dedentText, lineCol, type Node } from "./ast"
import * as runtime from "./runtime"
import { isPNode, type PNode, type Child } from "./runtime"
import { resolveTheme } from "./themes"
import { layouts } from "./layouts"
import type { CompileResult, DeckModel, Diagnostic, ElementNode, ElementType, LayoutName, SlideNode, Aspect } from "./types"

const ASPECTS: Record<Aspect, number> = { "16:9": 1920, "4:3": 1440, "16:10": 1728, "1:1": 1080 }
const TEXT_TYPES = new Set(["title", "subtitle", "text", "code", "quote", "shape", "notes", "stat"])
const CONTAINER_TYPES = new Set(["row", "column", "card"])
const ELEMENT_TYPES = new Set<string>(["title", "subtitle", "text", "list", "image", "shape", "chart", "table", "code", "stat", "quote", "row", "column", "card"])

export function instrument(source: string): string {
  const ast = parseSource(source)
  const ms = new MagicString(source)
  walk(ast, (n) => {
    if (n.type !== "JSXElement") return
    const opening = n.openingElement
    const after = opening.typeParameters?.end ?? opening.name.end
    ms.appendLeft(after, ` __src={${n.start}}`)
    const kids: Node[] = n.children
    if (kids.length && kids.every((c) => c.type === "JSXText") && kids.some((c) => c.value.trim())) {
      const text = dedentText(kids.map((c) => c.value).join(""))
      ms.overwrite(kids[0].start, kids[kids.length - 1].end, `{${JSON.stringify(text)}}`)
    }
  })
  return ms.toString()
}

export function compile(source: string): CompileResult {
  const errors: Diagnostic[] = []
  const warnings: Diagnostic[] = []
  let code: string
  try {
    code = transform(instrument(source), {
      transforms: ["typescript", "jsx", "imports"],
      jsxPragma: "h",
      jsxFragmentPragma: "Fragment",
      production: true,
    }).code
  } catch (e: any) {
    const loc = e.loc ?? (typeof e.pos === "number" ? lineCol(source, e.pos) : undefined)
    errors.push({ severity: "error", message: cleanMessage(e.message), line: loc?.line, column: loc?.column != null ? loc.column + (e.loc ? 1 : 0) : undefined })
    return { errors, warnings }
  }

  let value: unknown
  try {
    const module = { exports: {} as any }
    const require = (name: string) => {
      if (name === "ppt2" || name === "@ppt2/sdk") return runtime
      throw new Error(`Cannot import "${name}". Deck code can only import from "ppt2".`)
    }
    const names = Object.keys(runtime).filter((k) => /^[A-Za-z_$][\w$]*$/.test(k) && k !== "h" && k !== "Fragment")
    const fn = new Function("require", "module", "exports", "h", "Fragment", ...names, code)
    fn(require, module, module.exports, runtime.h, runtime.Fragment, ...names.map((k) => (runtime as any)[k]))
    value = module.exports.default ?? module.exports.deck
  } catch (e: any) {
    errors.push({ severity: "error", message: `Runtime error: ${e.message}` })
    return { errors, warnings }
  }

  if (!isPNode(value) || value.type !== "deck") {
    errors.push({ severity: "error", message: "The module must `export default` a <Deck> element." })
    return { errors, warnings }
  }
  const deck = normalizeDeck(value, source, warnings)
  return { deck, errors, warnings }
}

function cleanMessage(m: string) {
  return m.replace(/\s*\(\d+:\d+\)\s*$/, "")
}

export function normalizeDeck(node: PNode, source = "", warnings: Diagnostic[] = []): DeckModel {
  const p = node.props
  const { theme, warning } = resolveTheme(p.theme)
  if (warning) warnings.push({ severity: "warning", message: warning })
  const aspect: Aspect = p.aspect in ASPECTS ? p.aspect : "16:9"
  const warn = (message: string, src?: number, slide?: number) => {
    const loc = src != null && source ? lineCol(source, src) : undefined
    warnings.push({ severity: "warning", message, line: loc?.line, column: loc?.column, slide })
  }

  const slides: SlideNode[] = []
  for (const child of node.children) {
    if (!isPNode(child)) {
      if (String(child).trim()) warn(`Text directly inside <Deck> is ignored: "${String(child).slice(0, 40)}"`)
      continue
    }
    if (child.type !== "slide") {
      warn(`<${child.type}> must be inside a <Slide>`, child.src)
      continue
    }
    slides.push(normalizeSlide(child, slides.length, warn))
  }

  return {
    title: p.title ?? slides[0]?.elements.find((e) => e.type === "title")?.text ?? "Untitled deck",
    aspect,
    width: ASPECTS[aspect],
    height: 1080,
    theme,
    themeInput: p.theme ?? "snow",
    slides,
    src: node.src,
    props: p,
  }
}

function normalizeSlide(node: PNode, index: number, warn: (m: string, src?: number, slide?: number) => void): SlideNode {
  const { layout: rawLayout, id, notes: notesProp, ...props } = node.props
  let layout: LayoutName = rawLayout ?? "content"
  if (!(layout in layouts)) {
    warn(`Unknown layout "${rawLayout}". Layouts: ${Object.keys(layouts).join(", ")}`, node.src, index)
    layout = "content"
  }
  let notes = typeof notesProp === "string" ? notesProp : ""
  let notesSrc: SlideNode["notesSrc"] = typeof notesProp === "string" && node.src != null ? { kind: "prop", src: node.src } : undefined
  const elements: ElementNode[] = []
  for (const child of node.children) {
    if (isPNode(child) && child.type === "notes") {
      notes = textOf(child.children)
      if (child.src != null) notesSrc = { kind: "element", src: child.src }
      continue
    }
    const el = normalizeElement(child, `${index}/${elements.length}`, warn, index)
    if (el) elements.push(el)
  }
  return {
    index,
    id: id ?? `slide-${index + 1}`,
    src: node.src,
    layout,
    props,
    elements,
    notes,
    notesSrc,
  }
}

function normalizeElement(child: Child, path: string, warn: (m: string, src?: number, slide?: number) => void, slide: number): ElementNode | undefined {
  if (!isPNode(child)) {
    const text = String(child).trim()
    return text ? { type: "text", path, props: {}, text } : undefined
  }
  if (!ELEMENT_TYPES.has(child.type)) {
    warn(`Unknown element <${child.type}>`, child.src, slide)
    return undefined
  }
  const type = child.type as ElementType
  const el: ElementNode = { type, path, src: child.src, props: { ...child.props } }
  if (CONTAINER_TYPES.has(type)) {
    el.children = []
    for (const c of child.children) {
      const n = normalizeElement(c, `${path}/${el.children.length}`, warn, slide)
      if (n) el.children.push(n)
    }
  } else if (TEXT_TYPES.has(type)) {
    el.text = textOf(child.children)
    if (child.children.some(isPNode)) warn(`<${type}> can only contain text`, child.src, slide)
  }
  if (type === "list" && !Array.isArray(el.props.items)) {
    // Allow <List>{"a\nb"}</List> as a shorthand.
    const text = textOf(child.children)
    el.props.items = text ? text.split("\n").map((l) => l.replace(/^\s*[-*•]\s*/, "")).filter(Boolean) : []
  }
  if (type === "chart" && !Array.isArray(el.props.data)) warn("<Chart> needs a data={[...]} array", child.src, slide)
  return el
}

function textOf(children: Child[]): string {
  return children.filter((c) => !isPNode(c)).map(String).join("")
}
