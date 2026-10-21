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

export function Thumbnails() {
  const deck = useVisibleDeck()
  const current = useStore((s) => s.current)
  const aiBusy = useStore((s) => s.aiPreview != null)
  const peers = useCollab((s) => s.peers)
  const st = useStore.getState
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null)
  const press = useRef<{ from: number; y: number; dragging: boolean } | null>(null)
  const list = useRef<HTMLDivElement>(null)
  if (!deck) return null

  // Pointer-based reordering: works with mouse, pen and touch, and is scriptable.
  const overIndex = (y: number) => {
    const items = [...(list.current?.querySelectorAll<HTMLElement>("[data-thumb]") ?? [])]
    const i = items.findIndex((el) => { const r = el.getBoundingClientRect(); return y < r.top + r.height / 2 })
    return i === -1 ? items.length : i
  }
  const onDown = (i: number) => (e: React.PointerEvent) => { if (e.button === 0 && !aiBusy) press.current = { from: i, y: e.clientY, dragging: false } }
  const onMove = (e: React.PointerEvent) => {
    const p = press.current
    if (!p) return
    if (!p.dragging && Math.abs(e.clientY - p.y) < 6) return
    if (!p.dragging) { p.dragging = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) }
    const over = overIndex(e.clientY)
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

  return (
    <ScrollArea className="h-full">
      <div ref={list} className="flex flex-col gap-3 p-3" onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { press.current = null; setDrag(null) }}>
        {deck.slides.map((slide, i) => (
          <ContextMenu key={slide.index}>
            <ContextMenuTrigger asChild>
              <div
                data-thumb
                onPointerDown={onDown(i)}
                className="group relative flex cursor-pointer gap-2 select-none touch-none"
              >
                {drag && drag.over === i && drag.from !== i && drag.from !== i - 1 && <div className="absolute -top-2 right-0 left-6 h-0.5 rounded bg-highlight" />}
                {drag && i === deck.slides.length - 1 && drag.over === i + 1 && drag.from !== i && <div className="absolute right-0 -bottom-2 left-6 h-0.5 rounded bg-highlight" />}
                <div className="flex w-4 shrink-0 flex-col items-end gap-1 pt-0.5">
                  <span className={cn("text-xs tabular-nums text-muted-foreground", i === current && "font-semibold text-foreground")}>{i + 1}</span>
                  {/* Who else is on this slide. */}
                  {peersOn(peers, i, null).slice(0, 3).map((p) => (
                    <span key={p.clientId} title={p.state.user.name} className="size-2.5 rounded-full ring-2 ring-background" style={{ background: p.state.user.color }} />
                  ))}
                </div>
                <div className={cn("min-w-0 flex-1 rounded-lg ring-1 ring-border transition", i === current ? "ring-2 ring-highlight" : "group-hover:ring-foreground/30", drag?.from === i && "opacity-40")}>
                  <Thumb deck={deck} slide={slide} />
                </div>
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onSelect={() => { st().go(i); st().addSlide() }}>New slide after</ContextMenuItem>
              <ContextMenuItem onSelect={() => st().duplicateSlide(i)}>Duplicate</ContextMenuItem>
              <ContextMenuItem disabled={i === 0} onSelect={() => st().moveSlide(i, i - 1)}>Move up</ContextMenuItem>
              <ContextMenuItem disabled={i === deck.slides.length - 1} onSelect={() => st().moveSlide(i, i + 1)}>Move down</ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem variant="destructive" disabled={deck.slides.length <= 1} onSelect={() => st().deleteSlide(i)}>Delete</ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        ))}
        <Button variant="outline" size="sm" className="ml-6" disabled={aiBusy} onClick={() => st().addSlide()}><PlusIcon /> Slide</Button>
      </div>
    </ScrollArea>
  )
}
