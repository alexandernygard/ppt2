import { useRef, useState } from "react"
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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
import { CheckIcon, ChevronDownIcon, CloudAlertIcon, CodeIcon, Columns2Icon, FileIcon, FolderIcon, HardDriveIcon, HistoryIcon, LibraryIcon, LinkIcon, LoaderIcon, PlayIcon, PresentationIcon, Redo2Icon, SettingsIcon, StampIcon, Undo2Icon, ImageIcon, FileUpIcon, FilePlusIcon, FolderOpenIcon, SaveIcon, Unlink2Icon } from "lucide-react"
import { STARTER_DECK, themes } from "@ppt2/sdk"
import { exportPptx } from "@ppt2/react"
import { useStore, type View } from "../store"
import { farmSlide, settled } from "./RenderFarm"
import { createDeck, diskSupported, importText, openFile, openFolder, reconnect, saveToFile, saveToFolder, unlink, useLibrary } from "../library"
import { DeckLibrary } from "./DeckLibrary"
import { HistoryDialog } from "./HistoryDialog"
import { BrandPanel } from "./BrandPanel"

function SaveStatus() {
  const status = useLibrary((s) => s.status)
  const link = useLibrary((s) => s.link)
  const where = link ? `${link.name}${link.kind === "folder" ? "/" : ""}` : "this browser"
  if (link && link.permission !== "granted") {
    return (
      <Tooltip>
        <TooltipTrigger asChild><Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void reconnect()}><LinkIcon /> Reconnect {link.name}</Button></TooltipTrigger>
        <TooltipContent>The browser needs your permission again to save to {where} after a reload.</TooltipContent>
      </Tooltip>
    )
  }
  const Icon = status === "saving" ? LoaderIcon : status === "error" ? CloudAlertIcon : link ? (link.kind === "folder" ? FolderIcon : FileIcon) : CheckIcon
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex items-center gap-1 text-xs whitespace-nowrap text-muted-foreground" role="status">
          <Icon className={status === "saving" ? "size-3.5 animate-spin" : status === "error" ? "size-3.5 text-destructive" : "size-3.5"} />
          {status === "saving" ? "Saving…" : status === "error" ? "Not saved" : link ? link.name : "Saved"}
        </span>
      </TooltipTrigger>
      <TooltipContent>{status === "error" ? "Saving failed. Check the browser's storage." : link ? `Saved to ${where}, and edits made there show up here.` : "Saved in this browser."}</TooltipContent>
    </Tooltip>
  )
}

export function TopBar({ onSettings }: { onSettings: () => void }) {
  const deck = useStore((s) => s.deck)
  const view = useStore((s) => s.view)
  const canUndo = useStore((s) => s.past.length > 0)
  const canRedo = useStore((s) => s.future.length > 0)
  const st = useStore.getState
  const fileInput = useRef<HTMLInputElement>(null)
  const [library, setLibrary] = useState(false)
  const [history, setHistory] = useState(false)
  const [brand, setBrand] = useState(false)
  const link = useLibrary((s) => s.link)
  const themeName = typeof deck?.themeInput === "string" ? deck.themeInput : deck?.themeInput.base ?? "snow"

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
      <div className="flex min-w-0 items-center gap-2 pr-1">
        <div className="grid size-7 shrink-0 place-items-center rounded-md bg-primary font-heading text-sm font-bold text-primary-foreground">p2</div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="sm" variant="ghost" className="max-w-56 min-w-0 px-2" onClick={() => setLibrary(true)}>
              <span className="truncate font-medium">{deck?.title ?? "Untitled"}</span><ChevronDownIcon className="opacity-60" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>All decks</TooltipContent>
        </Tooltip>
        <SaveStatus />
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
        </SelectContent>
      </Select>

      <Tooltip>
        <TooltipTrigger asChild><Button size="sm" variant={brand ? "secondary" : "ghost"} disabled={!deck} onClick={() => setBrand((b) => !b)}><StampIcon /> Brand</Button></TooltipTrigger>
        <TooltipContent>Logo, footer, slide numbers and fonts</TooltipContent>
      </Tooltip>
      <BrandPanel open={brand} onOpenChange={setBrand} />

      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button size="sm" variant="ghost"><FileIcon /> File</Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuItem onSelect={() => void createDeck()}><FilePlusIcon /> New deck</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void createDeck(STARTER_DECK)}><FilePlusIcon /> New from example</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setLibrary(true)}><LibraryIcon /> All decks…</DropdownMenuItem>
          <DropdownMenuSeparator />
          {diskSupported ? (
            <>
              <DropdownMenuItem onSelect={() => void openFile()}><FileUpIcon /> Open file…</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void openFolder()}><FolderOpenIcon /> Open folder…</DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger><HardDriveIcon /> Save to disk</DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-64">
                  <DropdownMenuItem onSelect={() => void saveToFolder()}><FolderIcon /> As folder (deck + images)…</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void saveToFile()}><FileIcon /> As single .deck.tsx file…</DropdownMenuItem>
                  {link && <DropdownMenuItem onSelect={() => void unlink()}><Unlink2Icon /> Stop syncing with {link.name}</DropdownMenuItem>}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </>
          ) : (
            <DropdownMenuItem onSelect={() => fileInput.current?.click()}><FileUpIcon /> Import .deck.tsx…</DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => setHistory(true)}><HistoryIcon /> Version history…</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Export</DropdownMenuLabel>
          <DropdownMenuItem disabled={!deck} onSelect={async () => { await settled(); window.print() }}>PDF (print dialog)</DropdownMenuItem>
          <DropdownMenuItem disabled={!deck} onSelect={async () => {
            const id = toast.loading("Building PowerPoint…")
            try { await settled(400); await exportPptx(deck!, farmSlide, `${slug}.pptx`); toast.success("Exported PowerPoint", { id }) }
            catch (e) { console.error(e); toast.error(`Export failed: ${(e as Error).message}`, { id }) }
          }}>PowerPoint (.pptx)</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => download(`${slug}.deck.tsx`, st().source)}><SaveIcon /> Download source</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <input ref={fileInput} type="file" accept=".tsx,.jsx,.ts,.txt" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) await importText(await f.text()); e.target.value = "" }} />
      <DeckLibrary open={library} onOpenChange={setLibrary} onImport={() => fileInput.current?.click()} />
      <HistoryDialog open={history} onOpenChange={setHistory} />

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
