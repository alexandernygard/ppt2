import { useMemo, useRef, useState } from "react"
import {
  Alert,
  AlertDescription,
  Bubble,
  BubbleContent,
  Button,
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
  Marker,
  MarkerContent,
  MarkerIcon,
  Message,
  MessageContent,
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  Spinner,
  Trace,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
  toast,
  cn,
} from "@alexandernygard/components"
import { ArrowUpIcon, CheckIcon, PaperclipIcon, SparklesIcon, SquareIcon, XIcon, AlertTriangleIcon, BrainIcon, RotateCcwIcon } from "lucide-react"
import { compile, replaceSlide } from "@ppt2/sdk"
import { FixedStage, SlideView } from "@ppt2/react"
import { useChat, type Block, type ChatMessage } from "../ai/agent"
import { useStore } from "../store"
import { useSettings } from "../ai/settings"

const DECK_STARTERS = [
  "Write a 7-slide pitch deck for a bike-sharing startup in Oslo",
  "Turn this outline into a deck:\n- Why we're changing onboarding\n- What we tried\n- Results\n- Next quarter",
  "A 5-minute lightning talk on why decks should be code",
]

function slideActions(slide: number) {
  return [
    { label: "Tighten", prompt: `Tighten slide ${slide}: fewer words, a sharper takeaway title, same meaning.` },
    { label: "Suggest layouts", prompt: `Suggest 3 different layouts for slide ${slide}.` },
    { label: "Make it visual", prompt: `Make slide ${slide} more visual: replace text with a stat, chart, image or diagram where it helps.` },
    { label: "Speaker notes", prompt: "Write or improve speaker notes for every slide that needs them." },
    { label: "Restyle deck", prompt: "Restyle the whole deck: pick a theme that fits the content and vary the layouts so it has rhythm. Check the result visually." },
    { label: "Review", prompt: "Review the deck like a presentation coach: inspect it visually, then fix overflow, density, weak titles and layout problems." },
  ]
}

export function ChatPanel({ onNeedKey }: { onNeedKey: () => void }) {
  const messages = useChat((s) => s.messages)
  const running = useChat((s) => s.running)
  const current = useStore((s) => s.current)
  const hasKey = useSettings((s) => !!s.apiKey)
  const [draft, setDraft] = useState("")
  const [attachments, setAttachments] = useState<{ name: string; text: string }[]>([])
  const file = useRef<HTMLInputElement>(null)

  async function send(text: string) {
    if (!text.trim() || running) return
    if (!hasKey) { onNeedKey(); return }
    const att = attachments
    setDraft("")
    setAttachments([])
    try { await useChat.getState().send(text, att) }
    catch (e) { if ((e as Error).message === "NO_KEY") onNeedKey(); else toast.error((e as Error).message) }
  }

  async function attach(files: FileList | null) {
    for (const f of Array.from(files ?? [])) {
      if (f.size > 400_000) { toast.warning(`${f.name} is too large (max 400 KB of text)`); continue }
      const text = await f.text()
      setAttachments((a) => [...a, { name: f.name, text }])
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <SparklesIcon className="size-4 text-highlight" />
        <span className="text-sm font-medium">Co-author</span>
        <span className="text-xs text-muted-foreground">sees slide {current + 1}</span>
        {messages.length > 0 && (
          <Button size="icon-sm" variant="ghost" className="ml-auto" onClick={() => useChat.getState().reset()} aria-label="New conversation" disabled={running}>
            <RotateCcwIcon />
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col justify-end gap-4 p-4">
            <div>
              <p className="font-heading text-lg">What are we presenting?</p>
              <p className="text-sm text-muted-foreground">Describe a talk, paste an outline or data, or pick a slide and ask for changes. Edits land in the code and on the canvas.</p>
            </div>
            <div className="flex flex-col gap-2">
              {DECK_STARTERS.map((s) => (
                <button key={s} onClick={() => send(s)} className="rounded-lg border px-3 py-2 text-left text-sm whitespace-pre-line hover:bg-muted">{s}</button>
              ))}
            </div>
          </div>
        ) : (
          <MessageScrollerProvider>
            <MessageScroller>
              <MessageScrollerViewport>
                <MessageScrollerContent className="gap-4 p-3">
                  {messages.map((m) => (
                    <MessageScrollerItem key={m.id} messageId={m.id} scrollAnchor={m.role === "user"}>
                      <ChatMessageView message={m} />
                    </MessageScrollerItem>
                  ))}
                  {running && (
                    <MessageScrollerItem scrollAnchor={false}>
                      <Marker role="status">
                        <MarkerIcon><Spinner /></MarkerIcon>
                        <MarkerContent className="shimmer">Working</MarkerContent>
                      </Marker>
                    </MessageScrollerItem>
                  )}
                </MessageScrollerContent>
              </MessageScrollerViewport>
              <MessageScrollerButton />
            </MessageScroller>
          </MessageScrollerProvider>
        )}
      </div>
      <div className="shrink-0 border-t p-3">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {slideActions(current + 1).map((a) => (
            <button key={a.label} disabled={running} onClick={() => send(a.prompt)} className="rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50">
              {a.label}
            </button>
          ))}
        </div>
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {attachments.map((a, i) => (
              <span key={i} className="flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs">
                {a.name}
                <button onClick={() => setAttachments((x) => x.filter((_, j) => j !== i))} aria-label={`Remove ${a.name}`}><XIcon className="size-3" /></button>
              </span>
            ))}
          </div>
        )}
        <form onSubmit={(e) => { e.preventDefault(); send(draft) }}>
          <InputGroup>
            <InputGroupTextarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(draft) } }}
              onPaste={(e) => {
                // Pasted tables (CSV/TSV) become an attachment so the prompt stays readable.
                const t = e.clipboardData.getData("text")
                if (t.split("\n").length > 4 && /[,\t]/.test(t.split("\n")[0])) { e.preventDefault(); setAttachments((a) => [...a, { name: `pasted-data-${a.length + 1}.csv`, text: t.replace(/\t/g, ",") }]) }
              }}
              placeholder={hasKey ? "Ask for a deck, a change, or paste data for a chart…" : "Add your Anthropic API key to start"}
              className="max-h-48 min-h-12"
            />
            <InputGroupAddon align="block-end">
              <input ref={file} type="file" accept=".csv,.tsv,.txt,.md,.json" multiple hidden onChange={(e) => { attach(e.target.files); e.target.value = "" }} />
              <InputGroupButton size="icon-xs" variant="ghost" aria-label="Attach data or an outline" onClick={() => file.current?.click()}><PaperclipIcon /></InputGroupButton>
              {running ? (
                <InputGroupButton size="icon-xs" variant="default" className="ml-auto rounded-full" aria-label="Stop" onClick={() => useChat.getState().stop()}><SquareIcon /></InputGroupButton>
              ) : (
                <InputGroupButton type="submit" size="icon-xs" variant="default" className="ml-auto rounded-full" aria-label="Send" disabled={!draft.trim()}><ArrowUpIcon /></InputGroupButton>
              )}
            </InputGroupAddon>
          </InputGroup>
        </form>
      </div>
    </div>
  )
}

function ChatMessageView({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <Message align="end">
        <MessageContent>
          <Bubble><BubbleContent className="whitespace-pre-wrap">{message.text}</BubbleContent></Bubble>
          {message.attachments?.length ? <div className="text-right text-xs text-muted-foreground">+ {message.attachments.join(", ")}</div> : null}
        </MessageContent>
      </Message>
    )
  }
  return (
    <Message align="start">
      <MessageContent className="w-full">
        {message.blocks.map((b, i) => <BlockView key={i} block={b} msgId={message.id} index={i} />)}
      </MessageContent>
    </Message>
  )
}

function BlockView({ block, msgId, index }: { block: Block; msgId: string; index: number }) {
  const [open, setOpen] = useState(false)
  switch (block.kind) {
    case "text":
      return block.text.trim() ? <Bubble variant="ghost"><BubbleContent className="whitespace-pre-wrap">{block.text.trim()}</BubbleContent></Bubble> : null
    case "thinking":
      return (
        <Trace>
          <TraceLine onClick={() => setOpen(!open)} className="cursor-pointer">
            <TraceIcon><BrainIcon /></TraceIcon>
            <TraceTitle>Thinking</TraceTitle>
            {block.text && <TraceDescription>{open ? "hide" : "show"}</TraceDescription>}
          </TraceLine>
          {open && block.text && <p className="pl-6 text-xs whitespace-pre-wrap text-muted-foreground">{block.text}</p>}
        </Trace>
      )
    case "tool":
      return (
        <Trace>
          <TraceLine>
            <TraceIcon>{block.status === "running" ? <Spinner /> : block.status === "error" ? <AlertTriangleIcon className="text-warning" /> : <CheckIcon className="text-positive" />}</TraceIcon>
            <TraceTitle className={cn(block.status === "running" && "shimmer")}>{block.label}</TraceTitle>
            {block.detail && <TraceDescription className="truncate">{block.detail}</TraceDescription>}
          </TraceLine>
        </Trace>
      )
    case "variants":
      return <Variants block={block} msgId={msgId} index={index} />
    case "error":
      return <Alert variant="destructive"><AlertDescription>{block.text}</AlertDescription></Alert>
  }
}

function Variants({ block, msgId, index }: { block: Extract<Block, { kind: "variants" }>; msgId: string; index: number }) {
  const source = useStore((s) => s.source)
  const deck = useStore((s) => s.deck)
  const previews = useMemo(() => block.variants.map((v) => {
    try {
      if (!deck?.src) return { error: "Deck does not compile" }
      const next = replaceSlide(source, deck.src, block.slide, v.code).source
      const r = compile(next)
      return r.deck ? { source: next, deck: r.deck } : { error: r.errors[0]?.message ?? "Does not compile" }
    } catch (e) { return { error: (e as Error).message } }
  }), [block, block.applied == null ? source : null])

  return (
    <div className="grid w-full gap-2">
      <div className="text-xs text-muted-foreground">Alternatives for slide {block.slide + 1}</div>
      {block.variants.map((v, i) => {
        const p = previews[i]
        const applied = block.applied === i
        return (
          <div key={i} className={cn("overflow-hidden rounded-lg border bg-card", applied && "ring-2 ring-highlight")}>
            {"deck" in p && p.deck ? (
              <div className="pointer-events-none border-b"><FixedStage width={p.deck.width} height={p.deck.height}><SlideView deck={p.deck} slide={p.deck.slides[block.slide]} /></FixedStage></div>
            ) : (
              <div className="border-b p-3 text-xs text-destructive">{"error" in p ? p.error : ""}</div>
            )}
            <div className="flex items-center gap-2 p-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{v.title}</div>
                {v.description && <div className="line-clamp-2 text-xs text-muted-foreground">{v.description}</div>}
              </div>
              <Button size="sm" variant={applied ? "secondary" : "outline"} disabled={!("deck" in p) || applied || block.applied != null} onClick={() => {
                if ("source" in p && p.source) {
                  useStore.getState().setSource(p.source, "ai")
                  useStore.getState().go(block.slide)
                  useChat.getState().markApplied(msgId, index, i)
                }
              }}>{applied ? "Applied" : "Use this"}</Button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
