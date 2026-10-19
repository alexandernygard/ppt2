import { useCallback, useEffect, useState } from "react"
import type { DeckModel, ElementNode } from "@ppt2/sdk"
import { SlideView } from "./SlideView"
import { Stage } from "./Stage"

export function maxStep(els: ElementNode[]): number {
  let m = 0
  for (const el of els) {
    if (typeof el.props.step === "number") m = Math.max(m, el.props.step)
    if (el.children) m = Math.max(m, maxStep(el.children))
  }
  return m
}

export interface PresenterProps {
  deck: DeckModel
  index: number
  step: number
  onNavigate: (index: number, step: number) => void
  onExit?: () => void
  /** Start in speaker view (current + next + notes + timer). */
  speaker?: boolean
  /** Audience-only window: ignores keyboard if controlled elsewhere. */
  passive?: boolean
}

/** Fullscreen presentation with builds, transitions and an optional speaker view. */
export function Presenter({ deck, index, step, onNavigate, onExit, speaker: speakerInit = false, passive }: PresenterProps) {
  const [speaker, setSpeaker] = useState(speakerInit)
  const [black, setBlack] = useState(false)
  const [started] = useState(() => Date.now())
  const [now, setNow] = useState(Date.now())
  const slide = deck.slides[Math.min(index, deck.slides.length - 1)]

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const next = useCallback(() => {
    if (!slide) return
    if (step < maxStep(slide.elements)) onNavigate(index, step + 1)
    else if (index < deck.slides.length - 1) onNavigate(index + 1, 0)
  }, [slide, step, index, deck.slides.length, onNavigate])
  const prev = useCallback(() => {
    if (step > 0) onNavigate(index, step - 1)
    else if (index > 0) onNavigate(index - 1, maxStep(deck.slides[index - 1].elements))
  }, [step, index, deck.slides, onNavigate])

  useEffect(() => {
    if (passive) return
    const onKey = (e: KeyboardEvent) => {
      if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter", "n"].includes(e.key)) { e.preventDefault(); next() }
      else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace", "p"].includes(e.key)) { e.preventDefault(); prev() }
      else if (e.key === "Home") onNavigate(0, 0)
      else if (e.key === "End") onNavigate(deck.slides.length - 1, 0)
      else if (e.key === "Escape") onExit?.()
      else if (e.key === "s" || e.key === "S") setSpeaker((v) => !v)
      else if (e.key === "b" || e.key === "B" || e.key === ".") setBlack((v) => !v)
      else if (e.key === "f" || e.key === "F") {
        if (document.fullscreenElement) document.exitFullscreen()
        else document.documentElement.requestFullscreen?.().catch(() => {})
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [next, prev, onExit, onNavigate, deck.slides.length, passive])

  if (!slide) return null
  const transition = slide.props.transition ?? "none"
  const current = (
    <div key={index} className={transition !== "none" ? `ppt2-transition-${transition}` : undefined} style={{ width: deck.width, height: deck.height }}>
      <SlideView deck={deck} slide={slide} mode="present" step={step} />
    </div>
  )
  const onClick = (e: React.MouseEvent) => { if (!passive) (e.clientX > window.innerWidth / 3 ? next : prev)() }

  if (!speaker) {
    return (
      <div style={{ position: "fixed", inset: 0, background: "#000", zIndex: 1000, cursor: "none" }} onClick={onClick}>
        <Stage width={deck.width} height={deck.height}>{current}</Stage>
        {black && <div style={{ position: "absolute", inset: 0, background: "#000" }} />}
      </div>
    )
  }

  const nextSlide = deck.slides[index + 1]
  const elapsed = Math.floor((now - started) / 1000)
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
  const steps = maxStep(slide.elements)
  return (
    <div style={{ position: "fixed", inset: 0, background: "#0d1117", color: "#e6edf3", zIndex: 1000, display: "grid", gridTemplateColumns: "1.7fr 1fr", gridTemplateRows: "auto 1fr auto", gap: 20, padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 15, opacity: 0.8 }}>
        <span>Slide {index + 1} / {deck.slides.length}{steps ? ` · build ${step}/${steps}` : ""}</span>
        <span style={{ fontVariantNumeric: "tabular-nums", fontSize: 28, fontWeight: 600, opacity: 1 }}>{fmt(elapsed)}</span>
        <span>←/→ navigate · S audience view · B black · Esc exit</span>
      </div>
      <div style={{ minHeight: 0, borderRadius: 12, overflow: "hidden", background: "#000" }} onClick={onClick}>
        <Stage width={deck.width} height={deck.height}>{current}</Stage>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, minHeight: 0 }}>
        <div style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: 1, opacity: 0.6 }}>Next</div>
        <div style={{ aspectRatio: `${deck.width}/${deck.height}`, borderRadius: 10, overflow: "hidden", background: "#000", opacity: nextSlide ? 1 : 0.3 }}>
          {nextSlide ? <Stage width={deck.width} height={deck.height}><SlideView deck={deck} slide={nextSlide} mode="static" /></Stage> : <div style={{ display: "grid", placeItems: "center", height: "100%" }}>End of deck</div>}
        </div>
        <div style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: 1, opacity: 0.6 }}>Notes</div>
        <div style={{ flex: 1, overflow: "auto", fontSize: 22, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{slide.notes || <span style={{ opacity: 0.4 }}>No notes for this slide.</span>}</div>
      </div>
      <div style={{ gridColumn: "1 / -1", height: 4, background: "#30363d", borderRadius: 2 }}>
        <div style={{ height: "100%", width: `${((index + 1) / deck.slides.length) * 100}%`, background: "#f2a922", borderRadius: 2, transition: "width .3s" }} />
      </div>
      {black && <div style={{ position: "fixed", inset: 0, background: "#000" }} onClick={() => setBlack(false)} />}
    </div>
  )
}
