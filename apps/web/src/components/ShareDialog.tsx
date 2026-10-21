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
import { CheckIcon, CopyIcon, UsersIcon } from "lucide-react"
import { toast } from "@alexandernygard/components"
import { DriveFileButton, DriveLogo } from "@alexandernygard/drive/react"
import { drive, newRoomId, saveToDrive, shareLink, useCollab } from "../collab"
import { shareDeck, useLibrary } from "../library"

/** Share, for the deck that's open: Drive's sharing for a Drive deck, else live link sharing. */
export function ShareControls() {
  const deck = useLibrary((s) => s.decks.find((d) => d.id === s.currentId))
  const driveItem = useCollab((s) => s.driveItem)
  const peers = useCollab((s) => s.peers)
  const [sharing, setSharing] = useState(false)
  if (deck?.drive && deck.roomId) {
    return (
      <>
        <Peers status />
        <DriveFileButton fileId={deck.roomId} item={driveItem} peers={peers.map((p) => p.state.user)} onItemChange={(item) => useCollab.setState({ driveItem: item })} />
      </>
    )
  }
  return (
    <>
      <Peers />
      <Button size="sm" variant={deck?.roomId ? "secondary" : "ghost"} onClick={() => setSharing(true)}><UsersIcon /> Share</Button>
      <ShareDialog open={sharing} onOpenChange={setSharing} />
    </>
  )
}

/** Why a Drive deck isn't open (signed out, no access), or that you can only view it. */
export function DriveNotice() {
  const failure = useCollab((s) => s.failure)
  const needsSignIn = useCollab((s) => s.needsSignIn)
  const readOnly = useCollab((s) => s.readOnly)
  const onDrive = useLibrary((s) => !!s.decks.find((d) => d.id === s.currentId)?.drive)
  if (!onDrive || (!failure && !readOnly)) return null
  return (
    <div className={cn("flex items-center gap-3 border-b px-4 py-2 text-sm", failure ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")}>
      <DriveLogo size={18} />
      <span className="flex-1">{failure ?? "You can view this deck. Ask the owner for edit access to make changes."}</span>
      {needsSignIn && <Button size="sm" asChild><a href={drive.loginUrl()}>Sign in</a></Button>}
    </div>
  )
}

/** Who else is in this deck, and whether we are connected. `status` shows only the connection. */
export function Peers({ status: statusOnly = false }: { status?: boolean }) {
  const roomId = useCollab((s) => s.roomId)
  const status = useCollab((s) => s.status)
  const peers = useCollab((s) => s.peers)
  if (!roomId) return null
  const dot = status === "live" ? "bg-success" : status === "connecting" ? "bg-warning" : "bg-destructive"
  const label = status === "live" ? "Live" : status === "connecting" ? "Connecting…" : status === "failed" ? "Can't connect" : "Offline, changes will sync when you reconnect"
  return (
    <div className="flex items-center gap-2">
      <div className={cn("flex -space-x-1.5", statusOnly && "hidden")}>
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
            <span className={cn("size-2 rounded-full", dot)} /> {statusOnly && status === "live" ? "" : status === "live" ? (peers.length ? `${peers.length + 1} here` : "Live") : label.split(",")[0]}
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
        <div className="flex items-start gap-3 rounded-xl border bg-muted/40 p-3">
          <DriveLogo size={28} className="mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Save to Drive</p>
            <p className="text-xs text-muted-foreground">Share with people by email, choose who can edit, and find it with all your files at drive.nyggis.com.</p>
          </div>
          <Button
            size="sm"
            onClick={() =>
              saveToDrive().then(
                () => { onOpenChange(false); toast.success("Saved to Drive", { description: "Use Share to add people." }) },
                (e) => (e?.signedOut ? (location.href = drive.loginUrl()) : toast.error(e?.message ?? "Couldn't save to Drive")),
              )
            }
          >
            Save
          </Button>
        </div>
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
