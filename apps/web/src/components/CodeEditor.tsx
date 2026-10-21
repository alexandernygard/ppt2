import { useEffect, useRef } from "react"
import { basicSetup } from "codemirror"
import { EditorView, Decoration, type DecorationSet, keymap } from "@codemirror/view"
import { EditorState, StateEffect, StateField, Annotation, Compartment } from "@codemirror/state"
import { javascript } from "@codemirror/lang-javascript"
import { indentWithTab } from "@codemirror/commands"
import { elementAtOffset, elementRange, type ElementNode } from "@ppt2/sdk"
import { codeOf, elementAt } from "../lib/tree"
import { useStore } from "../store"

const External = Annotation.define<boolean>()
const setFlash = StateEffect.define<{ from: number; to: number } | null>()
const setSelectedRange = StateEffect.define<{ from: number; to: number } | null>()

function rangeField(effect: typeof setFlash, cls: string) {
  return StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(deco, tr) {
      deco = deco.map(tr.changes)
      for (const e of tr.effects) {
        if (e.is(effect)) {
          if (!e.value || e.value.from >= e.value.to) return Decoration.none
          const doc = tr.state.doc
          const from = doc.lineAt(e.value.from).from
          const to = doc.lineAt(Math.min(e.value.to, doc.length)).to
          const lines = []
          for (let pos = from; pos <= to; ) {
            const line = doc.lineAt(pos)
            lines.push(Decoration.line({ class: cls }).range(line.from))
            pos = line.to + 1
          }
          return Decoration.set(lines)
        }
      }
      return deco
    },
    provide: (f) => EditorView.decorations.from(f),
  })
}
const flashField = rangeField(setFlash, "cm-flash")
const selectedField = rangeField(setSelectedRange, "cm-selected-element")

/** Smallest single replacement that turns a into b (keeps cursor and scroll stable). */
function diff(a: string, b: string) {
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length, endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB-- }
  return { from: start, to: endA, insert: b.slice(start, endB) }
}

const theme = EditorView.theme({
  "&": { backgroundColor: "transparent" },
  ".cm-gutters": { backgroundColor: "transparent", border: "none", color: "var(--muted-foreground)" },
  ".cm-activeLineGutter, .cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--foreground) 4%, transparent)" },
})

export function CodeEditor() {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView>(null)
  const readOnly = useRef(new Compartment())
  const aiSource = useStore((s) => s.aiPreview?.source)
  const source = useStore((s) => s.source)
  const revision = useStore((s) => s.revision)
  const selected = useStore((s) => s.selected)
  const editingComponent = useStore((s) => s.editingComponent)
  const current = useStore((s) => s.current)
  const deck = useStore((s) => s.deck)

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: useStore.getState().source,
        extensions: [
          basicSetup,
          keymap.of([indentWithTab]),
          javascript({ jsx: true, typescript: true }),
          theme,
          flashField,
          selectedField,
          readOnly.current.of(EditorState.readOnly.of(false)),
          EditorView.updateListener.of((u) => {
            const external = u.transactions.some((t) => t.annotation(External))
            if (u.docChanged && !external) useStore.getState().setSource(u.state.doc.toString(), "code")
            // Code → canvas: move the canvas selection to the element under the cursor.
            if (u.selectionSet && !external && u.view.hasFocus) syncCanvasToCursor(u.state.doc.toString(), u.state.selection.main.head)
          }),
        ],
      }),
    })
    view.current = v
    return () => v.destroy()
  }, [])

  // External changes (canvas, AI, undo): apply as a minimal diff and flash the changed lines.
  const shown = aiSource ?? source
  useEffect(() => {
    const v = view.current
    if (!v) return
    const cur = v.state.doc.toString()
    if (cur === shown) return
    const change = diff(cur, shown)
    const end = change.from + change.insert.length
    v.dispatch({
      changes: change,
      annotations: External.of(true),
      effects: [setFlash.of({ from: change.from, to: Math.max(end, change.from + 1) }), ...(v.hasFocus ? [] : [EditorView.scrollIntoView(change.from, { y: "center" })])],
    })
    const t = setTimeout(() => v.dispatch({ effects: setFlash.of(null) }), 1200)
    return () => clearTimeout(t)
  }, [shown, revision])

  useEffect(() => {
    view.current?.dispatch({ effects: readOnly.current.reconfigure(EditorState.readOnly.of(aiSource != null)) })
  }, [aiSource != null])

  // Canvas → code: highlight the selected element's source.
  useEffect(() => {
    const v = view.current
    if (!v || !deck || v.hasFocus || useStore.getState().errors.length) return
    const el = selected ? elementAt(deck, selected) : undefined
    const target = el ? codeOf(el) : editingComponent ? deck.components.find((c) => c.name === editingComponent)?.template?.src : deck.slides[current]?.src
    const range = target != null ? elementRange(source, target) : undefined
    v.dispatch({ effects: [setSelectedRange.of(range ? { from: range.start, to: range.end } : null), ...(range ? [EditorView.scrollIntoView(range.start, { y: "start", yMargin: 40 })] : [])] })
  }, [selected, current, deck, editingComponent])

  return <div ref={host} className="h-full min-h-0 overflow-hidden" />
}

let syncTimer: ReturnType<typeof setTimeout> | undefined
function syncCanvasToCursor(source: string, pos: number) {
  clearTimeout(syncTimer)
  syncTimer = setTimeout(() => {
    const { deck, current, selected, editingComponent } = useStore.getState()
    if (!deck) return
    const chain = elementAtOffset(source, pos)
    const deepest = (els: ElementNode[]) => {
      let found: string | null = null
      const visit = (list: ElementNode[]) => { for (const el of list) { const src = codeOf(el); if (src != null && chain.includes(src)) found = el.path; if (el.children) visit(el.children) } }
      visit(els)
      return found
    }
    for (const s of deck.slides) {
      if (s.src == null || !chain.includes(s.src)) continue
      const found = deepest(s.elements)
      if (s.index !== current || found !== selected || editingComponent) useStore.setState({ current: s.index, selected: found, editingComponent: null })
      return
    }
    // In a component's definition: open it in the component editor.
    const def = deck.components.find((c) => c.template?.src != null && chain.includes(c.template.src))
    if (def?.template) {
      const found = deepest([def.template])
      if (def.name !== editingComponent || found !== selected) useStore.setState({ editingComponent: def.name, selected: found })
    }
  }, 120)
}
