import { useEffect, useMemo, useState } from "react"
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  ScrollArea,
  cn,
  toast,
} from "@alexandernygard/components"
import { BookmarkIcon, HistoryIcon, RotateCcwIcon } from "lucide-react"
import { compile } from "@ppt2/sdk"
import { listVersions, restoreVersion, saveVersion, useLibrary, type VersionRecord } from "../library"
import { useStore } from "../store"
import { DeckThumb, ago } from "./DeckThumb"

export function HistoryDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const currentId = useLibrary((s) => s.currentId)
  const [versions, setVersions] = useState<VersionRecord[]>([])
  const [picked, setPicked] = useState<number | "current">("current")
  const [name, setName] = useState("")
  const source = useStore((s) => s.source)

  const reload = () => listVersions(currentId).then(setVersions)
  useEffect(() => { if (open) { void reload(); setPicked("current") } }, [open, currentId])

  const v = picked === "current" ? undefined : versions.find((x) => x.id === picked)
  const shown = v?.source ?? source
  const slides = useMemo(() => compile(shown).deck?.slides.length ?? 0, [shown])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[80vh] flex-col sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Version history</DialogTitle>
          <DialogDescription>Snapshots are taken every 10 minutes while you edit, before each AI edit and before a restore. Named versions are kept forever.</DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 grid-cols-[260px_1fr] gap-4">
          <div className="flex min-h-0 flex-col gap-2">
            <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); await saveVersion(name); setName(""); await reload(); toast.success("Version saved") }}>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this version" />
              <Button type="submit" size="icon" variant="outline" aria-label="Save version"><BookmarkIcon /></Button>
            </form>
            <ScrollArea className="min-h-0 flex-1 rounded-lg ring-1 ring-border">
              <div className="flex flex-col p-1">
                {[{ id: "current" as const }, ...versions].map((x) => {
                  const cur = x.id === "current"
                  const rec = cur ? undefined : (x as VersionRecord)
                  return (
                    <button
                      key={String(x.id)}
                      type="button"
                      onClick={() => setPicked(x.id!)}
                      className={cn("flex flex-col items-start gap-0.5 rounded-md px-2.5 py-2 text-left text-sm hover:bg-muted", picked === x.id && "bg-muted ring-1 ring-highlight")}
                    >
                      <span className="flex items-center gap-1.5 font-medium">
                        {cur ? "Current version" : rec!.label ?? "Autosave"}
                        {rec && !rec.auto && <BookmarkIcon className="size-3 text-highlight" />}
                      </span>
                      <span className="text-xs text-muted-foreground">{cur ? "now" : `${ago(rec!.createdAt)} · ${rec!.slides} slides`}</span>
                    </button>
                  )
                })}
                {!versions.length && <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground"><HistoryIcon className="size-4" /> No snapshots yet.</div>}
              </div>
            </ScrollArea>
          </div>
          <div className="flex min-h-0 flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm text-muted-foreground">{v ? `${v.title} · ${new Date(v.createdAt).toLocaleString()}` : "What you have open now"}</div>
              <Button size="sm" disabled={!v || v.source === source} onClick={async () => { if (v) { await restoreVersion(v); onOpenChange(false); toast.success("Restored. Undo (⌘Z) brings back what you had.") } }}>
                <RotateCcwIcon /> Restore this version
              </Button>
            </div>
            <ScrollArea className="min-h-0 flex-1">
              <div className="grid grid-cols-2 gap-3 pr-3 lg:grid-cols-3">
                {Array.from({ length: slides }, (_, i) => <DeckThumb key={`${picked}-${i}`} source={shown} slide={i} className="ring-1 ring-border rounded-md" />)}
              </div>
            </ScrollArea>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
