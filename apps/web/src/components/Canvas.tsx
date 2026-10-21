import { useEffect, useRef, useState } from "react"
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
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
import { ComponentIcon, CopyIcon, ImageIcon, PlusIcon, Trash2Icon, UndoDotIcon, CropIcon, UploadIcon, ReplaceIcon } from "lucide-react"
import { IconPicker } from "./IconPicker"
import { EditableSlide, Stage, findElement } from "@ppt2/react"
import { layouts } from "@ppt2/sdk"
import { useStore, useVisibleDeck } from "../store"
import { componentSlide } from "../lib/tree"
import { PALETTE } from "../lib/palette"

const MENU_GROUPS = ["Text", "Media", "Layout", "Diagrams", "Data", "Component"] as const

export function Canvas() {
  const deck = useVisibleDeck()
  const current = useStore((s) => s.current)
  const selected = useStore((s) => s.selected)
  const aiBusy = useStore((s) => s.aiPreview != null)
  const st = useStore.getState
  const cropping = useStore((s) => s.cropping)
  const editing = useStore((s) => s.editingComponent)
  const dragging = useStore((s) => s.dragging != null)
  const hovered = useStore((s) => s.hovered)
  const slide = deck && (editing ? componentSlide(deck, editing) : deck.slides[current])
  const def = editing ? deck?.components.find((c) => c.name === editing) : undefined
  const upload = useRef<HTMLInputElement>(null)
  const replaceTarget = useRef<string | null>(null)
  const [iconPicker, setIconPicker] = useState<"insert" | "replace" | null>(null)

  // Paste images from the clipboard onto the current slide.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest?.(".cm-editor, input, textarea, [contenteditable=true], [role=dialog]")) return
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"))
      if (!files.length || st().aiPreview) return
      e.preventDefault()
      void st().insertImages(files)
    }
    window.addEventListener("paste", onPaste)
    return () => window.removeEventListener("paste", onPaste)
  }, [st])

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
      if (e.key === "Escape" || (e.key === "Enter" && s.cropping)) { if (s.cropping) s.setCropping(null); else s.select(null); return }
      if ((e.key === "Delete" || e.key === "Backspace") && s.selected) { e.preventDefault(); s.deleteElement(s.selected); return }
      if (e.key.startsWith("Arrow") && !s.editingComponent) {
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

  if (editing && deck && !slide) {
    return (
      <div className="grid h-full place-items-center text-center text-sm text-muted-foreground">
        <div className="flex flex-col items-center gap-3">
          <p>The component {editing} isn't in the code any more.</p>
          <Button size="sm" variant="outline" onClick={() => st().editComponent(null)}>Back to the slides</Button>
        </div>
      </div>
    )
  }
  if (!deck || !slide) return <div className="grid h-full place-items-center text-muted-foreground">No slides yet. Ask the AI to write a deck, or add one in code.</div>
  const el = selected ? findElement(slide.elements, selected) : undefined
  const pinned = el && (el.props.x != null || el.props.y != null)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-1.5 overflow-x-auto border-b px-3 whitespace-nowrap [&>*]:shrink-0">
        {editing ? (
          <>
            <span className="flex items-center gap-1.5 rounded-md bg-violet-500/10 px-2 py-1 text-xs font-medium text-violet-700 dark:text-violet-300"><ComponentIcon className="size-3.5" /> {editing}</span>
            <span className="text-xs text-muted-foreground">{def?.uses === 1 ? "1 use" : `${def?.uses ?? 0} uses`} · edits change every use</span>
            <Button size="sm" variant="outline" onClick={() => st().editComponent(null)}>Done</Button>
          </>
        ) : <>
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
        </>}
        <Separator orientation="vertical" className="mx-1 h-5!" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button size="sm" variant="ghost" disabled={aiBusy}><PlusIcon /> Insert</Button></DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-[70vh] overflow-y-auto">
            <DropdownMenuItem onSelect={() => { replaceTarget.current = null; upload.current?.click() }}><UploadIcon /> Image from computer…</DropdownMenuItem>
            {MENU_GROUPS.map((group) => {
              const items = PALETTE.filter((p) => p.group === group && (p.type !== "slot" || editing) && p.type !== "step" && p.type !== "node")
              if (!items.length) return null
              return (
                <div key={group}>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-xs">{group}</DropdownMenuLabel>
                  {items.map((p) => (
                    <DropdownMenuItem key={p.type} onSelect={() => (p.type === "icon" ? setIconPicker("insert") : st().addElement(p.type))}>
                      <p.icon /> {p.type === "icon" ? "Icon…" : p.type === "image" ? "Placeholder image" : p.label}
                    </DropdownMenuItem>
                  ))}
                </div>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
        {el && (
          <>
            <Separator orientation="vertical" className="mx-1 h-5!" />
            <span className="text-xs text-muted-foreground">{el.instance ? `◇ ${el.instance.name}` : el.type}{el.component && el.component !== editing ? ` · part of ${el.component}` : ""}{editing ? "" : pinned ? " · pinned" : " · in layout"}</span>
            {el.instance && (
              <Button size="sm" variant="ghost" onClick={() => st().editComponent(el.instance!.name)}><ComponentIcon /> Edit component</Button>
            )}
            {el.type === "image" && (
              <>
                <Tooltip>
                  <TooltipTrigger asChild><Button size="icon-sm" variant={cropping === el.path ? "secondary" : "ghost"} onClick={() => st().setCropping(cropping === el.path ? null : el.path)}><CropIcon /></Button></TooltipTrigger>
                  <TooltipContent>Crop: drag to reposition, scroll to zoom (or double-click the image)</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild><Button size="icon-sm" variant="ghost" onClick={() => { replaceTarget.current = el.path; upload.current?.click() }}><ReplaceIcon /></Button></TooltipTrigger>
                  <TooltipContent>Replace image (or drop a file onto it)</TooltipContent>
                </Tooltip>
              </>
            )}
            {el.type === "icon" && (
              <Tooltip>
                <TooltipTrigger asChild><Button size="icon-sm" variant="ghost" onClick={() => setIconPicker("replace")}><ReplaceIcon /></Button></TooltipTrigger>
                <TooltipContent>Change icon</TooltipContent>
              </Tooltip>
            )}
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
              onChangeProps={(p, props) => st().setElementProps(p, props)}
              cropping={cropping}
              onCrop={(p) => st().setCropping(p)}
              onDropFiles={editing ? undefined : (files, at) => void st().insertImages(files, at)}
              dragging={dragging}
              canDrop={(p) => st().canDropHere(p)}
              onDropElement={(t) => st().dropAt(t)}
              highlight={hovered}
              fixed={!!editing}
            />
          </div>
        </Stage>
      </div>
      <input ref={upload} type="file" accept="image/*" multiple hidden onChange={(e) => {
        const files = [...(e.target.files ?? [])]
        const path = replaceTarget.current
        if (files.length) void st().insertImages(files, path ? { x: 0, y: 0, path } : undefined)
        e.target.value = ""
      }} />
      <IconPicker
        open={iconPicker != null}
        onOpenChange={(o) => !o && setIconPicker(null)}
        onPick={(name) => {
          if (iconPicker === "replace" && el?.type === "icon") st().setElementProps(el.path, { name })
          else st().addElement("icon", { name })
        }}
      />
    </div>
  )
}
