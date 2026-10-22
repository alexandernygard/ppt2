import { useRef, useState } from "react"
import {
  ResizableSidebarTrigger,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
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
import { CheckIcon, ChevronDownIcon, EllipsisIcon, PaletteIcon, CloudAlertIcon, CodeIcon, Columns2Icon, FileIcon, FolderIcon, HardDriveIcon, HistoryIcon, LibraryIcon, LinkIcon, LoaderIcon, UsersIcon, PlayIcon, PresentationIcon, Redo2Icon, SettingsIcon, StampIcon, Undo2Icon, ImageIcon, FileUpIcon, FilePlusIcon, FolderOpenIcon, SaveIcon, Unlink2Icon } from "lucide-react"
import { STARTER_DECK, themes } from "@ppt2/sdk"
import { exportPptx } from "@ppt2/react"
import { useStore, type View } from "../store"
import { farmSlide, settled } from "./RenderFarm"
import { createDeck, diskSupported, importText, openFile, openFolder, reconnect, saveToFile, saveToFolder, unlink, useLibrary } from "../library"
import { DeckLibrary } from "./DeckLibrary"
import { HistoryDialog } from "./HistoryDialog"
import { BrandPanel } from "./BrandPanel"
import { ShareControls } from "./ShareDialog"
import { useCollab } from "../collab"

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
  // While a deck is shared, undo is per person and lives in the collaboration session.
  const shared = useCollab((s) => s.roomId != null)
  const liveUndo = useCollab((s) => s.canUndo)
  const liveRedo = useCollab((s) => s.canRedo)
  const localUndo = useStore((s) => s.past.length > 0)
  const localRedo = useStore((s) => s.future.length > 0)
  const canUndo = shared ? liveUndo : localUndo
  const canRedo = shared ? liveRedo : localRedo
  const record = useLibrary((s) => s.decks.find((d) => d.id === s.currentId))
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
    // Narrower than lg the secondary controls move into the File menu, which turns into "⋯" on a phone, so the bar never outgrows the screen.
    <header className="flex h-12 min-w-0 shrink-0 items-center gap-1 border-b bg-background px-2 sm:gap-2 sm:px-3">
      <div className="flex min-w-0 items-center gap-2 pr-1">
        <div className="hidden size-7 shrink-0 place-items-center rounded-md bg-primary sm:grid font-heading text-sm font-bold text-primary-foreground">p2</div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="sm" variant="ghost" className="max-w-32 min-w-0 shrink px-2 sm:max-w-56" onClick={() => setLibrary(true)}>
              <span className="truncate font-medium">{(record?.drive ? record.title : deck?.title) ?? "Untitled"}</span><ChevronDownIcon className="opacity-60" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>All decks</TooltipContent>
        </Tooltip>
        <div className="hidden lg:block"><SaveStatus /></div>
      </div>
      <Tooltip>
        <TooltipTrigger asChild><Button size="icon-sm" variant="ghost" disabled={!canUndo} onClick={() => st().undo()}><Undo2Icon /></Button></TooltipTrigger>
        <TooltipContent>Undo (⌘Z)</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild><Button size="icon-sm" variant="ghost" className="hidden sm:inline-flex" disabled={!canRedo} onClick={() => st().redo()}><Redo2Icon /></Button></TooltipTrigger>
        <TooltipContent>Redo (⇧⌘Z)</TooltipContent>
      </Tooltip>

      <div className="flex-1 md:hidden" />
      <div className="mx-auto hidden md:block">
        <ToggleGroup type="single" variant="outline" size="sm" value={view} onValueChange={(v) => v && st().setView(v as View)}>
          <ToggleGroupItem value="canvas" aria-label="Canvas only"><ImageIcon /> <span className="hidden xl:inline">Canvas</span></ToggleGroupItem>
          <ToggleGroupItem value="split" aria-label="Side by side" className="hidden md:inline-flex"><Columns2Icon /> <span className="hidden xl:inline">Split</span></ToggleGroupItem>
          <ToggleGroupItem value="code" aria-label="Code only"><CodeIcon /> <span className="hidden xl:inline">Code</span></ToggleGroupItem>
        </ToggleGroup>
      </div>

      <Select value={themeName} onValueChange={(t) => st().setTheme(t)} disabled={!deck}>
        <SelectTrigger size="sm" className="hidden w-36 lg:flex">
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
        <TooltipTrigger asChild><Button size="sm" variant={brand ? "secondary" : "ghost"} className="hidden lg:inline-flex" disabled={!deck} onClick={() => setBrand((b) => !b)}><StampIcon /> <span className="hidden xl:inline">Brand</span></Button></TooltipTrigger>
        <TooltipContent>Logo, footer, slide numbers and fonts</TooltipContent>
      </Tooltip>
      <BrandPanel open={brand} onOpenChange={setBrand} />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" aria-label="File and more">
            <FileIcon className="hidden md:block" /><EllipsisIcon className="md:hidden" /><span className="hidden md:inline">File</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuGroup className="md:hidden">
            <DropdownMenuRadioGroup value={view === "code" ? "code" : "canvas"} onValueChange={(v) => st().setView(v as View)}>
              <DropdownMenuRadioItem value="canvas"><ImageIcon /> Slides</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="code"><CodeIcon /> Code</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
          </DropdownMenuGroup>
          <DropdownMenuGroup className="lg:hidden">
            <DropdownMenuSub>
              <DropdownMenuSubTrigger disabled={!deck}><PaletteIcon /> Theme</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup value={themeName} onValueChange={(t) => st().setTheme(t)}>
                  {Object.values(themes).map((t) => <DropdownMenuRadioItem key={t.name} value={t.name}>{t.label}</DropdownMenuRadioItem>)}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem disabled={!deck} onSelect={() => setBrand(true)}><StampIcon /> Brand…</DropdownMenuItem>
            <DropdownMenuItem onSelect={onSettings}><SettingsIcon /> AI settings…</DropdownMenuItem>
            <DropdownMenuSeparator />
          </DropdownMenuGroup>
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

      <ShareControls />

      <Tooltip>
        <TooltipTrigger asChild><Button size="icon-sm" variant="ghost" className="hidden lg:inline-flex" onClick={onSettings} aria-label="AI settings"><SettingsIcon /></Button></TooltipTrigger>
        <TooltipContent>AI settings</TooltipContent>
      </Tooltip>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button size="sm" disabled={!deck?.slides.length} aria-label="Present"><PlayIcon /> <span className="hidden sm:inline">Present</span></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => st().present()}><PlayIcon /> From current slide</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => st().present({ fromStart: true })}><PlayIcon /> From the beginning</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => st().present({ speaker: true })}><PresentationIcon /> Speaker view</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild><ResizableSidebarTrigger sidebar="assistant" side="end" /></TooltipTrigger>
        <TooltipContent>Show or hide the sidebar (⌥⌘B)</TooltipContent>
      </Tooltip>
    </header>
  )
}
