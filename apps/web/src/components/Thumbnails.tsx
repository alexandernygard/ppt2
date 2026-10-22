import { memo, useRef, useState } from "react"
import {
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  ScrollArea,
  cn,
} from "@alexandernygard/components"
import { PlusIcon } from "lucide-react"
import { SlideView, Stage } from "@ppt2/react"
import type { DeckModel, SlideNode } from "@ppt2/sdk"
import { useStore, useVisibleDeck } from "../store"
import { peersOn, useCollab } from "../collab"

const Thumb = memo(function Thumb({ deck, slide }: { deck: DeckModel; slide: SlideNode }) {
  return (
    <div style={{ aspectRatio: `${deck.width} / ${deck.height}` }} className="pointer-events-none w-full overflow-hidden rounded-md">
      <Stage width={deck.width} height={deck.height}>
        <SlideView deck={deck} slide={slide} />
      </Stage>
    </div>
  )
})

/** The slide list: a column beside the canvas, or a filmstrip under it on a phone. */
export function Thumbnails({ orientation = "vertical" }: { orientation?: "vertical" | "horizontal" }) {
  const across = orientation === "horizontal"
  const deck = useVisibleDeck()
  const current = useStore((s) => s.current)
  const aiBusy = useStore((s) => s.aiPreview != null)
  const peers = useCollab((s) => s.peers)
  const st = useStore.getState
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null)
  const press = useRef<{ from: number; at: number; dragging: boolean } | null>(null)
  const list = useRef<HTMLDivElement>(null)
  if (!deck) return null

  // Pointer-based reordering with a mouse or pen, and scriptable. A finger scrolls the list
  // instead; it reorders from the long-press menu.
  const pos = (e: { clientX: number; clientY: number }) => (across ? e.clientX : e.clientY)
  const overIndex = (at: number) => {
    const items = [...(list.current?.querySelectorAll<HTMLElement>("[data-thumb]") ?? [])]
    const i = items.findIndex((el) => { const r = el.getBoundingClientRect(); return across ? at < r.left + r.width / 2 : at < r.top + r.height / 2 })
    return i === -1 ? items.length : i
  }
  const onDown = (i: number) => (e: React.PointerEvent) => { if (e.button === 0 && !aiBusy) press.current = { from: i, at: pos(e), dragging: false } }
  const onMove = (e: React.PointerEvent) => {
    const p = press.current
    if (!p || e.pointerType === "touch") return
    if (!p.dragging && Math.abs(pos(e) - p.at) < 6) return
    if (!p.dragging) { p.dragging = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) }
    const over = overIndex(pos(e))
    if (!drag || drag.over !== over) setDrag({ from: p.from, over })
  }
  const onUp = () => {
    const p = press.current
    press.current = null
    if (p?.dragging && drag) {
      const to = drag.over > drag.from ? drag.over - 1 : drag.over
      if (to !== drag.from) st().moveSlide(drag.from, to)
    } else if (p) st().go(p.from)
    setDrag(null)
  }

  const strip = (
    <div ref={list} className={cn("flex gap-3 p-3", across ? "h-full items-center" : "flex-col")} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { press.current = null; setDrag(null) }}>
      {deck.slides.map((slide, i) => (
        <ContextMenu key={slide.index}>
          <ContextMenuTrigger asChild>
            <div
              data-thumb
              onPointerDown={onDown(i)}
              className={cn("group relative flex cursor-pointer gap-2 select-none", across ? "h-full w-28 shrink-0 touch-pan-x" : "touch-pan-y")}
            >
              {drag && drag.over === i && drag.from !== i && drag.from !== i - 1 && <div className={cn("absolute rounded bg-highlight", across ? "inset-y-0 -left-2 w-0.5" : "-top-2 right-0 left-6 h-0.5")} />}
              {drag && i === deck.slides.length - 1 && drag.over === i + 1 && drag.from !== i && <div className={cn("absolute rounded bg-highlight", across ? "inset-y-0 -right-2 w-0.5" : "right-0 -bottom-2 left-6 h-0.5")} />}
              <div className="flex w-4 shrink-0 flex-col items-end gap-1 pt-0.5">
                <span className={cn("text-xs tabular-nums text-muted-foreground", i === current && "font-semibold text-foreground")}>{i + 1}</span>
                {/* Who else is on this slide. */}
                {peersOn(peers, i, null).slice(0, 3).map((p) => (
                  <span key={p.clientId} title={p.state.user.name} className="size-2.5 rounded-full ring-2 ring-background" style={{ background: p.state.user.color }} />
                ))}
              </div>
              <div className={cn("min-w-0 flex-1 self-center rounded-lg ring-1 ring-border transition", i === current ? "ring-2 ring-highlight" : "group-hover:ring-foreground/30", drag?.from === i && "opacity-40")}>
                <Thumb deck={deck} slide={slide} />
              </div>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onSelect={() => { st().go(i); st().addSlide() }}>New slide after</ContextMenuItem>
            <ContextMenuItem onSelect={() => st().duplicateSlide(i)}>Duplicate</ContextMenuItem>
            <ContextMenuItem disabled={i === 0} onSelect={() => st().moveSlide(i, i - 1)}>{across ? "Move left" : "Move up"}</ContextMenuItem>
            <ContextMenuItem disabled={i === deck.slides.length - 1} onSelect={() => st().moveSlide(i, i + 1)}>{across ? "Move right" : "Move down"}</ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" disabled={deck.slides.length <= 1} onSelect={() => st().deleteSlide(i)}>Delete</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      ))}
      <Button variant="outline" size="sm" className={cn(across ? "shrink-0" : "ml-6")} disabled={aiBusy} onClick={() => st().addSlide()}><PlusIcon /> Slide</Button>
    </div>
  )
  // Radix's scroll area only scrolls one way at a time, so the filmstrip scrolls natively.
  return across ? <div className="h-full overflow-x-auto overscroll-x-contain">{strip}</div> : <ScrollArea className="h-full">{strip}</ScrollArea>
}
