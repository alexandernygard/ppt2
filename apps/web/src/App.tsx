import { useEffect, useState } from "react"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup, ResizableSidebar, ResizableSidebarProvider } from "@alexandernygard/components"
import { AlertCircleIcon } from "lucide-react"
import { useStore } from "./store"
import { TopBar } from "./components/TopBar"
import { Thumbnails } from "./components/Thumbnails"
import { Canvas } from "./components/Canvas"
import { CodeEditor } from "./components/CodeEditor"
import { NotesBar } from "./components/NotesBar"
import { RightSidebar } from "./components/RightSidebar"
import { SettingsDialog } from "./components/SettingsDialog"
import { RenderFarm } from "./components/RenderFarm"
import { PresentOverlay } from "./components/PresentOverlay"
import { useLibrary } from "./library"
import { closeRoom, openRoom } from "./collab"
import { DriveNotice } from "./components/ShareDialog"

function Diagnostics() {
  const errors = useStore((s) => s.errors)
  const warnings = useStore((s) => s.warnings)
  const aiWriting = useStore((s) => s.aiPreview != null)
  if (aiWriting) return <div className="border-t bg-highlight/15 px-3 py-1.5 text-xs">The AI is writing — the code is read-only until it finishes.</div>
  if (!errors.length && !warnings.length) return null
  return (
    <div className="max-h-28 overflow-auto border-t px-3 py-1.5 text-xs">
      {errors.map((e, i) => (
        <div key={i} className="flex gap-1.5 text-destructive"><AlertCircleIcon className="mt-0.5 size-3 shrink-0" />{e.line ? `${e.line}:${e.column ?? 0} ` : ""}{e.message}{i === 0 && " — the canvas shows the last version that compiled."}</div>
      ))}
      {warnings.map((w, i) => <div key={`w${i}`} className="text-warning">{w.line ? `${w.line}: ` : ""}{w.message}</div>)}
    </div>
  )
}

function CodePane() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center border-b px-3 text-xs text-muted-foreground">deck.tsx</div>
      <div className="min-h-0 flex-1"><CodeEditor /></div>
      <Diagnostics />
    </div>
  )
}

function CanvasPane() {
  return (
    <ResizablePanelGroup orientation="vertical">
      <ResizablePanel defaultSize="80%" minSize="40%"><Canvas /></ResizablePanel>
      <ResizableHandle />
      <ResizablePanel defaultSize="20%" minSize="8%"><NotesBar /></ResizablePanel>
    </ResizablePanelGroup>
  )
}

export function App() {
  const view = useStore((s) => s.view)
  const [settings, setSettings] = useState(false)
  const deckId = useLibrary((s) => s.currentId)
  const roomId = useLibrary((s) => s.decks.find((d) => d.id === s.currentId)?.roomId)

  // A Drive deck keeps ?file=<id> in the address while it's open, so a reload or a copied link opens it again.
  const driveFile = useLibrary((s) => { const d = s.decks.find((d) => d.id === s.currentId); return d?.drive ? d.roomId : undefined })
  useEffect(() => {
    if (location.hash === "#audience") return
    const url = new URL(location.href)
    if (driveFile) url.searchParams.set("file", driveFile)
    else url.searchParams.delete("file")
    if (url.href !== location.href) history.replaceState(null, "", url)
  }, [driveFile])

  // A shared deck keeps a live room open while it is the open one.
  useEffect(() => {
    if (!roomId) return
    openRoom(deckId, roomId)
    return closeRoom
  }, [deckId, roomId])
  return (
    <ResizableSidebarProvider>
      <div id="app-shell" className="flex h-full flex-col bg-background text-foreground">
        <TopBar onSettings={() => setSettings(true)} />
        <DriveNotice />
        <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
          <ResizablePanel defaultSize="13%" minSize="8%" maxSize="22%" className="border-r">
            <Thumbnails />
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize="62%" minSize="30%">
            {view === "split" ? (
              <ResizablePanelGroup orientation="horizontal">
                <ResizablePanel defaultSize="58%" minSize="25%"><CanvasPane /></ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize="42%" minSize="20%"><CodePane /></ResizablePanel>
              </ResizablePanelGroup>
            ) : view === "canvas" ? <CanvasPane /> : <CodePane />}
          </ResizablePanel>
          <ResizableHandle />
          <ResizableSidebar id="assistant" shortcut="mod+alt+b" defaultSize="25%" minSize="18%" maxSize="40%" className="border-l">
            <RightSidebar onNeedKey={() => setSettings(true)} />
          </ResizableSidebar>
        </ResizablePanelGroup>
      </div>
      <RenderFarm />
      <PresentOverlay />
      <SettingsDialog open={settings} onOpenChange={setSettings} />
    </ResizableSidebarProvider>
  )
}
