import { useEffect, useState } from "react"
import { Textarea } from "@alexandernygard/components"
import { useStore, useVisibleDeck } from "../store"

export function NotesBar() {
  const deck = useVisibleDeck()
  const current = useStore((s) => s.current)
  const notes = deck?.slides[current]?.notes ?? ""
  const [draft, setDraft] = useState(notes)
  useEffect(() => setDraft(notes), [notes, current])
  if (!deck?.slides[current]) return null
  const commit = () => { if (draft !== notes) useStore.getState().setNotes(current, draft) }
  return (
    <div className="flex h-full flex-col gap-1 border-t px-3 py-2">
      <label htmlFor="notes" className="text-xs font-medium text-muted-foreground">Speaker notes</label>
      <Textarea
        id="notes"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commit() }}
        placeholder="What will you say on this slide?"
        className="min-h-0 flex-1 resize-none text-sm"
      />
    </div>
  )
}
