// Layouts are declarative: a layout names slots, and children flow into
// slots automatically (by type and order) or explicitly via `slot="..."`.
// Renderers turn the slot assignment into CSS grid; exporters measure it.

import type { ElementNode, LayoutName } from "./types"

export interface LayoutDef {
  name: LayoutName
  description: string
  slots: string[]
}

export const layouts: Record<LayoutName, LayoutDef> = {
  title: { name: "title", description: "Opening slide: big centered title, subtitle and small print below.", slots: ["title", "body"] },
  section: { name: "section", description: "Section divider: large title on accent or inverse background.", slots: ["title", "body"] },
  content: { name: "content", description: "Default: title on top, everything else stacked below.", slots: ["title", "body"] },
  "two-column": { name: "two-column", description: "Title on top, two equal columns. Non-title children split between left and right in order.", slots: ["title", "left", "right"] },
  "image-left": { name: "image-left", description: "First image fills the left half; title and content on the right.", slots: ["media", "title", "body"] },
  "image-right": { name: "image-right", description: "First image fills the right half; title and content on the left.", slots: ["media", "title", "body"] },
  statement: { name: "statement", description: "One big idea or number, centered. Great for Stat or a short Title.", slots: ["body"] },
  quote: { name: "quote", description: "A centered Quote with attribution.", slots: ["body"] },
  grid: { name: "grid", description: "Title on top, remaining children in an even grid (use Card or Stat children). Set columns={n} on the Slide.", slots: ["title", "grid"] },
  "full-image": { name: "full-image", description: "First image is a full-bleed background; text sits on a scrim at the bottom.", slots: ["media", "body"] },
  blank: { name: "blank", description: "Free canvas. Elements without x/y are stacked in the middle.", slots: ["body"] },
}

export const isAbsolute = (el: ElementNode) => el.props.x != null || el.props.y != null

/** Assign the slide's flow elements (non-absolute) to slots. */
export function assignSlots(layout: LayoutName, elements: ElementNode[]): Record<string, ElementNode[]> {
  const def = layouts[layout] ?? layouts.content
  const slots: Record<string, ElementNode[]> = Object.fromEntries(def.slots.map((s) => [s, []]))
  const auto: ElementNode[] = []
  for (const el of elements) {
    if (isAbsolute(el)) continue
    const explicit = el.props.slot as string | undefined
    if (explicit && slots[explicit]) slots[explicit].push(el)
    else auto.push(el)
  }
  const take = (slot: string, el: ElementNode) => (slots[slot] ?? slots.body ?? slots[def.slots[0]]).push(el)

  let mediaTaken = slots.media?.length > 0
  const rest: ElementNode[] = []
  for (const el of auto) {
    if ((el.type === "title") && slots.title && slots.title.length === 0) take("title", el)
    else if (el.type === "subtitle" && slots.title && layout !== "title") take("title", el)
    else if (el.type === "image" && slots.media && !mediaTaken) { take("media", el); mediaTaken = true }
    else rest.push(el)
  }
  if (layout === "two-column") {
    const half = Math.ceil(rest.length / 2)
    rest.forEach((el, i) => take(i < half ? "left" : "right", el))
  } else if (layout === "grid") {
    rest.forEach((el) => take("grid", el))
  } else {
    rest.forEach((el) => take("body", el))
  }
  return slots
}
