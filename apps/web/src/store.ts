// App state. The deck source string is the single source of truth: every
// edit — typed code, canvas gesture, AI tool call — produces a new source,
// which is compiled into the model the canvas renders.

import { create } from "zustand"
import { toast } from "@alexandernygard/components"
import {
  compile,
  setProps,
  setText,
  moveSlide as moveSlidePatch,
  insertSlide,
  removeSlide,
  duplicateSlide as duplicateSlidePatch,
  insertElement,
  removeElement,
  duplicateElement,
  elementCode,
  PatchError,
  STARTER_DECK,
  type DeckModel,
  type Diagnostic,
  type ElementNode,
  type PatchResult,
} from "@ppt2/sdk"
import { findElement, type Box, type TextField } from "@ppt2/react"
import { addImages } from "./library"

export type View = "split" | "canvas" | "code"
type Origin = "code" | "canvas" | "ai" | "history" | "load"

interface State {
  source: string
  deck?: DeckModel
  errors: Diagnostic[]
  warnings: Diagnostic[]
  current: number
  selected: string | null
  view: View
  past: string[]
  future: string[]
  lastOrigin: Origin
  /** Bumped on every non-code change so the editor can flash what changed. */
  revision: number
  /** While the AI streams a new deck: the raw code so far and a best-effort compiled preview. */
  aiPreview: { source: string; deck?: DeckModel } | null
  presenting: { index: number; step: number; speaker: boolean } | null
  /** Image being cropped on the canvas. */
  cropping: string | null

  setSource: (source: string, origin: Origin) => void
  /** Load another deck: replaces the source and starts a fresh undo history. */
  openSource: (source: string) => void
  setCropping: (path: string | null) => void
  /** Store images with the deck and put them on the current slide (or into the image at `at.path`). */
  insertImages: (files: Blob[], at?: { x: number; y: number; path?: string }) => Promise<void>
  undo: () => void
  redo: () => void
  setView: (v: View) => void
  go: (index: number) => void
  select: (path: string | null) => void
  present: (opts?: { speaker?: boolean; fromStart?: boolean }) => void

  // Canvas operations, all compiled to source patches.
  patch: (fn: (source: string, deck: DeckModel) => PatchResult | string, label?: string) => boolean
  setElementBox: (path: string, box: Box) => void
  setElementText: (path: string, field: TextField, value: string) => void
  setElementProps: (path: string, props: Record<string, unknown>) => void
  deleteElement: (path: string) => void
  duplicateSelected: () => void
  addElement: (type: string, props?: Record<string, unknown>) => void
  addSlide: (layout?: string) => void
  duplicateSlide: (index: number) => void
  deleteSlide: (index: number) => void
  moveSlide: (from: number, to: number) => void
  setTheme: (theme: string) => void
  setSlideProps: (index: number, props: Record<string, unknown>) => void
  setNotes: (index: number, text: string) => void
}

const STORAGE_KEY = "ppt2.source"
const initial = (() => {
  try { return localStorage.getItem(STORAGE_KEY) || STARTER_DECK } catch { return STARTER_DECK }
})()

function compiled(source: string) {
  const r = compile(source)
  return { errors: r.errors, warnings: r.warnings, ...(r.deck ? { deck: r.deck } : {}) }
}

let lastCodePush = 0

export const useStore = create<State>()((set, get) => ({
  source: initial,
  ...compiled(initial),
  current: 0,
  selected: null,
  view: "split",
  past: [],
  future: [],
  lastOrigin: "load",
  revision: 0,
  aiPreview: null,
  presenting: null,
  cropping: null,

  setSource(source, origin) {
    const s = get()
    if (source === s.source) return
    // Coalesce typing into one undo step per pause; every other edit is its own step.
    const push = origin !== "history" && (origin !== "code" || Date.now() - lastCodePush > 1200)
    if (origin === "code") lastCodePush = Date.now()
    const c = compiled(source)
    const deck = c.deck ?? s.deck
    set({
      source,
      ...c,
      deck,
      past: push ? [...s.past.slice(-200), s.source] : s.past,
      future: origin === "history" ? s.future : [],
      lastOrigin: origin,
      revision: origin === "code" ? s.revision : s.revision + 1,
      current: Math.min(s.current, Math.max(0, (deck?.slides.length ?? 1) - 1)),
    })
    try { localStorage.setItem(STORAGE_KEY, source) } catch { /* private mode */ }
  },

  openSource(source) {
    const c = compiled(source)
    set({ source, ...c, deck: c.deck, past: [], future: [], current: 0, selected: null, cropping: null, lastOrigin: "load", revision: get().revision + 1, aiPreview: null })
    try { localStorage.setItem(STORAGE_KEY, source) } catch { /* private mode */ }
  },
  setCropping: (cropping) => set({ cropping, ...(cropping ? { selected: cropping } : {}) }),
  async insertImages(files, at) {
    const { current, deck } = get()
    if (!deck) { toast.error("Fix the code errors first"); return }
    let added: Awaited<ReturnType<typeof addImages>>
    try { added = await addImages(files) } catch (e) { toast.error(`Couldn't add the image: ${(e as Error).message}`); return }
    if (at?.path && added.length) {
      get().setElementProps(at.path, { src: added.shift()!.ref })
      if (!added.length) return
    }
    const slide = get().deck?.slides[current]
    if (!slide) return
    // A free media slot takes the first image in the flow; others are placed where they were dropped.
    const hasMediaSlot = ["image-left", "image-right", "full-image"].includes(slide.layout)
    let mediaFree = hasMediaSlot && !slide.elements.some((e) => e.type === "image" && e.props.x == null && e.props.y == null)
    added.forEach((img, i) => {
      let code: string
      if (mediaFree) { code = elementCode("image", { src: img.ref, alt: "" }); mediaFree = false }
      else {
        const aspect = img.width && img.height ? img.width / img.height : 4 / 3
        const w = Math.round(aspect >= 1 ? 720 : 520 * aspect), h = Math.round(w / aspect)
        const W = get().deck!.width, H = get().deck!.height
        const cx = (at?.x ?? W / 2) + i * 40, cy = (at?.y ?? H / 2) + i * 40
        const x = Math.round(Math.max(0, Math.min(W - w, cx - w / 2))), y = Math.round(Math.max(0, Math.min(H - h, cy - h / 2)))
        code = elementCode("image", { src: img.ref, alt: "", x, y, w, h })
      }
      const before = get().deck?.slides[current]?.elements.length ?? 0
      if (get().patch((src, d) => insertElement(src, d.slides[current].src!, code), "Insert image")) set({ selected: `${current}/${before}` })
    })
  },

  undo() {
    const { past, source, future } = get()
    if (!past.length) return
    const prev = past[past.length - 1]
    set({ past: past.slice(0, -1), future: [source, ...future] })
    get().setSource(prev, "history")
  },
  redo() {
    const { future, source, past } = get()
    if (!future.length) return
    const [next, ...rest] = future
    set({ future: rest, past: [...past, source] })
    get().setSource(next, "history")
  },

  setView: (view) => set({ view }),
  go: (index) => {
    const n = get().deck?.slides.length ?? 0
    set({ current: Math.max(0, Math.min(index, n - 1)), selected: null, cropping: null })
  },
  select: (selected) => set({ selected, ...(selected !== get().cropping ? { cropping: null } : {}) }),
  present: (opts) => {
    if (!get().deck?.slides.length) return
    set({ presenting: { index: opts?.fromStart ? 0 : get().current, step: 0, speaker: !!opts?.speaker } })
    document.documentElement.requestFullscreen?.().catch(() => {})
  },

  patch(fn, label) {
    const { source, deck } = get()
    if (!deck) { toast.error("Fix the code errors first"); return false }
    try {
      const r = fn(source, deck)
      const result = typeof r === "string" ? { source: r } : r
      if (result.template) toast.info("Edited a template — the change applies to every copy it generates.")
      get().setSource(result.source, "canvas")
      return true
    } catch (e) {
      if (e instanceof PatchError) toast.warning(e.message)
      else { console.error(e); toast.error(`${label ?? "Edit"} failed: ${(e as Error).message}`) }
      return false
    }
  },

  setElementBox(path, box) {
    get().patch((src, deck) => setProps(src, srcOf(deck, path), box), "Move")
  },
  setElementText(path, field, value) {
    get().patch((src, deck) => {
      const at = srcOf(deck, path)
      if (field === "items") return setProps(src, at, { items: value.split("\n").map((l) => l.trim()).filter(Boolean) })
      if (field === "value") return setProps(src, at, { value })
      return setText(src, at, value)
    }, "Text edit")
  },
  setElementProps(path, props) {
    get().patch((src, deck) => setProps(src, srcOf(deck, path), props))
  },
  deleteElement(path) {
    if (get().patch((src, deck) => removeElement(src, srcOf(deck, path)), "Delete")) set({ selected: null })
  },
  duplicateSelected() {
    const { selected } = get()
    if (!selected) return
    get().patch((src, deck) => {
      const el = elementAt(deck, selected)
      const abs = el.props.x != null || el.props.y != null
      return duplicateElement(src, srcOf(deck, selected), abs ? { x: (el.props.x ?? 0) + 40, y: (el.props.y ?? 0) + 40 } : {})
    }, "Duplicate")
  },
  addElement(type, props) {
    const { current } = get()
    if (type === "icon" && props) {
      const before = get().deck?.slides[current]?.elements.length ?? 0
      if (get().patch((src, deck) => insertElement(src, deck.slides[current].src!, elementCode("icon", props)), "Insert")) set({ selected: `${current}/${before}` })
      return
    }
    const code: Record<string, string> = {
      text: elementCode("text", {}, "New text"),
      title: elementCode("title", {}, "New title"),
      list: elementCode("list", { items: ["First point", "Second point"] }),
      image: elementCode("image", { src: `https://picsum.photos/seed/${Math.random().toString(36).slice(2, 7)}/1200/800`, alt: "" }),
      shape: elementCode("shape", { kind: "rect", fill: "accent", x: 760, y: 390, w: 400, h: 300, radius: 24 }),
      chart: elementCode("chart", { type: "bar", data: [{ label: "A", value: 3 }, { label: "B", value: 5 }, { label: "C", value: 8 }], category: "label", series: "value" }),
      stat: elementCode("stat", { value: "42%", label: "Something that grew" }),
      quote: elementCode("quote", { by: "Someone wise" }, "A short, memorable line."),
      code: `<Code lang="ts">{\`const deck = compile(source)\`}</Code>`,
      icon: elementCode("icon", { name: "sparkles" }),
      flow: `<Flow>\n  <Step icon="lightbulb">Idea</Step>\n  <Step icon="pencil">Draft</Step>\n  <Step icon="users">Review</Step>\n  <Step icon="rocket" highlight>Ship</Step>\n</Flow>`,
      timeline: `<Timeline>\n  <Step date="Q1">Research</Step>\n  <Step date="Q2">Beta</Step>\n  <Step date="Q3" highlight>Launch</Step>\n  <Step date="Q4">Scale</Step>\n</Timeline>`,
      tree: `<Tree>\n  <Node sub="Name">\n    CEO\n    <Node sub="Name">CTO</Node>\n    <Node sub="Name">COO</Node>\n    <Node sub="Name">CFO</Node>\n  </Node>\n</Tree>`,
      cycle: `<Cycle>\n  <Step icon="search">Discover</Step>\n  <Step icon="pencil-ruler">Design</Step>\n  <Step icon="hammer">Build</Step>\n  <Step icon="chart-line">Measure</Step>\n</Cycle>`,
    }
    const before = get().deck?.slides[current]?.elements.length ?? 0
    if (get().patch((src, deck) => insertElement(src, deck.slides[current].src!, code[type] ?? code.text), "Insert")) {
      set({ selected: `${current}/${before}` })
    }
  },
  addSlide(layout = "content") {
    const { current } = get()
    const code = layout === "title"
      ? `<Slide layout="title">\n  <Title>New section</Title>\n  <Subtitle>Subtitle</Subtitle>\n</Slide>`
      : `<Slide layout="${layout}">\n  <Title>New slide</Title>\n  <Text>Click to edit, or ask the AI to fill this in.</Text>\n  <Notes>What should the speaker say here?</Notes>\n</Slide>`
    if (get().patch((src, deck) => insertSlide(src, deck.src!, current + 1, code), "Add slide")) get().go(current + 1)
  },
  duplicateSlide(index) {
    if (get().patch((src, deck) => duplicateSlidePatch(src, deck.src!, index), "Duplicate slide")) get().go(index + 1)
  },
  deleteSlide(index) {
    if ((get().deck?.slides.length ?? 0) <= 1) return
    if (get().patch((src, deck) => removeSlide(src, deck.src!, index), "Delete slide")) get().go(Math.min(index, (get().deck?.slides.length ?? 1) - 1))
  },
  moveSlide(from, to) {
    if (from === to) return
    if (get().patch((src, deck) => moveSlidePatch(src, deck.src!, from, to), "Reorder")) set({ current: to, selected: null })
  },
  setTheme(theme) {
    get().patch((src, deck) => setProps(src, deck.src!, { theme }), "Theme")
  },
  setSlideProps(index, props) {
    get().patch((src, deck) => setProps(src, deck.slides[index].src!, props), "Slide")
  },
  setNotes(index, text) {
    get().patch((src, deck) => {
      const slide = deck.slides[index]
      if (slide.notesSrc?.kind === "element") return setText(src, slide.notesSrc.src, text)
      if (slide.notesSrc?.kind === "prop") return setProps(src, slide.src!, { notes: text || undefined })
      return insertElement(src, slide.src!, elementCode("notes", {}, text))
    }, "Notes")
  },
}))

function elementAt(deck: DeckModel, path: string): ElementNode {
  const slide = deck.slides[Number(path.split("/")[0])]
  const el = slide && findElement(slide.elements, path)
  if (!el) throw new PatchError("That element no longer exists.")
  return el
}

function srcOf(deck: DeckModel, path: string): number {
  const el = elementAt(deck, path)
  if (el.src == null) throw new PatchError("This element was created implicitly (bare text). Edit it in the code view.")
  return el.src
}

/** The deck to show: the AI's streaming preview while it writes, else the compiled source. */
export const useVisibleDeck = () => useStore((s) => s.aiPreview?.deck ?? s.deck)

if (import.meta.env.DEV) (window as unknown as { __ppt2: typeof useStore }).__ppt2 = useStore
