import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from "react"
import type { DeckModel, ElementNode, SlideNode } from "@ppt2/sdk"
import { SlideView } from "./SlideView"
import { useStage } from "./Stage"
import type { Box, Override } from "./elements"

type Rect = { x: number; y: number; w: number; h: number }
type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw"

export type TextField = "text" | "items" | "value"

export interface EditableSlideProps {
  deck: DeckModel
  slide: SlideNode
  selected: string | null
  onSelect: (path: string | null) => void
  /** Commit geometry for a top-level element. */
  onChangeBox: (path: string, box: Box) => void
  /** Commit inline text. */
  onChangeText: (path: string, field: TextField, value: string) => void
  /** Commit other prop changes (image crop). */
  onChangeProps?: (path: string, props: Record<string, unknown>) => void
  /** Image being cropped: drag pans, wheel zooms. */
  cropping?: string | null
  onCrop?: (path: string | null) => void
  /** Files dropped on the slide; `path` is the image under the pointer, if any. */
  onDropFiles?: (files: File[], at: { x: number; y: number; path?: string }) => void
}

const TEXTISH = new Set(["title", "subtitle", "text", "list", "quote", "stat", "code"])
const EDITABLE: Record<string, TextField> = { title: "text", subtitle: "text", text: "text", quote: "text", shape: "text", code: "text", notes: "text", list: "items", stat: "value", step: "text", node: "text" }
const SINGLE_LINE = new Set(["title", "subtitle", "stat"])

export function findElement(els: ElementNode[], path: string): ElementNode | undefined {
  for (const el of els) {
    if (el.path === path) return el
    if (el.children && path.startsWith(el.path + "/")) return findElement(el.children, path)
  }
}

const topLevel = (path: string) => path.split("/").slice(0, 2).join("/")

const parseFocus = (f: unknown): [number, number] => {
  const m = typeof f === "string" ? /([\d.]+)%\s+([\d.]+)%/.exec(f) : null
  return m ? [+m[1], +m[2]] : [50, 50]
}

export function EditableSlide({ deck, slide, selected, onSelect, onChangeBox, onChangeText, onChangeProps, cropping, onCrop, onDropFiles }: EditableSlideProps) {
  const { scale } = useStage()
  const root = useRef<HTMLDivElement>(null)
  const [rects, setRects] = useState<Record<string, Rect>>({})
  const [override, setOverride] = useState<Record<string, Override> | undefined>()
  const crop = useRef<{ path: string; px: number; py: number; focus: [number, number]; zoom: number; moved: boolean } | null>(null)
  const cropLive = useRef<{ focus: [number, number]; zoom: number } | null>(null)
  const wheelTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [dropAt, setDropAt] = useState<string | null>(null)
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] })
  const [editing, setEditing] = useState<{ path: string; field: TextField; value: string; rect: Rect; style: CSSProperties } | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const gesture = useRef<{ kind: "move" | "resize"; path: string; handle?: Handle; px: number; py: number; start: Rect; moved: boolean; el: ElementNode; flow: boolean; pointerId: number; latest?: Rect } | null>(null)

  const measure = useCallback((path: string): Rect | undefined => {
    const r = root.current
    const node = r?.querySelector(`[data-path="${path}"]`) as HTMLElement | null
    if (!r || !node) return
    const a = r.getBoundingClientRect()
    const b = node.getBoundingClientRect()
    const s = a.width / deck.width
    return { x: (b.left - a.left) / s, y: (b.top - a.top) / s, w: b.width / s, h: b.height / s }
  }, [deck.width])

  // Keep selection/hover rects in sync with whatever was rendered.
  useLayoutEffect(() => {
    const next: Record<string, Rect> = {}
    for (const p of [selected, hover]) if (p) { const r = measure(p); if (r) next[p] = r }
    setRects((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
  })
  useLayoutEffect(() => {
    // Images and fonts load late; re-measure once they settle.
    const t = setTimeout(() => setRects((r) => ({ ...r })), 300)
    return () => clearTimeout(t)
  }, [slide, selected])

  const toStage = (e: { clientX: number; clientY: number }) => {
    const a = root.current!.getBoundingClientRect()
    const s = a.width / deck.width
    return { x: (e.clientX - a.left) / s, y: (e.clientY - a.top) / s }
  }

  const pathsAt = (target: EventTarget | null): string[] => {
    const out: string[] = []
    let n = target as HTMLElement | null
    while (n && n !== root.current) {
      const p = n.getAttribute?.("data-path")
      if (p) out.unshift(p)
      n = n.parentElement
    }
    return out
  }

  function snap(r: Rect, path: string, handle?: Handle): Rect {
    const W = deck.width, H = deck.height
    const t = 10 / Math.max(scale, 0.1)
    const xs = [0, W / 2, W, 120, W - 120]
    const ys = [0, H / 2, H, 96, H - 96]
    for (const el of slide.elements) {
      if (el.path === path) continue
      const o = measure(el.path)
      if (o) { xs.push(o.x, o.x + o.w / 2, o.x + o.w); ys.push(o.y, o.y + o.h / 2, o.y + o.h) }
    }
    const gx: number[] = [], gy: number[] = []
    const out = { ...r }
    const tryAxis = (edges: [number, (d: number) => void][], cands: number[], guide: number[]) => {
      let best: { d: number; c: number; apply: (d: number) => void } | undefined
      for (const [v, apply] of edges) for (const c of cands) { const d = c - v; if (Math.abs(d) < t && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, c, apply } }
      if (best) { best.apply(best.d); guide.push(best.c) }
    }
    if (!handle) {
      tryAxis([[r.x, (d) => (out.x += d)], [r.x + r.w / 2, (d) => (out.x += d)], [r.x + r.w, (d) => (out.x += d)]], xs, gx)
      tryAxis([[r.y, (d) => (out.y += d)], [r.y + r.h / 2, (d) => (out.y += d)], [r.y + r.h, (d) => (out.y += d)]], ys, gy)
    } else {
      if (handle.includes("e")) tryAxis([[r.x + r.w, (d) => (out.w += d)]], xs, gx)
      if (handle.includes("w")) tryAxis([[r.x, (d) => { out.x += d; out.w -= d }]], xs, gx)
      if (handle.includes("s")) tryAxis([[r.y + r.h, (d) => (out.h += d)]], ys, gy)
      if (handle.includes("n")) tryAxis([[r.y, (d) => { out.y += d; out.h -= d }]], ys, gy)
    }
    setGuides({ x: gx, y: gy })
    return out
  }

  function begin(e: RPointerEvent, kind: "move" | "resize", path: string, handle?: Handle) {
    const el = findElement(slide.elements, path)
    const start = measure(path)
    if (!el || !start) return
    const p = toStage(e)
    gesture.current = { kind, path, handle, px: p.x, py: p.y, start, moved: false, el, flow: el.props.x == null && el.props.y == null, pointerId: e.pointerId }
  }

  // --- crop: pan with drag, zoom with wheel ---------------------------------
  const cropEl = cropping ? findElement(slide.elements, cropping) : undefined
  const cropState = () => cropLive.current ?? { focus: parseFocus(cropEl?.props.focus), zoom: typeof cropEl?.props.zoom === "number" ? (cropEl.props.zoom as number) : 1 }
  const cropProps = (c: { focus: [number, number]; zoom: number }) => ({
    focus: Math.round(c.focus[0]) === 50 && Math.round(c.focus[1]) === 50 ? undefined : `${Math.round(c.focus[0])}% ${Math.round(c.focus[1])}%`,
    zoom: Math.abs(c.zoom - 1) < 0.01 ? undefined : Math.round(c.zoom * 100) / 100,
  })
  const showCrop = (c: { focus: [number, number]; zoom: number }) => {
    cropLive.current = c
    setOverride({ [cropping!]: { focus: `${c.focus[0]}% ${c.focus[1]}%`, zoom: c.zoom } })
  }
  const commitCrop = () => {
    if (cropping && cropLive.current) onChangeProps?.(cropping, cropProps(cropLive.current))
    cropLive.current = null
    setTimeout(() => setOverride(undefined), 0)
  }
  function cropDown(e: RPointerEvent) {
    const chain = pathsAt(e.target)
    if (!chain.includes(cropping!)) { commitCrop(); onCrop?.(null); return false }
    const p = toStage(e)
    crop.current = { path: cropping!, px: p.x, py: p.y, ...cropState(), moved: false }
    root.current!.setPointerCapture(e.pointerId)
    return true
  }
  function cropMove(e: RPointerEvent) {
    const c = crop.current!
    const node = root.current?.querySelector(`[data-path="${c.path}"]`)
    const img = node?.querySelector("img")
    const frame = node?.querySelector("[data-frame]") as HTMLElement | null
    if (!img || !frame || !img.naturalWidth) return
    const p = toStage(e)
    const s = root.current!.getBoundingClientRect().width / deck.width
    const fw = frame.getBoundingClientRect().width / s, fh = frame.getBoundingClientRect().height / s
    const k = Math.max(fw / img.naturalWidth, fh / img.naturalHeight) * c.zoom
    const ox = img.naturalWidth * k - fw, oy = img.naturalHeight * k - fh
    const clamp = (v: number) => Math.max(0, Math.min(100, v))
    const fx = ox > 1 ? clamp(c.focus[0] - ((p.x - c.px) / ox) * 100) : c.focus[0]
    const fy = oy > 1 ? clamp(c.focus[1] - ((p.y - c.py) / oy) * 100) : c.focus[1]
    c.moved = true
    showCrop({ focus: [fx, fy], zoom: c.zoom })
  }
  function onWheel(e: React.WheelEvent) {
    if (!cropping) return
    if (!pathsAt(e.target).includes(cropping)) return
    e.stopPropagation()
    const c = cropState()
    showCrop({ focus: c.focus, zoom: Math.max(1, Math.min(4, c.zoom * Math.exp(-e.deltaY * 0.002))) })
    clearTimeout(wheelTimer.current)
    wheelTimer.current = setTimeout(commitCrop, 350)
  }

  function onPointerDown(e: RPointerEvent) {
    if (e.button !== 0 || editing) return
    if (cropping && cropDown(e)) return
    const chain = pathsAt(e.target)
    if (!chain.length) { onSelect(null); return }
    const top = topLevel(chain[chain.length - 1])
    const keep = selected && chain.includes(selected) ? selected : top
    if (keep !== selected) onSelect(keep)
    if (keep === top) begin(e, "move", top)
  }

  function onPointerMove(e: RPointerEvent) {
    if (crop.current) { cropMove(e); return }
    const g = gesture.current
    if (!g) {
      const chain = pathsAt(e.target)
      const h = chain.length ? topLevel(chain[chain.length - 1]) : null
      if (h !== hover) setHover(h)
      return
    }
    const p = toStage(e)
    const dx = p.x - g.px, dy = p.y - g.py
    if (!g.moved && Math.hypot(dx, dy) * scale < 4) return
    // Capture only once it's a real drag, so clicks and double-clicks keep their real target.
    if (!g.moved) root.current!.setPointerCapture(g.pointerId)
    g.moved = true
    let r: Rect = { ...g.start }
    if (g.kind === "move") { r.x += dx; r.y += dy }
    else {
      const hd = g.handle!
      if (hd.includes("e")) r.w = Math.max(40, g.start.w + dx)
      if (hd.includes("s")) r.h = Math.max(40, g.start.h + dy)
      if (hd.includes("w")) { r.w = Math.max(40, g.start.w - dx); r.x = g.start.x + g.start.w - r.w }
      if (hd.includes("n")) { r.h = Math.max(40, g.start.h - dy); r.y = g.start.y + g.start.h - r.h }
      if (e.shiftKey && hd.length === 2) { const ratio = g.start.w / g.start.h; r.h = r.w / ratio; if (hd.includes("n")) r.y = g.start.y + g.start.h - r.h }
    }
    if (!e.altKey) r = snap(r, g.path, g.kind === "resize" ? g.handle : undefined)
    g.latest = r
    setOverride({ [g.path]: boxFor(g, r) })
  }

  function boxFor(g: NonNullable<typeof gesture.current>, r: Rect): Box {
    const textish = TEXTISH.has(g.el.type)
    const keepH = !textish || g.el.props.h != null || (g.kind === "resize" && /[ns]/.test(g.handle!))
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: keepH ? Math.round(r.h) : undefined }
  }

  function onPointerUp() {
    if (crop.current) { const moved = crop.current.moved; crop.current = null; if (moved) commitCrop(); return }
    const g = gesture.current
    gesture.current = null
    setGuides({ x: [], y: [] })
    if (g?.moved && g.latest) onChangeBox(g.path, boxFor(g, g.latest))
    // Keep the override until the new source compiles in, to avoid a flash back to the old position.
    setTimeout(() => setOverride(undefined), 0)
  }

  function onDoubleClick(e: React.MouseEvent) {
    if (editing) return
    const chain = pathsAt(document.elementFromPoint(e.clientX, e.clientY))
    const image = [...chain].reverse().find((p) => findElement(slide.elements, p)?.type === "image")
    if (image && onCrop) { onSelect(image); onCrop(image); return }
    const path = [...chain].reverse().find((p) => { const el = findElement(slide.elements, p); return el && EDITABLE[el.type] })
    if (!path) return
    const el = findElement(slide.elements, path)!
    const node = root.current!.querySelector(`[data-path="${path}"]`) as HTMLElement
    const rect = measure(path)!
    const inner = (node.querySelector("h1,h2,blockquote,p,li,div") as HTMLElement) ?? node
    const cs = getComputedStyle(inner)
    const field = EDITABLE[el.type]
    const value = field === "items" ? ((el.props.items as string[]) ?? []).join("\n") : field === "value" ? String(el.props.value ?? "") : el.text ?? ""
    onSelect(path)
    setEditing({
      path, field, value, rect,
      style: { fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight as CSSProperties["fontWeight"], lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing, color: getComputedStyle(node).color, textAlign: cs.textAlign as CSSProperties["textAlign"] },
    })
  }

  function commitEdit(cancel = false) {
    if (!editing) return
    const el = findElement(slide.elements, editing.path)
    const original = el ? (editing.field === "items" ? ((el.props.items as string[]) ?? []).join("\n") : editing.field === "value" ? String(el.props.value ?? "") : el.text ?? "") : ""
    if (!cancel && editing.value !== original) onChangeText(editing.path, editing.field, editing.value)
    setEditing(null)
  }

  const sel = selected ? rects[selected] : undefined
  const hov = hover && hover !== selected ? rects[hover] : undefined
  const line = 2 / Math.max(scale, 0.05)
  const handleSize = 12 / Math.max(scale, 0.05)
  const selEl = selected ? findElement(slide.elements, selected) : undefined
  const canResize = !!selEl && selected === topLevel(selected!)

  const fileDrag = (e: React.DragEvent) => [...e.dataTransfer.types].includes("Files")
  const imageAt = (e: { clientX: number; clientY: number }) => [...pathsAt(document.elementFromPoint(e.clientX, e.clientY))].reverse().find((p) => findElement(slide.elements, p)?.type === "image")
  const crp = cropping ? rects[cropping] ?? measure(cropping) : undefined

  return (
    <div
      onDragOver={(e) => { if (!onDropFiles || !fileDrag(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; const p = imageAt(e) ?? "slide"; if (p !== dropAt) setDropAt(p) }}
      onDragLeave={(e) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setDropAt(null) }}
      onDrop={(e) => {
        setDropAt(null)
        if (!onDropFiles || !fileDrag(e)) return
        e.preventDefault()
        const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith("image/"))
        if (files.length) onDropFiles(files, { ...toStage(e), path: imageAt(e) })
      }}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => !gesture.current && setHover(null)}
      onDoubleClick={onDoubleClick}
      onClickCapture={(e) => { if ((e.target as HTMLElement).closest("a")) e.preventDefault() }}
      style={{ width: deck.width, height: deck.height, userSelect: "none", WebkitUserSelect: "none" }}
    >
    <SlideView
      ref={root}
      deck={deck}
      slide={slide}
      mode="edit"
      overrides={override}
      hidden={editing ? new Set([editing.path]) : undefined}
      style={{ cursor: crop.current ? "grabbing" : cropping ? "move" : gesture.current?.moved ? "grabbing" : "default", touchAction: "none" }}
    >
      {hov && !gesture.current && <div style={{ position: "absolute", left: hov.x, top: hov.y, width: hov.w, height: hov.h, outline: `${line}px dashed rgba(242,169,34,.7)`, pointerEvents: "none", zIndex: 20 }} />}
      {dropAt && (() => { const r = dropAt === "slide" ? { x: 0, y: 0, w: deck.width, h: deck.height } : measure(dropAt); return r ? <div style={{ position: "absolute", left: r.x, top: r.y, width: r.w, height: r.h, outline: `${line * 2}px dashed #f2a922`, outlineOffset: -line * 2, background: "rgba(242,169,34,.12)", pointerEvents: "none", zIndex: 25 }} /> : null })()}
      {crp && (
        <div style={{ position: "absolute", left: crp.x, top: crp.y, width: crp.w, height: crp.h, outline: `${line}px dashed #f2a922`, boxShadow: "0 0 0 100000px rgba(0,0,0,.45)", pointerEvents: "none", zIndex: 24, cursor: "move" }}>
          <div style={{ position: "absolute", top: -34 / scale, left: 0, fontSize: 12 / scale, color: "#18212b", background: "#f2a922", padding: `${2 / scale}px ${6 / scale}px`, borderRadius: 4 / scale, whiteSpace: "nowrap", fontFamily: "system-ui" }}>
            Crop · drag to reposition · scroll to zoom · Esc to finish
          </div>
        </div>
      )}
      {sel && !editing && !cropping && (
        <div style={{ position: "absolute", left: sel.x, top: sel.y, width: sel.w, height: sel.h, outline: `${line}px solid #f2a922`, pointerEvents: "none", zIndex: 21 }}>
          {canResize && (["nw", "n", "ne", "e", "se", "s", "sw", "w"] as Handle[]).map((hd) => (
            <div
              key={hd}
              onPointerDown={(e) => { e.stopPropagation(); begin(e, "resize", selected!, hd) }}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              style={{
                position: "absolute", width: handleSize, height: handleSize, background: "#fff", border: `${line}px solid #f2a922`, borderRadius: handleSize / 4, pointerEvents: "auto",
                left: hd.includes("w") ? -handleSize / 2 : hd.includes("e") ? sel.w - handleSize / 2 : sel.w / 2 - handleSize / 2,
                top: hd.includes("n") ? -handleSize / 2 : hd.includes("s") ? sel.h - handleSize / 2 : sel.h / 2 - handleSize / 2,
                cursor: `${hd}-resize`,
              }}
            />
          ))}
          {selEl?.props.x == null && selEl?.props.y == null && canResize && (
            <div style={{ position: "absolute", top: -34 / scale, left: 0, fontSize: 12 / scale, color: "#18212b", background: "#f2a922", padding: `${2 / scale}px ${6 / scale}px`, borderRadius: 4 / scale, whiteSpace: "nowrap", fontFamily: "system-ui" }}>
              {selEl.type} · in layout (drag to pin)
            </div>
          )}
        </div>
      )}
      {guides.x.map((x, i) => <div key={`gx${i}`} style={{ position: "absolute", left: x, top: 0, bottom: 0, width: line, background: "#f43f5e", zIndex: 30, pointerEvents: "none" }} />)}
      {guides.y.map((y, i) => <div key={`gy${i}`} style={{ position: "absolute", top: y, left: 0, right: 0, height: line, background: "#f43f5e", zIndex: 30, pointerEvents: "none" }} />)}
      {editing && (
        <textarea
          autoFocus
          value={editing.value}
          onChange={(e) => setEditing({ ...editing, value: e.target.value })}
          onBlur={() => commitEdit()}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === "Escape") commitEdit(true)
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey || (SINGLE_LINE.has(findElement(slide.elements, editing.path)?.type ?? "") && !e.shiftKey))) { e.preventDefault(); commitEdit() }
          }}
          ref={(n) => { if (n) { n.style.height = "auto"; n.style.height = Math.max(editing.rect.h, n.scrollHeight) + "px" } }}
          style={{
            ...editing.style,
            position: "absolute", left: editing.rect.x, top: editing.rect.y, width: Math.max(editing.rect.w, 200), minHeight: editing.rect.h,
            zIndex: 40, background: "color-mix(in srgb, var(--p-background) 92%, transparent)", outline: `${line}px solid #f2a922`, border: 0, resize: "none", padding: 0, margin: 0, overflow: "hidden",
          }}
        />
      )}
    </SlideView>
    </div>
  )
}

