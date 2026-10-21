// App state. The deck source string is the single source of truth: every
// edit — typed code, canvas gesture, AI tool call — produces a new source,
// which is compiled into the model the canvas renders.

import { create } from "zustand"
import { toast } from "@alexandernygard/components"
import {
  compile,
  setProps,
  setThemeProps,
  setText,
  moveSlide as moveSlidePatch,
  insertSlide,
  removeSlide,
  duplicateSlide as duplicateSlidePatch,
  insertElement,
  removeElement,
  duplicateElement,
  moveElement,
  elementCode,
  defineComponent,
  componentFromElement,
  renameComponent as renameComponentPatch,
  removeComponent,
  PatchError,
  STARTER_DECK,
  TAGS,
  type DeckModel,
  type Diagnostic,
  type ElementNode,
  type PatchResult,
  type SlideNode,
} from "@ppt2/sdk"
import { type Box, type DropTarget, type TextField } from "@ppt2/react"
import { addImages } from "./library"
import { canDrop, codeOf, componentSlide, elementAt as findAt, owned, resolveDrop, type DragItem } from "./lib/tree"
import { paletteItem } from "./lib/palette"

export type View = "split" | "canvas" | "code"
export type SidebarTab = "assistant" | "layers" | "components"
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
  sidebarTab: SidebarTab
  /** The component whose definition the canvas shows instead of a slide. */
  editingComponent: string | null
  /** An element being dragged from the palette, the components list or the layers tree. */
  dragging: DragItem | null
  /** Element hovered in the layers tree, outlined on the canvas. */
  hovered: string | null

  setSource: (source: string, origin: Origin) => void
  /** Load another deck: replaces the source and starts a fresh undo history. */
  openSource: (source: string) => void
  setCropping: (path: string | null) => void
  /** Store images with the deck and put them on the current slide (or into the image at `at.path`). */
  insertImages: (files: Blob[], at?: { x: number; y: number; path?: string }) => Promise<void>
  undo: () => void
  redo: () => void
  setView: (v: View) => void
  setSidebarTab: (tab: SidebarTab) => void
  setDragging: (item: DragItem | null) => void
  setHovered: (path: string | null) => void
  editComponent: (name: string | null) => void
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
  /** Insert code where `target` says, or into the selected container / the current slide. */
  insertCode: (code: string, target?: DropTarget) => void
  /** Whether the current drag may go into `parent` (null = the slide) on the canvas. */
  canDropHere: (parent: string | null) => boolean
  /** Drop the current drag at `target`. */
  dropAt: (target: DropTarget) => void
  /** Define a component with default content and open it in the component editor. */
  newComponent: (name: string) => void
  /** Make the selected element a component; it becomes the first use. */
  componentFromSelection: (name: string, slot: boolean) => void
  renameComponent: (from: string, to: string) => void
  deleteComponent: (name: string) => void
  addSlide: (layout?: string) => void
  duplicateSlide: (index: number) => void
  deleteSlide: (index: number) => void
  moveSlide: (from: number, to: number) => void
  setTheme: (theme: string) => void
  /** Set or remove (undefined) brand-kit keys of the deck's theme. */
  setBrand: (values: Record<string, unknown>) => void
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
  sidebarTab: "assistant",
  editingComponent: null,
  dragging: null,
  hovered: null,

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
    set({ source, ...c, deck: c.deck, past: [], future: [], current: 0, selected: null, cropping: null, editingComponent: null, lastOrigin: "load", revision: get().revision + 1, aiPreview: null })
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
  setSidebarTab: (sidebarTab) => set({ sidebarTab }),
  setDragging: (dragging) => set({ dragging }),
  setHovered: (hovered) => { if (hovered !== get().hovered) set({ hovered }) },
  editComponent: (editingComponent) => set({ editingComponent, selected: null, cropping: null, hovered: null }),
  go: (index) => {
    const n = get().deck?.slides.length ?? 0
    set({ current: Math.max(0, Math.min(index, n - 1)), selected: null, cropping: null, editingComponent: null })
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
    noteComponentEdit(path)
    get().patch((src, deck) => {
      const at = srcOf(deck, path)
      if (field === "items") return setProps(src, at, { items: value.split("\n").map((l) => l.trim()).filter(Boolean) })
      if (field === "value") return setProps(src, at, { value })
      return setText(src, at, value)
    }, "Text edit")
  },
  setElementProps(path, props) {
    noteComponentEdit(path)
    get().patch((src, deck) => setProps(src, srcOf(deck, path), props))
  },
  deleteElement(path) {
    if (!ownedHere(path, "remove")) return
    if (get().patch((src, deck) => removeElement(src, srcOf(deck, path)), "Delete")) set({ selected: null })
  },
  duplicateSelected() {
    const { selected } = get()
    if (!selected || !ownedHere(selected, "duplicate")) return
    get().patch((src, deck) => {
      const el = elementAt(deck, selected)
      const abs = el.props.x != null || el.props.y != null
      return duplicateElement(src, srcOf(deck, selected), abs ? { x: (el.props.x ?? 0) + 40, y: (el.props.y ?? 0) + 40 } : {})
    }, "Duplicate")
  },
  addElement(type, props) {
    const code = type === "icon" && props ? elementCode("icon", props) : (paletteItem(type) ?? paletteItem("text")!).code()
    get().insertCode(code)
  },
  insertCode(code, target) {
    const { deck, selected, current, editingComponent: owner } = get()
    const ctx = canvasContext()
    if (!deck || !ctx.slide) { toast.error("Fix the code errors first"); return }
    let parent = target?.parent ?? null
    let index = target?.index ?? Infinity
    if (!target) {
      // Into the selected container when there is one, else onto the slide (or the component's root).
      const sel = selected ? findAt(deck, selected) : undefined
      const tag = /^<([A-Za-z]\w*)/.exec(code)?.[1]
      const item: DragItem = { kind: "new", type: Object.keys(TAGS).find((k) => TAGS[k] === tag) ?? "card", code }
      const into = sel?.children && canDrop(deck, ctx.slide, owner ?? undefined, item, sel.path) ? sel : owner ? ctx.slide.elements[0] : undefined
      parent = into?.path ?? null
    }
    const siblings = parent ? findAt(deck, parent)?.children ?? [] : ctx.slide.elements
    index = Math.min(index, siblings.length)
    const r = resolveDrop(ctx.slide, owner ?? undefined, parent, index)
    if (!r) { toast.warning(owner ? "Drop it inside the component's root, or a container in it." : "That part belongs to a component. Edit the component to add to it."); return }
    // On a blank slide, a drop lands where it was dropped.
    if (target && parent == null && ctx.slide.layout === "blank") code = setProps(code, 0, { x: target.x, y: target.y }).source
    if (get().patch((src) => insertElement(src, r.parentSrc, code, r.index), "Insert")) {
      set({ selected: parent ? `${parent}/${index}` : `${current}/${index}` })
    }
  },
  canDropHere(parent) {
    const { deck, dragging, editingComponent } = get()
    const { slide } = canvasContext()
    return !!(deck && slide && dragging && canDrop(deck, slide, editingComponent ?? undefined, dragging, parent))
  },
  dropAt(target) {
    const { deck, dragging, editingComponent } = get()
    const { slide } = canvasContext()
    set({ dragging: null })
    if (!deck || !slide || !dragging || !canDrop(deck, slide, editingComponent ?? undefined, dragging, target.parent)) return
    if (dragging.kind === "new") { get().insertCode(dragging.code, target); return }
    if (dragging.kind === "component") {
      get().insertCode(instanceCode(deck, dragging.name), target)
      return
    }
    const el = findAt(deck, dragging.path)
    const r = resolveDrop(slide, editingComponent ?? undefined, target.parent, target.index)
    if (!el || !r) return
    get().patch((src) => moveElement(src, codeOf(el)!, r.parentSrc, r.index), "Move")
    set({ selected: null })
  },
  newComponent(name) {
    const code = `<Card>\n  <Title size="sm">${name}</Title>\n  <Slot />\n</Card>`
    if (get().patch((src) => defineComponent(src, name, code), "New component")) get().editComponent(name)
  },
  componentFromSelection(name, slot) {
    const { selected } = get()
    if (!selected || !ownedHere(selected, "turn into a component")) return
    get().patch((src, deck) => componentFromElement(src, srcOf(deck, selected), name, { slot }), "Make component")
  },
  renameComponent(from, to) {
    if (get().patch((src) => renameComponentPatch(src, from, to), "Rename") && get().editingComponent === from) set({ editingComponent: to })
  },
  deleteComponent(name) {
    if (get().patch((src) => removeComponent(src, name), "Delete component") && get().editingComponent === name) get().editComponent(null)
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
    // Keeps the brand kit (logo, footer, fonts…) and swaps only the base theme.
    get().patch((src, deck) => setThemeProps(src, deck.src!, { base: theme }), "Theme")
  },
  setBrand(values) {
    get().patch((src, deck) => setThemeProps(src, deck.src!, values), "Brand")
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
  const el = findAt(deck, path)
  if (!el) throw new PatchError("That element no longer exists.")
  return el
}

function srcOf(deck: DeckModel, path: string): number {
  const el = elementAt(deck, path)
  const src = codeOf(el)
  if (src == null) throw new PatchError("This element was created implicitly (bare text). Edit it in the code view.")
  return src
}

const hasSlot = (el: ElementNode): boolean => el.type === "slot" || !!el.children?.some(hasSlot)

/** Code for a new use of a component: with a line of text in its slot, if it has one. */
export function instanceCode(deck: DeckModel, name: string): string {
  const def = deck.components.find((c) => c.name === name)
  return def?.template && hasSlot(def.template) ? `<${name}>\n  <Text>Text</Text>\n</${name}>` : `<${name} />`
}

/** What the canvas edits: the current slide, or the component being edited. */
export function canvasContext(s = useStore.getState()): { slide?: SlideNode; owner?: string } {
  if (!s.deck) return {}
  if (s.editingComponent) return { slide: componentSlide(s.deck, s.editingComponent), owner: s.editingComponent }
  return { slide: s.deck.slides[s.current] }
}

/** Parts of a component can only be added, moved or removed in the component editor. */
function ownedHere(path: string, action: string): boolean {
  const s = useStore.getState()
  const el = s.deck && findAt(s.deck, path)
  if (!el || owned(el, s.editingComponent ?? undefined)) return true
  toast.warning(`This is part of the ${el.component} component. Edit the component to ${action} it.`, {
    action: { label: "Edit component", onClick: () => s.editComponent(el.component!) },
  })
  return false
}

const noted = new Set<string>()
/** Editing a component's part from a slide changes every use: say so, once per component. */
function noteComponentEdit(path: string) {
  const s = useStore.getState()
  const el = s.deck && findAt(s.deck, path)
  const name = el?.component
  if (!name || name === s.editingComponent || noted.has(name)) return
  noted.add(name)
  const uses = s.deck!.components.find((c) => c.name === name)?.uses ?? 0
  toast.info(`Edited the ${name} component${uses > 1 ? `, used ${uses} times` : ""}. Every use changes.`)
}

/** The deck to show: the AI's streaming preview while it writes, else the compiled source. */
export const useVisibleDeck = () => useStore((s) => s.aiPreview?.deck ?? s.deck)

if (import.meta.env.DEV) (window as unknown as { __ppt2: typeof useStore }).__ppt2 = useStore
