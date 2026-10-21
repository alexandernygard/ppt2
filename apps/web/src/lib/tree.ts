// The element tree as the canvas and the layers panel see it, mapped back to
// source: where an element's code lives, and where a dropped element goes.

import type { DeckModel, ElementNode, SlideNode } from "@ppt2/sdk"
import { findElement } from "@ppt2/react"

/** What is being dragged from the palette, the components list or the layers tree. */
export type DragItem =
  | { kind: "new"; type: string; code: string }
  | { kind: "component"; name: string }
  | { kind: "move"; path: string }

/** The slide-like root the canvas edits: a real slide, or a component's definition on its own. */
export function componentSlide(deck: DeckModel, name: string): SlideNode | undefined {
  const i = deck.components.findIndex((c) => c.name === name)
  const t = deck.components[i]?.template
  if (!t) return undefined
  return { index: -1 - i, id: `component-${name}`, layout: "blank", props: { master: false }, elements: [t], notes: "" }
}

/** Find an element by path: "<slide>/…" on a slide, "c/<i>/…" in a component's definition. */
export function elementAt(deck: DeckModel, path: string): ElementNode | undefined {
  if (path.startsWith("c/")) return findElement(deck.components.flatMap((c) => (c.template ? [c.template] : [])), path)
  const slide = deck.slides[Number(path.split("/")[0])]
  return slide && findElement(slide.elements, path)
}

/** Where the element's own code starts: the <Callout> tag for an instance, else the element. */
export const codeOf = (el: ElementNode) => el.instance?.src ?? el.src

/** The path of the element's parent in the model, or null for top-level elements. */
export function parentPath(path: string): string | null {
  const parts = path.split("/")
  return parts.length <= 2 ? null : parts.slice(0, -1).join("/")
}

/** The chain from the top-level element down to `path`. */
function chain(roots: ElementNode[], path: string): ElementNode[] {
  const out: ElementNode[] = []
  let els: ElementNode[] | undefined = roots
  while (els) {
    const hit: ElementNode | undefined = els.find((e) => e.path === path || path.startsWith(e.path + "/"))
    if (!hit) break
    out.push(hit)
    els = hit.path === path ? undefined : hit.children
  }
  return out
}

/** Elements written in this context: the slide (owner undefined) or the component being edited. */
export const owned = (el: ElementNode, owner: string | undefined) => el.component === owner

const DIAGRAM_ITEM: Record<string, string> = { flow: "step", timeline: "step", cycle: "step", tree: "node", node: "node" }
const CONTAINERS = new Set(["row", "column", "card", "flow", "timeline", "cycle", "tree", "node"])

/**
 * Where an element dropped into `parent` (a container's path, or null for the slide) before its
 * `index`-th child ends up in the source. undefined when that container can't take children here,
 * such as a part of a component while editing a slide.
 */
export function resolveDrop(slide: SlideNode, owner: string | undefined, parent: string | null, index: number): { parentSrc: number; index: number } | undefined {
  const count = (els: ElementNode[], end: number) => els.slice(0, end).filter((e) => codeOf(e) != null).length
  if (parent == null) {
    if (owner || slide.src == null) return undefined
    return { parentSrc: slide.src, index: count(slide.elements, index) }
  }
  const path = chain(slide.elements, parent)
  const el = path[path.length - 1]
  if (!el || el.path !== parent || !CONTAINERS.has(el.type)) return undefined
  // The container that holds an instance's children: drop into the instance (<Callout>…</Callout>).
  for (let i = path.length - 1; i >= 0; i--) {
    const inst = path[i].instance
    if (inst?.slot?.path === parent && owned(path[i], owner) && inst.src != null) {
      const at = Math.max(0, Math.min(inst.slot.count, index - inst.slot.index))
      return { parentSrc: inst.src, index: at }
    }
  }
  if (el.instance || !owned(el, owner) || el.src == null) return undefined
  return { parentSrc: el.src, index: count(el.children ?? [], index) }
}

/** The element type a drag would create or move. */
export function dragType(deck: DeckModel, item: DragItem): string | undefined {
  if (item.kind === "new") return item.type
  if (item.kind === "component") return deck.components.find((c) => c.name === item.name)?.template?.type
  return elementAt(deck, item.path)?.type
}

/** Whether `item` may be dropped into `parent` (null = the slide). */
export function canDrop(deck: DeckModel, slide: SlideNode, owner: string | undefined, item: DragItem, parent: string | null): boolean {
  const type = dragType(deck, item)
  if (!type) return false
  if (type === "slot" && !owner) return false
  if (item.kind === "component" && item.name === owner) return false
  if (item.kind === "move") {
    const el = elementAt(deck, item.path)
    if (!el || !owned(el, owner) || codeOf(el) == null) return false
    if (parent && (parent === item.path || parent.startsWith(item.path + "/"))) return false
  }
  const container = parent ? findElement(slide.elements, parent) : undefined
  const wants = container ? DIAGRAM_ITEM[container.type] : undefined
  if (wants ? type !== wants : type === "step" || type === "node") return false
  return resolveDrop(slide, owner, parent, 0) != null
}
