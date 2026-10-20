import type { DeckModel, Diagnostic, ElementNode } from "./types"

function summarize(el: ElementNode): string {
  const p = el.props
  switch (el.type) {
    case "list": return `list (${(p.items as string[])?.length ?? 0} items)`
    case "image": return `image ${p.src ?? ""}`
    case "chart": return `${p.type ?? "bar"} chart of ${Array.isArray(p.series) ? p.series.join(", ") : p.series} by ${p.category} (${(p.data as unknown[])?.length ?? 0} rows)`
    case "table": return `table (${(p.rows as unknown[])?.length ?? 0} rows)`
    case "stat": return `stat ${p.value} ${p.label ?? ""}`
    case "row": case "column": case "card": return `${el.type} [${el.children?.map(summarize).join("; ")}]`
    case "icon": return `icon ${p.name ?? "?"}`
    case "flow": case "cycle": return `${el.type} diagram: ${el.children?.map((c) => c.text).join(el.type === "cycle" ? " → … → " : " → ")}`
    case "timeline": return `timeline: ${el.children?.map((c) => `${c.props.date ? `${c.props.date} ` : ""}${c.text}`).join(" | ")}`
    case "tree": { let n = 0; walkEls(el.children ?? [], () => n++); return `tree (${n} nodes) rooted at "${el.children?.[0]?.text ?? ""}"` }
    default: return `${el.type} "${(el.text ?? "").replace(/\n/g, " ").slice(0, 80)}"`
  }
}

/** A compact, human/LLM-readable outline of the deck. */
export function outline(deck: DeckModel): string {
  const lines = [`Deck "${deck.title}" — theme ${deck.theme.name}, ${deck.aspect}, ${deck.slides.length} slides`]
  for (const s of deck.slides) {
    lines.push(`Slide ${s.index + 1} [${s.layout}]${s.props.transition ? ` transition=${s.props.transition}` : ""}`)
    for (const el of s.elements) lines.push(`  - ${summarize(el)}${el.props.x != null ? " (absolute)" : ""}${el.props.step ? ` step ${el.props.step}` : ""}`)
    if (s.notes) lines.push(`  notes: ${s.notes.replace(/\n/g, " ").slice(0, 100)}`)
  }
  return lines.join("\n")
}

/** Asset files the deck references ("assets/<name>"), for saving a deck with its images. */
export function assetRefs(deck: DeckModel): string[] {
  const out = new Set<string>()
  const add = (v: unknown) => { if (typeof v === "string" && v.startsWith("assets/")) out.add(v.slice(7)) }
  for (const s of deck.slides) {
    add(s.props.background)
    walkEls(s.elements, (el) => add(el.props.src))
  }
  return [...out]
}

const words = (s = "") => s.split(/\s+/).filter(Boolean).length

function walkEls(els: ElementNode[], fn: (el: ElementNode) => void) {
  for (const el of els) { fn(el); if (el.children) walkEls(el.children, fn) }
}

/** Content-level checks that don't need a renderer. Rendered checks (overflow) live in the renderer. */
export function lintDeck(deck: DeckModel): Diagnostic[] {
  const out: Diagnostic[] = []
  for (const s of deck.slides) {
    let count = 0
    let bullets = 0
    let hasTitle = false
    walkEls(s.elements, (el) => {
      count += words(el.text)
      if (el.type === "list") { const items = (el.props.items as string[]) ?? []; bullets += items.length; count += items.reduce((n, i) => n + words(i), 0) }
      if (el.type === "title") hasTitle = true
      if (el.type === "image" && !el.props.alt) out.push({ severity: "info", slide: s.index, path: el.path, message: `Slide ${s.index + 1}: image has no alt text` })
    })
    const label = `Slide ${s.index + 1}`
    if (count > 60) out.push({ severity: "warning", slide: s.index, message: `${label}: ${count} words — too dense for one slide (aim for ≤ 30)` })
    if (bullets > 6) out.push({ severity: "warning", slide: s.index, message: `${label}: ${bullets} bullets (aim for ≤ 5)` })
    if (!hasTitle && !["statement", "quote", "full-image", "blank"].includes(s.layout)) out.push({ severity: "info", slide: s.index, message: `${label}: no title` })
    if (!s.notes && s.layout !== "title") out.push({ severity: "info", slide: s.index, message: `${label}: no speaker notes` })
  }
  return out
}
