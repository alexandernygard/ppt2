// The AI co-author: a streaming tool-use loop that edits the deck source.
// Runs entirely in the browser with the user's own API key.

import Anthropic from "@anthropic-ai/sdk"
import { create } from "zustand"
import { toJpeg } from "html-to-image"
import { applyEdits, compile, elementRange, lintDeck, outline, PatchError, type Diagnostic } from "@ppt2/sdk"
import { findElement, inspectSlideElement } from "@ppt2/react"
import { useLibrary } from "../library"
import { useStore } from "../store"
import { farmSlide, settled } from "../components/RenderFarm"
import { SYSTEM_PROMPT, userTurn } from "./prompt"
import { useSettings } from "./settings"

export type Block =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool"; id: string; name: string; status: "running" | "done" | "error"; label: string; detail?: string }
  | { kind: "variants"; slide: number; variants: { title: string; description?: string; code: string }[]; applied?: number }
  | { kind: "error"; text: string }

export interface ChatMessage {
  id: string
  role: "user" | "assistant"
  text?: string
  attachments?: string[]
  blocks: Block[]
}

const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "write_deck",
    description: "Replace the entire deck source with new TSX. Use for new decks, full restyles or restructures. The canvas renders slides as you stream them.",
    eager_input_streaming: true,
    input_schema: { type: "object", properties: { source: { type: "string", description: "Complete TSX module that default-exports a <Deck>." } }, required: ["source"] },
  },
  {
    name: "edit_deck",
    description: "Surgical edits: each `old` must match the current source exactly once (include enough surrounding lines). Applied in order. Preferred for targeted changes.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: { edits: { type: "array", items: { type: "object", properties: { old: { type: "string" }, new: { type: "string" } }, required: ["old", "new"] } } },
      required: ["edits"],
    },
  },
  {
    name: "propose_variants",
    description: "Show the user 2–3 alternative versions of one slide as rendered previews; they choose which to apply. Each variant is the full <Slide>…</Slide> code. Consts from the deck source are in scope.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        slide: { type: "integer", description: "1-based slide number to replace" },
        variants: { type: "array", items: { type: "object", properties: { title: { type: "string" }, description: { type: "string" }, code: { type: "string" } }, required: ["title", "code"] } },
      },
      required: ["slide", "variants"],
    },
  },
  {
    name: "inspect_deck",
    description: "Look at the rendered deck: returns layout problems (overflow, density) and, if screenshots is true, images of the requested slides (max 4).",
    input_schema: {
      type: "object",
      properties: { slides: { type: "array", items: { type: "integer" }, description: "1-based slide numbers; default all" }, screenshots: { type: "boolean" } },
    },
  },
]

const LABELS: Record<string, [string, string]> = {
  write_deck: ["Writing the deck", "Wrote the deck"],
  edit_deck: ["Editing", "Edited the deck"],
  propose_variants: ["Drafting alternatives", "Proposed alternatives"],
  inspect_deck: ["Looking at the slides", "Inspected the slides"],
}

interface ChatState {
  messages: ChatMessage[]
  history: Anthropic.Beta.BetaMessageParam[]
  running: boolean
  abort?: AbortController
  send: (text: string, attachments?: { name: string; text: string }[]) => Promise<void>
  stop: () => void
  reset: () => void
  markApplied: (msgId: string, blockIndex: number, variant: number) => void
}

const uid = () => Math.random().toString(36).slice(2)

export const useChat = create<ChatState>()((set, get) => ({
  messages: [],
  history: [],
  running: false,
  stop() {
    get().abort?.abort()
    useStore.setState({ aiPreview: null })
    set({ running: false })
  },
  reset() {
    get().stop()
    set({ messages: [], history: [] })
  },
  markApplied(msgId, bi, v) {
    set({ messages: get().messages.map((m) => (m.id !== msgId ? m : { ...m, blocks: m.blocks.map((b, i) => (i === bi && b.kind === "variants" ? { ...b, applied: v } : b)) })) })
  },
  async send(text, attachments = []) {
    const { apiKey, model, effort } = useSettings.getState()
    if (!apiKey) throw new Error("NO_KEY")
    const app = useStore.getState()
    const slide = app.deck?.slides[app.current]
    const sel = app.selected && slide ? findElement(slide.elements, app.selected) : undefined
    const selCode = sel?.src != null ? app.source.slice(sel.src, sourceEnd(app.source, sel.src)) : undefined

    const history = [...get().history, { role: "user" as const, content: userTurn({ text, source: app.source, slide: app.current, selection: app.selected ? { path: app.selected, code: selCode } : undefined, attachments, assets: useLibrary.getState().assets }) }]
    const assistantId = uid()
    const abort = new AbortController()
    set({
      history,
      running: true,
      abort,
      messages: [...get().messages, { id: uid(), role: "user", text, attachments: attachments.map((a) => a.name), blocks: [] }, { id: assistantId, role: "assistant", blocks: [] }],
    })

    const update = (fn: (blocks: Block[]) => Block[]) =>
      set({ messages: get().messages.map((m) => (m.id === assistantId ? { ...m, blocks: fn(m.blocks) } : m)) })
    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true })
    const withFallback = model.startsWith("claude-opus") || model.startsWith("claude-sonnet")

    try {
      for (let turn = 0; turn < 24; turn++) {
        const params: Record<string, unknown> = {
          model,
          max_tokens: 64000,
          system: [{ type: "text", text: SYSTEM_PROMPT }],
          tools: TOOLS,
          messages: get().history,
          thinking: { type: "adaptive", display: "summarized" },
          output_config: { effort },
          cache_control: { type: "ephemeral" },
          ...(withFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {}),
        }
        const stream = client.beta.messages.stream(params as unknown as Anthropic.Beta.MessageCreateParamsStreaming, { signal: abort.signal })
        const uiIndex = new Map<number, number>() // content block index -> ui block index
        const partial = new Map<number, { name: string; json: string }>()
        let lastPreview = 0

        for await (const ev of stream) {
          if (ev.type === "content_block_start") {
            const b = ev.content_block
            if (b.type === "text" || b.type === "thinking" || b.type === "tool_use") {
              update((blocks) => {
                uiIndex.set(ev.index, blocks.length)
                if (b.type === "tool_use") {
                  partial.set(ev.index, { name: b.name, json: "" })
                  return [...blocks, { kind: "tool", id: b.id, name: b.name, status: "running", label: LABELS[b.name]?.[0] ?? b.name }]
                }
                return [...blocks, { kind: b.type, text: "" }]
              })
            }
          } else if (ev.type === "content_block_delta") {
            const i = uiIndex.get(ev.index)
            const d = ev.delta
            if (i == null) continue
            if (d.type === "text_delta" || d.type === "thinking_delta") {
              const add = d.type === "text_delta" ? d.text : d.thinking
              update((blocks) => blocks.map((b, j) => (j === i && (b.kind === "text" || b.kind === "thinking") ? { ...b, text: b.text + add } : b)))
            } else if (d.type === "input_json_delta") {
              const p = partial.get(ev.index)!
              p.json += d.partial_json
              if (p.name === "write_deck" && Date.now() - lastPreview > 200) {
                lastPreview = Date.now()
                livePreview(p.json)
              }
            }
          }
        }
        const msg = await stream.finalMessage()
        useStore.setState({ aiPreview: null })
        set({ history: [...get().history, { role: "assistant", content: msg.content as Anthropic.Beta.BetaContentBlockParam[] }] })

        if (msg.stop_reason === "refusal") { update((b) => [...b, { kind: "error", text: "Claude declined this request." }]); break }
        if (msg.stop_reason === "pause_turn") continue
        const uses = msg.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use")
        if (!uses.length) break
        if (msg.stop_reason === "max_tokens") { update((b) => [...b, { kind: "error", text: "The response was cut off (max tokens). Try a smaller request." }]); break }

        const results: Anthropic.Beta.BetaToolResultBlockParam[] = []
        for (const use of uses) {
          let result: Anthropic.Beta.BetaToolResultBlockParam
          let detail: string | undefined
          try {
            const out = await runTool(use.name, use.input as Record<string, unknown>, (block) => update((b) => [...b, block]))
            result = { type: "tool_result", tool_use_id: use.id, content: out.content, is_error: out.isError }
            detail = out.detail
          } catch (e) {
            const message = e instanceof PatchError || e instanceof ToolInputError ? e.message : `Tool failed: ${(e as Error).message}`
            result = { type: "tool_result", tool_use_id: use.id, content: message, is_error: true }
            detail = message
          }
          results.push(result)
          update((blocks) => blocks.map((b) => (b.kind === "tool" && b.id === use.id ? { ...b, status: result.is_error ? "error" : "done", label: result.is_error ? `${LABELS[use.name]?.[0] ?? use.name} — needs a fix` : (LABELS[use.name]?.[1] ?? use.name), detail } : b)))
        }
        set({ history: [...get().history, { role: "user", content: results }] })
      }
    } catch (e) {
      useStore.setState({ aiPreview: null })
      if (abort.signal.aborted) {
        update((b) => [...b, { kind: "error", text: "Stopped." }])
        // Keep the API history valid: drop a trailing user turn that has no answer.
        const h = get().history
        if (h[h.length - 1]?.role === "user") set({ history: h.slice(0, -1) })
      } else {
        update((b) => [...b, { kind: "error", text: describeError(e) }])
        const h = get().history
        if (h[h.length - 1]?.role === "user") set({ history: h.slice(0, -1) })
      }
    } finally {
      set({ running: false, abort: undefined })
    }
  },
}))

class ToolInputError extends Error {}

function describeError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return "The API key was rejected. Check it in Settings."
  if (e instanceof Anthropic.RateLimitError) return "Rate limited — wait a moment and try again."
  if (e instanceof Anthropic.APIError) return `API error ${e.status ?? ""}: ${e.message}`
  return (e as Error).message ?? String(e)
}

function sourceEnd(source: string, start: number) {
  return elementRange(source, start)?.end ?? start + 200
}

// --- live preview while write_deck streams ------------------------------------------

/** Decode the (possibly unterminated) JSON string value of "source" from partial tool JSON. */
export function partialSource(json: string): string | undefined {
  const m = /"source"\s*:\s*"/.exec(json)
  if (!m) return
  let out = ""
  for (let i = m.index + m[0].length; i < json.length; i++) {
    const c = json[i]
    if (c === '"') break
    if (c !== "\\") { out += c; continue }
    const n = json[i + 1]
    if (n == null) break
    if (n === "u") {
      const hex = json.slice(i + 2, i + 6)
      if (hex.length < 4) break
      out += String.fromCharCode(parseInt(hex, 16))
      i += 5
    } else {
      out += ({ n: "\n", t: "\t", r: "\r", b: "\b", f: "\f" } as Record<string, string>)[n] ?? n
      i++
    }
  }
  return out
}

function livePreview(json: string) {
  const src = partialSource(json)
  if (src == null) return
  const prev = useStore.getState().aiPreview
  let deck = prev?.deck
  const cut = src.lastIndexOf("</Slide>")
  if (cut !== -1) {
    const head = src.slice(0, cut + 8)
    for (const tail of ["\n</Deck>\n)", "\n</Deck>"]) {
      const r = compile(head + tail)
      if (r.deck) { deck = r.deck; break }
    }
  }
  useStore.setState({ aiPreview: { source: src, deck }, ...(deck && deck.slides.length !== prev?.deck?.slides.length ? { current: deck.slides.length - 1, selected: null } : {}) })
}

// --- tools ----------------------------------------------------------------------------------

async function report(intro: string): Promise<{ content: string; isError: boolean; detail?: string }> {
  await settled(250)
  const s = useStore.getState()
  if (s.errors.length) {
    const errs = s.errors.map((e) => `- ${e.line ? `line ${e.line}: ` : ""}${e.message}`).join("\n")
    return { content: `The source was saved but does not compile, so the canvas still shows the previous version:\n${errs}\nFix it with edit_deck.`, isError: true, detail: s.errors[0].message }
  }
  const deck = s.deck!
  const issues: Diagnostic[] = [...s.warnings, ...lintDeck(deck).filter((d) => d.severity === "warning")]
  for (const sl of deck.slides) { const root = farmSlide(sl.index); if (root) issues.push(...inspectSlideElement(root, sl.index).filter((d) => d.severity === "warning")) }
  const text = `${intro}\n\n${outline(deck)}\n\n${issues.length ? `Problems to fix:\n${issues.map((i) => `- ${i.message}`).join("\n")}` : "No layout problems detected."}`
  return { content: text, isError: false, detail: issues.length ? `${issues.length} issue${issues.length > 1 ? "s" : ""} found` : undefined }
}

async function runTool(name: string, input: Record<string, unknown>, addBlock: (b: Block) => void): Promise<{ content: string | Anthropic.Beta.BetaToolResultBlockParam["content"]; isError: boolean; detail?: string }> {
  const store = useStore.getState()
  switch (name) {
    case "write_deck": {
      if (typeof input.source !== "string" || !input.source.includes("<Deck")) throw new ToolInputError("write_deck needs `source`: a complete TSX module with a <Deck>.")
      store.setSource(input.source, "ai")
      return report("Deck written.")
    }
    case "edit_deck": {
      const edits = input.edits
      if (!Array.isArray(edits) || !edits.every((e) => typeof e?.old === "string" && typeof e?.new === "string")) throw new ToolInputError("edit_deck needs `edits`: [{ old, new }] strings.")
      store.setSource(applyEdits(store.source, edits), "ai")
      const r = await report(`Applied ${edits.length} edit${edits.length > 1 ? "s" : ""}.`)
      return { ...r, detail: r.detail ?? `${edits.length} change${edits.length > 1 ? "s" : ""}` }
    }
    case "propose_variants": {
      const slide = Number(input.slide)
      const variants = input.variants as { title: string; description?: string; code: string }[]
      if (!Number.isInteger(slide) || !Array.isArray(variants) || !variants.every((v) => typeof v?.code === "string")) throw new ToolInputError("propose_variants needs `slide` (1-based) and `variants`: [{ title, code }].")
      if (!store.deck?.slides[slide - 1]) throw new ToolInputError(`There is no slide ${slide}.`)
      addBlock({ kind: "variants", slide: slide - 1, variants })
      return { content: `Showing ${variants.length} rendered alternatives for slide ${slide}. The user will pick one; do not apply any yourself.`, isError: false }
    }
    case "inspect_deck": {
      const deck = store.deck
      if (!deck) throw new ToolInputError("The deck does not compile.")
      const wanted = Array.isArray(input.slides) && input.slides.length ? (input.slides as number[]).map((n) => n - 1) : deck.slides.map((s) => s.index)
      const issues: string[] = []
      for (const i of wanted) { const root = farmSlide(i); if (root) issues.push(...inspectSlideElement(root, i).map((d) => d.message)) }
      issues.push(...lintDeck(deck).filter((d) => d.slide != null && wanted.includes(d.slide)).map((d) => d.message))
      const content: Anthropic.Beta.BetaToolResultBlockParam["content"] = [{ type: "text", text: issues.length ? issues.join("\n") : "No problems detected." }]
      if (input.screenshots) {
        for (const i of wanted.slice(0, 4)) {
          const root = farmSlide(i)
          if (!root) continue
          try {
            const url = await toJpeg(root, { pixelRatio: 0.5, quality: 0.8, skipFonts: true, cacheBust: false })
            content.push({ type: "text", text: `Slide ${i + 1}:` }, { type: "image", source: { type: "base64", media_type: "image/jpeg", data: url.split(",")[1] } })
          } catch (e) {
            content.push({ type: "text", text: `Slide ${i + 1}: screenshot failed (${(e as Error).message})` })
          }
        }
      }
      return { content, isError: false, detail: `${issues.length} note${issues.length === 1 ? "" : "s"}` }
    }
  }
  throw new ToolInputError(`Unknown tool ${name}`)
}
