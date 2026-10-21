import { useState } from "react"
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldLabel,
  Input,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
} from "@alexandernygard/components"
import { CheckIcon, CopyIcon } from "lucide-react"
import { newRoomId, shareLink, useCollab } from "../collab"
import { shareDeck, useLibrary } from "../library"

/** Who else is in this deck, and whether we are connected. */
export function Peers() {
  const roomId = useCollab((s) => s.roomId)
  const status = useCollab((s) => s.status)
  const peers = useCollab((s) => s.peers)
  if (!roomId) return null
  const dot = status === "live" ? "bg-success" : status === "connecting" ? "bg-warning" : "bg-destructive"
  const label = status === "live" ? "Live" : status === "connecting" ? "Connecting…" : status === "failed" ? "Can't connect" : "Offline, changes will sync when you reconnect"
  return (
    <div className="flex items-center gap-2">
      <div className="flex -space-x-1.5">
        {peers.slice(0, 5).map((p) => (
          <Tooltip key={p.clientId}>
            <TooltipTrigger asChild>
              <span className="flex size-6 items-center justify-center rounded-full border-2 border-background text-[10px] font-medium text-white" style={{ background: p.state.user.color }}>
                {p.state.user.name.slice(0, 1).toUpperCase()}
              </span>
            </TooltipTrigger>
            <TooltipContent>{p.state.user.name}{p.state.component ? ` · editing ${p.state.component}` : p.state.slide != null ? ` · slide ${p.state.slide + 1}` : ""}</TooltipContent>
          </Tooltip>
        ))}
        {peers.length > 5 && <span className="flex size-6 items-center justify-center rounded-full border-2 border-background bg-muted text-[10px]">+{peers.length - 5}</span>}
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="flex items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground">
            <span className={cn("size-2 rounded-full", dot)} /> {status === "live" ? (peers.length ? `${peers.length + 1} here` : "Live") : label.split(",")[0]}
          </span>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </div>
  )
}

export function ShareDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const roomId = useLibrary((s) => s.decks.find((d) => d.id === s.currentId)?.roomId)
  const name = useCollab((s) => s.name)
  const failure = useCollab((s) => s.failure)
  const [copied, setCopied] = useState(false)
  const link = roomId ? shareLink(roomId) : ""
  const copy = async () => {
    await navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share this deck</DialogTitle>
          <DialogDescription>
            {roomId
              ? "Anyone with this link can open the deck and edit it live with you. There are no accounts yet, so only share it with people you trust."
              : "Make this deck live: others join from a link and you edit together, seeing which slide each person is on and what they have selected."}
          </DialogDescription>
        </DialogHeader>
        {failure && <p className="text-sm text-destructive">{failure}</p>}
        {roomId && (
          <div className="flex gap-2">
            <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Share link" />
            <Button variant="outline" onClick={copy}>{copied ? <CheckIcon /> : <CopyIcon />} {copied ? "Copied" : "Copy"}</Button>
          </div>
        )}
        <Field>
          <FieldLabel htmlFor="collab-name">Your name</FieldLabel>
          <Input id="collab-name" value={name} onChange={(e) => useCollab.getState().setName(e.target.value)} placeholder="Shown next to your selection" />
        </Field>
        <DialogFooter>
          {roomId ? (
            <Button variant="outline" onClick={() => { void shareDeck(undefined); onOpenChange(false) }}>Stop sharing</Button>
          ) : (
            <Button onClick={() => void shareDeck(newRoomId())}>Start sharing</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
