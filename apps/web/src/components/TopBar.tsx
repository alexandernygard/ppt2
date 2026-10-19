import { useRef } from "react"
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
  ToggleGroup,
  ToggleGroupItem,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
} from "@alexandernygard/components"
import { CodeIcon, Columns2Icon, DownloadIcon, PlayIcon, PresentationIcon, Redo2Icon, SettingsIcon, Undo2Icon, ImageIcon, FileUpIcon, FilePlusIcon } from "lucide-react"
import { STARTER_DECK, themes } from "@ppt2/sdk"
import { exportPptx } from "@ppt2/react"
import { useStore, type View } from "../store"
import { farmSlide, settled } from "./RenderFarm"

export function TopBar({ onSettings }: { onSettings: () => void }) {
  const deck = useStore((s) => s.deck)
  const view = useStore((s) => s.view)
  const canUndo = useStore((s) => s.past.length > 0)
  const canRedo = useStore((s) => s.future.length > 0)
  const st = useStore.getState
  const fileInput = useRef<HTMLInputElement>(null)
  const themeName = typeof deck?.themeInput === "string" ? deck.themeInput : "custom"

  const download = (name: string, text: string, type = "text/plain") => {
    const a = document.createElement("a")
    a.href = URL.createObjectURL(new Blob([text], { type }))
    a.download = name
    a.click()
    URL.revokeObjectURL(a.href)
  }
  const slug = (deck?.title ?? "deck").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "deck"

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-background px-3">
      <div className="flex items-center gap-2 pr-2">
        <div className="grid size-7 place-items-center rounded-md bg-primary font-heading text-sm font-bold text-primary-foreground">p2</div>
        <span className="max-w-56 truncate text-sm font-medium">{deck?.title ?? "Untitled"}</span>
      </div>
      <Tooltip>
        <TooltipTrigger asChild><Button size="icon-sm" variant="ghost" disabled={!canUndo} onClick={() => st().undo()}><Undo2Icon /></Button></TooltipTrigger>
        <TooltipContent>Undo (⌘Z)</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild><Button size="icon-sm" variant="ghost" disabled={!canRedo} onClick={() => st().redo()}><Redo2Icon /></Button></TooltipTrigger>
        <TooltipContent>Redo (⇧⌘Z)</TooltipContent>
      </Tooltip>

      <div className="mx-auto">
        <ToggleGroup type="single" variant="outline" size="sm" value={view} onValueChange={(v) => v && st().setView(v as View)}>
          <ToggleGroupItem value="canvas" aria-label="Canvas only"><ImageIcon /> Canvas</ToggleGroupItem>
          <ToggleGroupItem value="split" aria-label="Side by side"><Columns2Icon /> Split</ToggleGroupItem>
          <ToggleGroupItem value="code" aria-label="Code only"><CodeIcon /> Code</ToggleGroupItem>
        </ToggleGroup>
      </div>

      <Select value={themeName} onValueChange={(t) => st().setTheme(t)} disabled={!deck}>
        <SelectTrigger size="sm" className="w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.values(themes).map((t) => (
            <SelectItem key={t.name} value={t.name}>
              <span className="flex items-center gap-2">
                <span className="flex overflow-hidden rounded-sm ring-1 ring-border">
                  {[t.colors.background, t.colors.text, t.colors.accent].map((c, i) => <span key={i} className="size-3" style={{ background: c }} />)}
                </span>
                {t.label}
              </span>
            </SelectItem>
          ))}
          {themeName === "custom" && <SelectItem value="custom" disabled>Custom (in code)</SelectItem>}
        </SelectContent>
      </Select>

      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button size="sm" variant="ghost"><DownloadIcon /> File</Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Export</DropdownMenuLabel>
          <DropdownMenuItem disabled={!deck} onSelect={async () => { await settled(); window.print() }}>PDF (print dialog)</DropdownMenuItem>
          <DropdownMenuItem disabled={!deck} onSelect={async () => {
            const id = toast.loading("Building PowerPoint…")
            try { await settled(400); await exportPptx(deck!, farmSlide, `${slug}.pptx`); toast.success("Exported PowerPoint", { id }) }
            catch (e) { console.error(e); toast.error(`Export failed: ${(e as Error).message}`, { id }) }
          }}>PowerPoint (.pptx)</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => download(`${slug}.deck.tsx`, st().source)}>Source (.deck.tsx)</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => fileInput.current?.click()}><FileUpIcon /> Open .deck.tsx…</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => st().setSource(STARTER_DECK, "load")}><FilePlusIcon /> Reset to example deck</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <input ref={fileInput} type="file" accept=".tsx,.jsx,.ts,.txt" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) st().setSource(await f.text(), "load"); e.target.value = "" }} />

      <Tooltip>
        <TooltipTrigger asChild><Button size="icon-sm" variant="ghost" onClick={onSettings} aria-label="AI settings"><SettingsIcon /></Button></TooltipTrigger>
        <TooltipContent>AI settings</TooltipContent>
      </Tooltip>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button size="sm" disabled={!deck?.slides.length}><PlayIcon /> Present</Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => st().present()}><PlayIcon /> From current slide</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => st().present({ fromStart: true })}><PlayIcon /> From the beginning</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => st().present({ speaker: true })}><PresentationIcon /> Speaker view</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  )
}
