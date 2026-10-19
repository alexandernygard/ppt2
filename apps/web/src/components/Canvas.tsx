import { useEffect } from "react"
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alexandernygard/components"
import { CopyIcon, ImageIcon, PlusIcon, ShapesIcon, Trash2Icon, TypeIcon, UndoDotIcon, BarChart3Icon, ListIcon, HashIcon, QuoteIcon, CodeIcon, HeadingIcon } from "lucide-react"
import { EditableSlide, Stage, findElement } from "@ppt2/react"
import { layouts } from "@ppt2/sdk"
import { useStore, useVisibleDeck } from "../store"

export function Canvas() {
  const deck = useVisibleDeck()
  const current = useStore((s) => s.current)
  const selected = useStore((s) => s.selected)
  const aiBusy = useStore((s) => s.aiPreview != null)
  const st = useStore.getState
  const slide = deck?.slides[current]

  // Canvas keyboard: delete, nudge, duplicate, slide navigation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest(".cm-editor, input, textarea, [contenteditable=true], [role=dialog]")) return
      const s = st()
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? s.redo() : s.undo(); return }
      if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); s.redo(); return }
      if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); s.selected ? s.duplicateSelected() : s.duplicateSlide(s.current); return }
      if (e.key === "Escape") s.select(null)
      if ((e.key === "Delete" || e.key === "Backspace") && s.selected) { e.preventDefault(); s.deleteElement(s.selected); return }
      if (e.key.startsWith("Arrow")) {
        const sl = s.deck?.slides[s.current]
        const el = s.selected && sl ? findElement(sl.elements, s.selected) : undefined
        if (el && (el.props.x != null || el.props.y != null)) {
          e.preventDefault()
          const d = e.shiftKey ? 40 : 4
          const dx = e.key === "ArrowLeft" ? -d : e.key === "ArrowRight" ? d : 0
          const dy = e.key === "ArrowUp" ? -d : e.key === "ArrowDown" ? d : 0
          s.setElementBox(el.path, { x: (el.props.x ?? 0) + dx, y: (el.props.y ?? 0) + dy })
        } else if (!s.selected) {
          if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); s.go(s.current + 1) }
          if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); s.go(s.current - 1) }
        }
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [st])

  if (!deck || !slide) return <div className="grid h-full place-items-center text-muted-foreground">No slides yet. Ask the AI to write a deck, or add one in code.</div>
  const el = selected ? findElement(slide.elements, selected) : undefined
  const pinned = el && (el.props.x != null || el.props.y != null)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-1.5 overflow-x-auto border-b px-3 whitespace-nowrap [&>*]:shrink-0">
        <Select value={slide.layout} onValueChange={(layout) => st().setSlideProps(current, { layout })} disabled={aiBusy}>
          <SelectTrigger size="sm" className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.values(layouts).map((l) => <SelectItem key={l.name} value={l.name}>{l.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={(slide.props.variant as string) ?? "default"} onValueChange={(v) => st().setSlideProps(current, { variant: v === "default" ? undefined : v })} disabled={aiBusy}>
          <SelectTrigger size="sm" className="w-28"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="default">Default</SelectItem>
            <SelectItem value="inverse">Inverse</SelectItem>
            <SelectItem value="accent">Accent</SelectItem>
          </SelectContent>
        </Select>
        <Select value={(slide.props.transition as string) ?? "none"} onValueChange={(v) => st().setSlideProps(current, { transition: v === "none" ? undefined : v })} disabled={aiBusy}>
          <SelectTrigger size="sm" className="w-28"><SelectValue /></SelectTrigger>
          <SelectContent>
            {["none", "fade", "slide", "zoom"].map((t) => <SelectItem key={t} value={t}>{t === "none" ? "No transition" : t}</SelectItem>)}
          </SelectContent>
        </Select>
        <Separator orientation="vertical" className="mx-1 h-5!" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button size="sm" variant="ghost" disabled={aiBusy}><PlusIcon /> Insert</Button></DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {([["title", "Title", HeadingIcon], ["text", "Text", TypeIcon], ["list", "Bullets", ListIcon], ["image", "Image", ImageIcon], ["shape", "Shape", ShapesIcon], ["chart", "Chart", BarChart3Icon], ["stat", "Big number", HashIcon], ["quote", "Quote", QuoteIcon], ["code", "Code", CodeIcon]] as const).map(([t, label, Icon]) => (
              <DropdownMenuItem key={t} onSelect={() => st().addElement(t)}><Icon /> {label}</DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {el && (
          <>
            <Separator orientation="vertical" className="mx-1 h-5!" />
            <span className="text-xs text-muted-foreground">{el.type}{pinned ? " · pinned" : " · in layout"}</span>
            {pinned && (
              <Tooltip>
                <TooltipTrigger asChild><Button size="icon-sm" variant="ghost" onClick={() => st().setElementProps(el.path, { x: undefined, y: undefined, w: undefined, h: undefined })}><UndoDotIcon /></Button></TooltipTrigger>
                <TooltipContent>Return to layout (remove x/y/w/h)</TooltipContent>
              </Tooltip>
            )}
            <Select value={(el.props.align as string) ?? "auto"} onValueChange={(v) => st().setElementProps(el.path, { align: v === "auto" ? undefined : v })}>
              <SelectTrigger size="sm" className="w-24"><SelectValue /></SelectTrigger>
              <SelectContent>{["auto", "left", "center", "right"].map((a) => <SelectItem key={a} value={a}>{a === "auto" ? "Align" : a}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={typeof el.props.step === "number" ? String(el.props.step) : "0"} onValueChange={(v) => st().setElementProps(el.path, { step: v === "0" ? undefined : Number(v), animate: v === "0" ? undefined : (el.props.animate ?? "rise") })}>
              <SelectTrigger size="sm" className="w-28"><SelectValue /></SelectTrigger>
              <SelectContent>{[0, 1, 2, 3, 4].map((n) => <SelectItem key={n} value={String(n)}>{n ? `Build ${n}` : "No build"}</SelectItem>)}</SelectContent>
            </Select>
            <Tooltip>
              <TooltipTrigger asChild><Button size="icon-sm" variant="ghost" onClick={() => st().duplicateSelected()}><CopyIcon /></Button></TooltipTrigger>
              <TooltipContent>Duplicate (⌘D)</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild><Button size="icon-sm" variant="ghost" onClick={() => st().deleteElement(el.path)}><Trash2Icon /></Button></TooltipTrigger>
              <TooltipContent>Delete (⌫)</TooltipContent>
            </Tooltip>
          </>
        )}
      </div>
      <div className="relative min-h-0 flex-1 bg-muted/40" onPointerDown={(e) => { if (!(e.target as HTMLElement).closest("[data-slide-index]")) st().select(null) }}>
        <Stage width={deck.width} height={deck.height} padding={28}>
          <div className="shadow-xl" style={{ width: deck.width, height: deck.height, pointerEvents: aiBusy ? "none" : undefined }}>
            <EditableSlide
              deck={deck}
              slide={slide}
              selected={selected}
              onSelect={(p) => st().select(p)}
              onChangeBox={(p, box) => st().setElementBox(p, box)}
              onChangeText={(p, f, v) => st().setElementText(p, f, v)}
            />
          </div>
        </Stage>
      </div>
    </div>
  )
}
