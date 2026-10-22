import { useState } from "react"
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
} from "@alexandernygard/components"
import { UsersIcon } from "lucide-react"
import { toast } from "@alexandernygard/components"
import type { Item } from "@alexandernygard/drive"
import { DriveFileButton, DriveLogo, ShareDialog as DriveShareDialog, useDriveUser } from "@alexandernygard/drive/react"
import { drive, saveToDrive, useCollab } from "../collab"
import { shareDeck, useLibrary } from "../library"

/** Share, for the deck that's open: Drive's sharing for a Drive deck, else saving it to Drive first. */
export function ShareControls() {
  const deck = useLibrary((s) => s.decks.find((d) => d.id === s.currentId))
  const driveItem = useCollab((s) => s.driveItem)
  const peers = useCollab((s) => s.peers)
  const [sharing, setSharing] = useState(false)
  // A deck just saved to Drive opens straight in Drive's share dialog.
  const [saved, setSaved] = useState<Item | null>(null)
  const shareSaved = (
    <DriveShareDialog
      itemId={saved?.id ?? ""}
      initial={saved}
      open={!!saved}
      onOpenChange={(o) => !o && setSaved(null)}
      onChange={(item) => useCollab.setState({ driveItem: item })}
      drive={drive}
    />
  )
  if (deck?.drive && deck.roomId) {
    return (
      <>
        <Peers status />
        <DriveFileButton fileId={deck.roomId} item={driveItem} peers={peers.map((p) => p.state.user)} onItemChange={(item) => useCollab.setState({ driveItem: item })} />
        {shareSaved}
      </>
    )
  }
  return (
    <>
      <Peers />
      <Button size="sm" variant={deck?.roomId ? "secondary" : "ghost"} aria-label="Share" onClick={() => setSharing(true)}><UsersIcon /> <span className="hidden sm:inline">Share</span></Button>
      <ShareDialog open={sharing} onOpenChange={setSharing} onSaved={setSaved} />
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

/**
 * Share for a deck that isn't in Drive: sharing needs an account, so it saves the deck to Drive, where you
 * add people by email. Signed out, it asks you to sign in first.
 */
export function ShareDialog({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; onSaved: (item: Item) => void }) {
  // Shared by link before Drive: anyone with the link can still edit until it's saved to Drive or stopped.
  const linkRoom = useLibrary((s) => s.decks.find((d) => d.id === s.currentId && !d.drive)?.roomId)
  const user = useDriveUser(drive)
  const [saving, setSaving] = useState(false)
  const signedOut = user.status === "signed-out"
  const save = () => {
    setSaving(true)
    saveToDrive().then(
      (item) => { setSaving(false); onOpenChange(false); onSaved(item) },
      (e) => {
        setSaving(false)
        if (e?.signedOut) location.href = drive.loginUrl()
        else toast.error(e?.message ?? "Couldn't save to Drive")
      },
    )
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share this deck</DialogTitle>
          <DialogDescription>
            {signedOut ? "Sign in to share. " : ""}Sharing saves the deck to Drive, where you add people by email and choose who can edit.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-3 rounded-xl border bg-muted/40 p-3">
          <DriveLogo size={28} className="shrink-0" />
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">
            {signedOut ? "With a Nyggis account, your decks are kept in Drive and open from any device." : "You'll find it with all your files at drive.nyggis.com."}
          </p>
        </div>
        {linkRoom && (
          <p className="text-sm text-muted-foreground">
            This deck is also shared by an older link that anyone can edit. Saving it to Drive turns that link off.{" "}
            <button className="font-medium text-foreground underline underline-offset-2" onClick={() => { void shareDeck(undefined); onOpenChange(false) }}>
              Turn it off now
            </button>
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {signedOut ? (
            <Button asChild><a href={drive.loginUrl()}>Sign in</a></Button>
          ) : (
            <Button disabled={user.status === "loading" || saving} onClick={save}>{saving ? "Saving…" : "Save to Drive and share"}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
