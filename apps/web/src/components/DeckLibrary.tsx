import { useState } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  ScrollArea,
  cn,
} from "@alexandernygard/components"
import { CopyIcon, FilePlusIcon, FileUpIcon, FolderOpenIcon, SparklesIcon, Trash2Icon } from "lucide-react"
import { STARTER_DECK } from "@ppt2/sdk"
import { createDeck, deleteDeck, diskSupported, duplicateDeck, openDeck, openFile, openFolder, useLibrary, type DeckRecord } from "../library"
import { DeckThumb, ago } from "./DeckThumb"

export function DeckLibrary({ open, onOpenChange, onImport }: { open: boolean; onOpenChange: (o: boolean) => void; onImport: () => void }) {
  const decks = useLibrary((s) => s.decks)
  const currentId = useLibrary((s) => s.currentId)
  const [confirm, setConfirm] = useState<DeckRecord | null>(null)
  const close = () => onOpenChange(false)
  const run = (fn: () => Promise<unknown>) => async () => { await fn(); close() }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>Decks</DialogTitle>
            <DialogDescription>Stored in this browser and saved as you work. Link a deck to a file or folder to keep it on disk too.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={run(() => createDeck())}><FilePlusIcon /> New deck</Button>
            <Button size="sm" variant="outline" onClick={run(() => createDeck(STARTER_DECK))}><SparklesIcon /> New from example</Button>
            {diskSupported ? (
              <>
                <Button size="sm" variant="outline" onClick={run(openFile)}><FileUpIcon /> Open file…</Button>
                <Button size="sm" variant="outline" onClick={run(openFolder)}><FolderOpenIcon /> Open folder…</Button>
              </>
            ) : (
              <Button size="sm" variant="outline" onClick={() => { close(); onImport() }}><FileUpIcon /> Import .deck.tsx…</Button>
            )}
          </div>
          <ScrollArea className="-mx-2 min-h-0 flex-1">
            <div className="grid grid-cols-2 gap-4 p-2 md:grid-cols-3 lg:grid-cols-4">
              {decks.map((d) => (
                <div key={d.id} className="group relative">
                  <button
                    type="button"
                    onClick={run(() => openDeck(d.id))}
                    className={cn("flex w-full flex-col gap-2 rounded-xl p-2 text-left ring-1 ring-border transition hover:ring-foreground/30", d.id === currentId && "ring-2 ring-highlight hover:ring-highlight")}
                  >
                    <DeckThumb source={d.source} />
                    <div className="min-w-0 px-0.5">
                      <div className="truncate text-sm font-medium">{d.title}</div>
                      <div className="text-xs text-muted-foreground">{d.slides} slide{d.slides === 1 ? "" : "s"} · {d.id === currentId ? "open now" : ago(d.updatedAt)}</div>
                    </div>
                  </button>
                  <div className="absolute top-3 right-3 flex gap-1 opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100">
                    <Button size="icon-sm" variant="secondary" aria-label={`Duplicate ${d.title}`} onClick={run(() => duplicateDeck(d.id))}><CopyIcon /></Button>
                    <Button size="icon-sm" variant="secondary" aria-label={`Delete ${d.title}`} onClick={() => setConfirm(d)}><Trash2Icon /></Button>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{confirm?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>This removes the deck, its version history and its images from this browser. Files on disk are not touched.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => { if (confirm) void deleteDeck(confirm.id); setConfirm(null) }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
