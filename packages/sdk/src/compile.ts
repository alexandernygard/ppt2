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
import { isPNode, flatten, type PNode, type Child } from "./runtime"
import { collectComponents, type ComponentInfo } from "./registry"
import { resolveTheme } from "./themes"
import { layouts } from "./layouts"
import type { CompileResult, ComponentDef, DeckModel, Diagnostic, ElementNode, ElementType, InstanceInfo, LayoutName, SlideNode, Aspect, Theme } from "./types"

const ASPECTS: Record<Aspect, number> = { "16:9": 1920, "4:3": 1440, "16:10": 1728, "1:1": 1080 }
const TEXT_TYPES = new Set(["title", "subtitle", "text", "code", "quote", "shape", "notes", "stat", "step", "node"])
const CONTAINER_TYPES = new Set(["row", "column", "card", "flow", "tree", "timeline", "cycle", "node"])
const ELEMENT_TYPES = new Set<string>(["title", "subtitle", "text", "list", "image", "shape", "chart", "table", "code", "stat", "quote", "row", "column", "card", "icon", "flow", "tree", "timeline", "cycle", "step", "node", "slot"])
/** Diagrams only accept their own item type as children. */
const ITEM_OF: Record<string, string> = { flow: "step", timeline: "step", cycle: "step", tree: "node", node: "node" }
const DIAGRAM_OF: Record<string, string> = { step: "<Flow>, <Timeline> or <Cycle>", node: "<Tree>" }

export function instrument(source: string): string {
  const ast = parseSource(source)
  const ms = new MagicString(source)
  walk(ast, (n, ancestors) => {
    // const Callout = component(<…/>) → component(<…/>, options, { name: "Callout", src }), so the model knows its name.
    if (n.type === "CallExpression" && n.callee.type === "Identifier" && n.callee.name === "component" && n.arguments.length && n.arguments.length <= 2) {
      const decl = ancestors[ancestors.length - 1]
      if (decl?.type === "VariableDeclarator" && decl.id.type === "Identifier") {
        const args: Node[] = n.arguments
        ms.appendLeft(args[args.length - 1].end, `${args.length === 1 ? ", undefined" : ""}, { name: ${JSON.stringify(decl.id.name)}, src: ${n.start} }`)
      }
    }
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
  let defined: ComponentInfo[] = []
  try {
    const module = { exports: {} as any }
    const require = (name: string) => {
      if (name === "ppt2" || name === "@ppt2/sdk") return runtime
      throw new Error(`Cannot import "${name}". Deck code can only import from "ppt2".`)
    }
    const names = Object.keys(runtime).filter((k) => /^[A-Za-z_$][\w$]*$/.test(k) && k !== "h" && k !== "Fragment")
    const fn = new Function("require", "module", "exports", "h", "Fragment", ...names, code)
    defined = collectComponents(() => fn(require, module, module.exports, runtime.h, runtime.Fragment, ...names.map((k) => (runtime as any)[k]))).components
    value = module.exports.default ?? module.exports.deck
  } catch (e: any) {
    errors.push({ severity: "error", message: `Runtime error: ${e.message}` })
    return { errors, warnings }
  }

  if (!isPNode(value) || value.type !== "deck") {
    errors.push({ severity: "error", message: "The module must `export default` a <Deck> element." })
    return { errors, warnings }
  }
  const deck = normalizeDeck(value, source, warnings, defined)
  return { deck, errors, warnings }
}

function cleanMessage(m: string) {
  return m.replace(/\s*\(\d+:\d+\)\s*$/, "")
}

export function normalizeDeck(node: PNode, source = "", warnings: Diagnostic[] = [], defined: ComponentInfo[] = []): DeckModel {
  const p = node.props
  const aspect: Aspect = p.aspect in ASPECTS ? p.aspect : "16:9"
  const warn = (message: string, src?: number, slide?: number) => {
    const loc = src != null && source ? lineCol(source, src) : undefined
    warnings.push({ severity: "warning", message, line: loc?.line, column: loc?.column, slide })
  }
  // Theme JSX (master elements, layout elements) normalizes like slide content, under its own paths.
  const elementsOf = (jsx: unknown, prefix: string) => {
    const out: ElementNode[] = []
    for (const child of flatten([jsx])) {
      const el = normalizeElement(child, `${prefix}/${out.length}`, { warn })
      if (el) out.push(el)
    }
    return out
  }
  const { theme, warning } = resolveTheme(p.theme, elementsOf)
  if (warning) for (const message of warning.split("\n")) warnings.push({ severity: "warning", message })

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
    slides.push(normalizeSlide(child, slides.length, warn, theme))
  }

  const uses = new Map<string, number>()
  const count = (els: ElementNode[]) => {
    for (const el of els) {
      if (el.instance) uses.set(el.instance.name, (uses.get(el.instance.name) ?? 0) + 1)
      if (el.children) count(el.children)
    }
  }
  slides.forEach((s) => count(s.elements))
  const components: ComponentDef[] = defined.map((info, i) => {
    const roots = info.template.filter(isPNode)
    const template = roots.length ? normalizeElement(roots[0], `c/${i}`, { warn, owner: info.name, template: true }) : undefined
    if (roots.length !== 1) warn(`${info.name}: a component needs exactly one root element${roots.length ? ", such as a <Card> or <Column> around the rest" : ""}`, info.src)
    return { name: info.name, src: info.src, description: info.description, template, uses: uses.get(info.name) ?? 0 }
  })

  return {
    title: p.title ?? slides[0]?.elements.find((e) => e.type === "title")?.text ?? "Untitled deck",
    aspect,
    width: ASPECTS[aspect],
    height: 1080,
    theme,
    themeInput: p.theme ?? "snow",
    slides,
    components,
    src: node.src,
    props: p,
  }
}

function normalizeSlide(node: PNode, index: number, warn: (m: string, src?: number, slide?: number) => void, theme: Theme): SlideNode {
  const { layout: rawLayout, id, notes: notesProp, ...own } = node.props
  let layout: LayoutName = rawLayout ?? "content"
  let props: Record<string, unknown> = own
  const themeLayout = theme.layouts?.[rawLayout]
  if (themeLayout) {
    layout = themeLayout.base
    props = { ...themeLayout.props, ...own }
  } else if (!(layout in layouts)) {
    const names = [...Object.keys(theme.layouts ?? {}), ...Object.keys(layouts)]
    warn(`Unknown layout "${rawLayout}". Layouts: ${names.join(", ")}`, node.src, index)
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
    const el = normalizeElement(child, `${index}/${elements.length}`, { warn, slide: index })
    if (el) elements.push(el)
  }
  return {
    index,
    id: id ?? `slide-${index + 1}`,
    src: node.src,
    layout,
    ...(themeLayout ? { themeLayout: themeLayout.name } : {}),
    props,
    elements,
    notes,
    notesSrc,
  }
}

type Warn = (m: string, src?: number, slide?: number) => void

interface Ctx {
  warn: Warn
  slide?: number
  /** Type of the containing element. */
  parent?: string
  /** The component whose definition this element belongs to. */
  owner?: string
  /** Normalizing a component's definition: <Slot /> stays as an element. */
  template?: boolean
  depth?: number
}

/** A <Slot /> filled with an instance's children, while the instance expands. */
interface FilledSlot extends PNode {
  type: "$slot"
  owner?: string
  template?: boolean
  info: { path?: string; index: number; count: number }
}

function normalizeElement(child: Child, path: string, ctx: Ctx): ElementNode | undefined {
  const { warn, slide, parent } = ctx
  const item = parent ? ITEM_OF[parent] : undefined
  if (!isPNode(child)) {
    const text = String(child).trim()
    if (item) return undefined // a node's label, handled by the parent
    return text ? { type: "text", path, props: {}, text, ...(ctx.owner ? { component: ctx.owner } : {}) } : undefined
  }
  if (child.type === "instance" && child.component) return normalizeInstance(child, path, ctx)
  if (!ELEMENT_TYPES.has(child.type)) {
    warn(`Unknown element <${child.type}>`, child.src, slide)
    return undefined
  }
  if (child.type === "slot") {
    if (!ctx.template) warn("<Slot /> only works inside a component(…) definition", child.src, slide)
    return ctx.template ? { type: "slot", path, src: child.src, props: {}, component: ctx.owner } : undefined
  }
  if (item && child.type !== item) {
    warn(`<${parent}> can only contain <${item === "step" ? "Step" : "Node"}> elements, not <${child.type}>`, child.src, slide)
    return undefined
  }
  if (!item && DIAGRAM_OF[child.type]) {
    warn(`<${child.type === "step" ? "Step" : "Node"}> must be inside ${DIAGRAM_OF[child.type]}`, child.src, slide)
    return undefined
  }
  const type = child.type as ElementType
  const el: ElementNode = { type, path, src: child.src, props: { ...child.props }, ...(ctx.owner ? { component: ctx.owner } : {}) }
  if (CONTAINER_TYPES.has(type)) {
    el.children = []
    const addAll = (kids: Child[], owner: string | undefined, template: boolean | undefined) => {
      for (const c of kids) {
        if (isPNode(c) && c.type === "$slot") {
          // An instance's children: they belong to whoever wrote the instance, not to the component.
          const slot = c as FilledSlot
          const before = el.children!.length
          slot.info.path = path
          slot.info.index = before
          addAll(slot.children, slot.owner, slot.template)
          slot.info.count = el.children!.length - before
          continue
        }
        const n = normalizeElement(c, `${path}/${el.children!.length}`, { ...ctx, parent: type, owner, template })
        if (n) el.children!.push(n)
      }
    }
    addAll(child.children, ctx.owner, ctx.template)
  }
  if (TEXT_TYPES.has(type)) {
    el.text = CONTAINER_TYPES.has(type) ? textOf(child.children).trim() : textOf(child.children)
    if (!CONTAINER_TYPES.has(type) && child.children.some((c) => isPNode(c) && c.type !== "$slot")) warn(`<${type}> can only contain text`, child.src, slide)
  }
  if (type === "list" && !Array.isArray(el.props.items)) {
    // Allow <List>{"a\nb"}</List> as a shorthand.
    const text = textOf(child.children)
    el.props.items = text ? text.split("\n").map((l) => l.replace(/^\s*[-*•]\s*/, "")).filter(Boolean) : []
  }
  if (type === "chart" && !Array.isArray(el.props.data)) warn("<Chart> needs a data={[...]} array", child.src, slide)
  return el
}

/** Expand a component instance: its template, with the instance's children in place of <Slot />. */
function normalizeInstance(node: PNode, path: string, ctx: Ctx): ElementNode | undefined {
  const def = node.component!
  const depth = ctx.depth ?? 0
  if (depth > 16) { ctx.warn(`${def.name} uses itself`, node.src, ctx.slide); return undefined }
  const root = def.template.find(isPNode)
  if (!root) { ctx.warn(`${def.name} has no content`, node.src, ctx.slide); return undefined }
  const info: FilledSlot["info"] = { index: 0, count: 0 }
  let slots = 0
  const fill = (n: PNode): PNode => ({
    ...n,
    children: n.children.map((c) => {
      if (!isPNode(c)) return c
      if (c.type === "slot" && !slots++) return { $$ppt2: true, type: "$slot", props: {}, children: node.children, owner: ctx.owner, template: ctx.template, info } satisfies FilledSlot
      return fill(c)
    }),
  })
  // Props on the instance (position, size, build step…) win over the template root's.
  const expanded = fill({ ...root, props: { ...root.props, ...node.props } })
  if (!slots && node.children.some((c) => isPNode(c) || String(c).trim())) ctx.warn(`<${def.name}> has no <Slot />, so its children are not shown`, node.src, ctx.slide)
  const el = normalizeElement(expanded, path, { ...ctx, owner: def.name, depth: depth + 1, template: false })
  if (!el) return undefined
  const instance: InstanceInfo = { name: def.name, src: node.src }
  if (info.path) instance.slot = { path: info.path, index: info.index, count: info.count }
  el.instance = instance
  // The root is the instance itself: it belongs to whoever wrote <Callout>, not to Callout.
  if (ctx.owner) el.component = ctx.owner
  else delete el.component
  return el
}

function textOf(children: Child[]): string {
  return children.filter((c) => !isPNode(c)).map(String).join("")
}
