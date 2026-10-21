import { Fragment, useEffect, useRef, useState } from "react"
import { cn } from "@alexandernygard/components"
import { ChevronRightIcon, ComponentIcon, PencilIcon, PresentationIcon, SquareDashedIcon, TypeIcon, type LucideIcon } from "lucide-react"
import type { ElementNode } from "@ppt2/sdk"
import { paletteItem } from "../lib/palette"
import { componentSlide, owned, parentPath, type DragItem } from "../lib/tree"
import { useStore } from "../store"
import { dragProps } from "./ElementPalette"

type Drop = { parent: string | null; index: number; row: string; zone: "before" | "after" | "inside" }

const iconOf = (el: ElementNode): LucideIcon => (el.instance ? ComponentIcon : el.type === "slot" ? SquareDashedIcon : paletteItem(el.type)?.icon ?? TypeIcon)

function labelOf(el: ElementNode): { name: string; detail?: string } {
  if (el.instance) return { name: el.instance.name }
  const p = el.props
  const text = (el.text ?? "").replace(/\s+/g, " ").trim()
  switch (el.type) {
    case "slot": return { name: "Slot", detail: "children go here" }
    case "list": return { name: "Bullets", detail: (p.items as string[] | undefined)?.[0] }
    case "image": return { name: "Image", detail: String(p.src ?? "").split("/").pop() }
    case "icon": return { name: "Icon", detail: String(p.name ?? "") }
    case "stat": return { name: "Big number", detail: String(p.value ?? "") }
    case "chart": return { name: "Chart", detail: String(p.type ?? "bar") }
    case "step": case "node": return { name: text || (el.type === "step" ? "Step" : "Node") }
    default: return { name: paletteItem(el.type)?.label ?? el.type, detail: text || undefined }
  }
}

const indexOf = (path: string) => Number(path.split("/").pop())

/**
 * The slide (or component) as a tree, like Figma's layers: select, reorder and nest by dragging.
 * Parts that come from a component are purple and can only be changed in the component editor.
 */
export function LayerTree() {
  const deck = useStore((s) => s.deck)
  const current = useStore((s) => s.current)
  const editing = useStore((s) => s.editingComponent)
  const selected = useStore((s) => s.selected)
  const dragging = useStore((s) => s.dragging)
  const owner = editing ?? undefined
  const slide = deck && (editing ? componentSlide(deck, editing) : deck.slides[current])
  const [closed, setClosed] = useState<Record<string, boolean>>({})
  const [drop, setDrop] = useState<Drop | null>(null)
  const root = useRef<HTMLDivElement>(null)

  // Reveal the selection: open its ancestors and scroll it into view.
  useEffect(() => {
    if (!selected) return
    const parts = selected.split("/")
    const open: Record<string, boolean> = {}
    for (let i = 2; i < parts.length; i++) open[parts.slice(0, i).join("/")] = false
    setClosed((c) => ({ ...c, ...open }))
    requestAnimationFrame(() => root.current?.querySelector(`[data-row="${CSS.escape(selected)}"]`)?.scrollIntoView({ block: "nearest" }))
  }, [selected])
  useEffect(() => { if (!dragging) setDrop(null) }, [dragging])

  if (!slide) return <p className="p-3 text-sm text-muted-foreground">Nothing to show until the code compiles.</p>
  const st = useStore.getState
  const isOpen = (el: ElementNode) => !(closed[el.path] ?? !!el.instance)

  /** Where the dragged item would go when dropped on `el`'s row, given the pointer's place in the row. */
  function dropOn(e: React.DragEvent, el: ElementNode | null): Drop | null {
    const item = st().dragging
    if (!item) return null
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const f = (e.clientY - r.top) / r.height
    if (!el) return st().canDropHere(null) ? { parent: null, index: slide!.elements.length, row: "slide", zone: "inside" } : null
    const parent = parentPath(el.path)
    const container = !!el.children
    const options: Drop[] = []
    const inside: Drop = { parent: el.path, index: el.children?.length ?? 0, row: el.path, zone: "inside" }
    const before: Drop = { parent, index: indexOf(el.path), row: el.path, zone: "before" }
    const after: Drop = { parent, index: indexOf(el.path) + 1, row: el.path, zone: "after" }
    if (container && f > 0.25 && f < 0.75) options.push(inside)
    options.push(f < 0.5 ? before : after)
    if (container) options.push(inside)
    return options.find((d) => st().canDropHere(d.parent)) ?? null
  }

  const rowDrag = (el: ElementNode | null) => ({
    onDragOver: (e: React.DragEvent) => {
      const d = dropOn(e, el)
      if (!d) return
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = st().dragging?.kind === "move" ? "move" : "copy"
      if (d.row !== drop?.row || d.zone !== drop?.zone || d.index !== drop?.index) setDrop(d)
    },
    onDrop: (e: React.DragEvent) => {
      const d = dropOn(e, el)
      e.preventDefault()
      e.stopPropagation()
      setDrop(null)
      if (d) st().dropAt({ parent: d.parent, index: d.index, x: 0, y: 0 })
    },
  })

  // A render function, not a component: rows must not remount mid-drag, or the browser drops the drag.
  function row(el: ElementNode, depth: number) {
    const Icon = iconOf(el)
    const { name, detail } = labelOf(el)
    const mine = owned(el, owner)
    const part = !!el.component && el.component !== owner
    const kids = el.children ?? []
    const open = isOpen(el)
    const hit = drop?.row === el.path ? drop.zone : null
    const item: DragItem = { kind: "move", path: el.path }
    return (
      <Fragment key={el.path}>
        <div
          data-row={el.path}
          role="treeitem"
          aria-selected={selected === el.path}
          aria-expanded={kids.length ? open : undefined}
          {...(mine ? dragProps(item, name) : {})}
          {...rowDrag(el)}
          onClick={() => st().select(el.path)}
          onDoubleClick={() => { if (el.instance) st().editComponent(el.instance.name) }}
          onMouseEnter={() => st().setHovered(el.path)}
          onMouseLeave={() => st().setHovered(null)}
          className={cn(
            "group relative flex h-7 cursor-default items-center gap-1.5 rounded-md pr-1.5 text-[13px] select-none",
            selected === el.path ? "bg-highlight/20" : "hover:bg-muted",
            hit === "inside" && "ring-2 ring-highlight ring-inset",
            (el.instance || part) && "text-violet-700 dark:text-violet-300",
            part && !el.instance && "text-violet-700/70 dark:text-violet-300/70",
          )}
          style={{ paddingLeft: 4 + depth * 14 }}
        >
          {hit === "before" && <div className="pointer-events-none absolute -top-px right-1 h-0.5 rounded bg-highlight" style={{ left: 4 + depth * 14 }} />}
          {hit === "after" && <div className="pointer-events-none absolute right-1 -bottom-px h-0.5 rounded bg-highlight" style={{ left: 4 + depth * 14 }} />}
          <button
            type="button"
            tabIndex={-1}
            aria-label={open ? "Collapse" : "Expand"}
            onClick={(e) => { e.stopPropagation(); setClosed((c) => ({ ...c, [el.path]: open })) }}
            className={cn("grid size-4 shrink-0 place-items-center rounded text-muted-foreground hover:text-foreground", !kids.length && "invisible")}
          >
            <ChevronRightIcon className={cn("size-3.5 transition-transform", open && "rotate-90")} />
          </button>
          <Icon className={cn("size-3.5 shrink-0", !(el.instance || part) && "text-muted-foreground")} />
          <span className={cn("shrink-0", el.instance && "font-medium")}>{name}</span>
          {detail && <span className="min-w-0 truncate text-muted-foreground">{detail}</span>}
          {el.props.x != null && <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">pinned</span>}
          {el.instance && (
            <button type="button" aria-label={`Edit ${el.instance.name}`} title={`Edit the ${el.instance.name} component`} onClick={(e) => { e.stopPropagation(); st().editComponent(el.instance!.name) }}
              className={cn("grid size-5 shrink-0 place-items-center rounded opacity-0 group-hover:opacity-100 hover:bg-background", el.props.x == null && "ml-auto")}>
              <PencilIcon className="size-3" />
            </button>
          )}
        </div>
        {open && kids.map((k) => row(k, depth + 1))}
      </Fragment>
    )
  }

  const header = owner ? null : (
    <div
      data-row="slide"
      {...rowDrag(null)}
      onClick={() => st().select(null)}
      className={cn("flex h-7 items-center gap-1.5 rounded-md px-1.5 text-[13px] font-medium", !selected && "bg-muted", drop?.row === "slide" && "ring-2 ring-highlight ring-inset")}
    >
      <PresentationIcon className="size-3.5 text-muted-foreground" />
      Slide {slide.index + 1}
      <span className="font-normal text-muted-foreground">{slide.themeLayout ?? slide.layout}</span>
    </div>
  )

  return (
    <div ref={root} role="tree" className="flex flex-col" onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop(null) }}>
      {header}
      {slide.elements.map((el) => row(el, owner ? 0 : 1))}
      {!owner && !slide.elements.length && <p className="px-2 py-3 text-xs text-muted-foreground">Empty slide. Drag elements here.</p>}
      {/* Room below the last row to drop onto the end of the slide. */}
      {!owner && <div className="min-h-10 flex-1" {...rowDrag(null)} />}
    </div>
  )
}
