import { create } from "zustand"
import * as Y from "yjs"
import { toast } from "@alexandernygard/components"
import {
  CollabProvider,
  ORIGIN_AI,
  ORIGIN_LOCAL,
  bindText,
  collabUrl,
  colorFor,
  createUndoManager,
  getPeers,
  setPresence,
  throttle,
  type Peer,
} from "@alexandernygard/collab"
import { toJpeg } from "html-to-image"
import { DriveError, deniedMessage, getDrive, type Item, type Me } from "@alexandernygard/drive"
import { collabHooks, useStore } from "./store"
import { deckAssets, putAsset, setDriveTitle, shareDeck, useLibrary } from "./library"
import { farmSlide, settled } from "./components/RenderFarm"

export const drive = getDrive()

// Live collaboration for the open deck. A deck in Drive (drive.nyggis.com) connects to the drive's room
// with a ticket that carries the person's access. Decks shared by link before Drive existed still use
// this app's own Worker; new sharing always goes through Drive, which needs an account.
// The Y.Doc holds the deck source as one text ("source") and the
// deck's images and fonts as bytes ("assets", keyed by the name the source refers to). The store stays
// the source the rest of the app reads; bindText keeps the two equal, and edits from others arrive
// through setSource(…, "remote").

export interface PptPresence {
  /** The slide this person is on, or the component they are editing. */
  slide?: number
  component?: string | null
  /** The element they have selected (a path like "2/0"). */
  selected?: string | null
}

interface CollabState {
  roomId: string | null
  status: "off" | "connecting" | "live" | "offline" | "failed"
  failure: string | null
  peers: Peer<PptPresence>[]
  canUndo: boolean
  canRedo: boolean
  /** The Drive file, as of the last ticket (name, sharing, your role). */
  driveItem: Item | null
  /** View-only access to a Drive deck. */
  readOnly: boolean
  /** The ticket was refused because nobody is signed in. */
  needsSignIn: boolean
}

export const useCollab = create<CollabState>()(() => ({
  roomId: null,
  status: "off",
  failure: null,
  peers: [],
  canUndo: false,
  canRedo: false,
  driveItem: null,
  readOnly: false,
  needsSignIn: false,
}))

// One id per browser tab, so your own other tabs show up as separate people.
const tabId = Math.random().toString(36).slice(2, 8)
let account: Me | null = null
const me = () =>
  account
    ? { name: account.name || account.email, color: colorFor(account.id), id: account.id, picture: account.picture, email: account.email }
    : { name: "Guest", color: colorFor(tabId), id: tabId }

/** Each asset goes to the room as one message, and the room refuses messages over 1 MiB. */
const MAX_SHARED_ASSET = 900 * 1024

interface AssetInfo {
  type: string
  width?: number
  height?: number
}

interface Session {
  roomId: string
  provider: CollabProvider
  stop(): void
}
let session: Session | null = null

function start(deckId: string, roomId: string): Session {
  const onDrive = !!useLibrary.getState().decks.find((d) => d.id === deckId)?.drive
  let provider!: CollabProvider
  const options = onDrive
    ? drive.roomOptions(
        roomId,
        (t) => {
          useCollab.setState({ driveItem: t.item, readOnly: t.readOnly, needsSignIn: false, failure: null })
          void setDriveTitle(deckId, t.item.name)
        },
        (e: DriveError) => {
          useCollab.setState({ failure: deniedMessage(e), needsSignIn: e.status === 401 })
          setTimeout(() => provider.disconnect())
        },
      )
    : { url: collabUrl(roomId) }
  provider = new CollabProvider(options)
  if (onDrive)
    void drive.me().then(
      (m) => {
        account = m
        setPresence(provider.awareness, { user: me() })
      },
      () => {},
    )
  const ydoc = provider.doc
  const text = ydoc.getText("source")
  const assetData = ydoc.getMap<Uint8Array>("assets")
  const assetInfo = ydoc.getMap<AssetInfo>("assetInfo")
  const undoManager = createUndoManager(text)
  const cleanups: (() => void)[] = []
  let unbind: (() => void) | null = null
  const here = () => useLibrary.getState().currentId === deckId

  const syncUndo = () => useCollab.setState({ canUndo: undoManager.undoStack.length > 0, canRedo: undoManager.redoStack.length > 0 })
  for (const ev of ["stack-item-added", "stack-item-popped", "stack-cleared"] as const) {
    undoManager.on(ev, syncUndo)
    cleanups.push(() => undoManager.off(ev, syncUndo))
  }

  // --- assets: images and fonts travel with the deck ---
  const tooLarge = new Set<string>()
  const uploadAssets = async () => {
    for (const a of await deckAssets()) {
      if (!here() || assetData.has(a.name) || tooLarge.has(a.name)) continue
      if (a.blob.size > MAX_SHARED_ASSET) {
        tooLarge.add(a.name)
        toast.warning(`${a.name} is too large to share (over 900 KB). Others see an empty image until you replace it with a smaller one.`)
        continue
      }
      const bytes = new Uint8Array(await a.blob.arrayBuffer())
      // One transaction per asset, so each is its own message.
      ydoc.transact(() => {
        assetData.set(a.name, bytes)
        assetInfo.set(a.name, { type: a.blob.type, width: a.width, height: a.height })
      }, ORIGIN_LOCAL)
    }
  }
  const downloadAssets = async () => {
    const have = useLibrary.getState().assets
    for (const [name, bytes] of assetData) {
      if (have[name] || !here()) continue
      const info = assetInfo.get(name)
      await putAsset(name, new Blob([bytes as Uint8Array<ArrayBuffer>], { type: info?.type }), info?.width, info?.height)
    }
  }
  const onAssets = (_: unknown, tr: Y.Transaction) => {
    if (!tr.local) void downloadAssets()
  }

  const bind = () => {
    // Called once, after the first sync, so nothing is pushed on top of content we have not received yet.
    const { source } = useStore.getState()
    if (text.length === 0 && source) {
      // A new room: the creator's copy becomes the document.
      ydoc.transact(() => text.insert(0, source), "seed")
    }
    unbind = bindText(text, {
      get: () => useStore.getState().source,
      set: (next) => here() && useStore.getState().setSource(next, "remote"),
      subscribe: (fn) =>
        useStore.subscribe((s, prev) => {
          if (!here() || s.source === prev.source || s.lastOrigin === "remote") return
          fn(s.source, s.lastOrigin === "ai" ? ORIGIN_AI : ORIGIN_LOCAL)
        }),
    }, { undoManager })
    assetData.observe(onAssets)
    cleanups.push(
      () => assetData.unobserve(onAssets),
      useLibrary.subscribe((s, prev) => s.assets !== prev.assets && void uploadAssets()),
    )
    void downloadAssets().then(uploadAssets)
  }

  const status = () => {
    const s = provider.status
    useCollab.setState({ status: s === "connected" ? (provider.synced ? "live" : "connecting") : s === "failed" ? "failed" : s === "connecting" ? "connecting" : "offline" })
  }
  cleanups.push(
    provider.on("status", status),
    provider.on("synced", (synced) => {
      status()
      if (synced && !unbind) bind()
    }),
    provider.on("fatal", (code, reason) => useCollab.setState({ failure: code === 4426 ? "This version of ppt2 is out of date. Refresh the page." : reason || "Could not open the shared deck." })),
  )

  const peers = () => useCollab.setState({ peers: getPeers<PptPresence>(provider.awareness) })
  provider.awareness.on("change", peers)
  cleanups.push(() => provider.awareness.off("change", peers))

  // Publish where I am and what I have selected.
  const publish = throttle(() => {
    const s = useStore.getState()
    setPresence<PptPresence>(provider.awareness, { user: me(), slide: s.current, component: s.editingComponent, selected: s.selected })
  }, 60)
  publish()
  cleanups.push(useStore.subscribe((s, prev) => (s.current !== prev.current || s.selected !== prev.selected || s.editingComponent !== prev.editingComponent) && publish()))

  // Drive shows the first slide on the deck's card: send a small picture of it after your own edits.
  if (onDrive) {
    let thumbTimer: ReturnType<typeof setTimeout> | undefined
    const sendThumb = async () => {
      if (!here() || useCollab.getState().readOnly) return
      await settled(300)
      const root = farmSlide(0)
      if (!root) return
      try {
        const url = await toJpeg(root, { pixelRatio: 0.25, quality: 0.78, skipFonts: true, cacheBust: false })
        await drive.setThumbnail(roomId, await (await fetch(url)).blob())
      } catch {
        // A missing thumbnail only means Drive draws the deck itself.
      }
    }
    cleanups.push(
      useStore.subscribe((s, prev) => {
        if (s.source === prev.source || s.lastOrigin === "remote") return
        clearTimeout(thumbTimer)
        thumbTimer = setTimeout(() => void sendThumb(), 8000)
      }),
      () => clearTimeout(thumbTimer),
    )
  }

  collabHooks.undo = () => undoManager.undo()
  collabHooks.redo = () => undoManager.redo()
  useCollab.setState({ roomId, status: "connecting", failure: null, peers: [], canUndo: false, canRedo: false })
  status()

  return {
    roomId,
    provider,
    stop() {
      unbind?.()
      for (const c of cleanups) c()
      collabHooks.undo = collabHooks.redo = undefined
      undoManager.destroy()
      provider.destroy()
      useCollab.setState({ roomId: null, status: "off", peers: [], failure: null, canUndo: false, canRedo: false, driveItem: null, readOnly: false, needsSignIn: false })
    },
  }
}

export function openRoom(deckId: string, roomId: string) {
  if (session?.roomId === roomId) return
  closeRoom()
  session = start(deckId, roomId)
}

export function closeRoom() {
  session?.stop()
  session = null
}

/** Others on this slide (or in this component's editor), for outlines on the canvas and dots on thumbnails. */
export function peersOn(peers: Peer<PptPresence>[], slide: number, component: string | null) {
  return peers.filter((p) => (component ? p.state.component === component : !p.state.component && p.state.slide === slide))
}

/** Put the open deck in Drive: it becomes a Drive file you can share with people, and this copy follows it. */
export async function saveToDrive(): Promise<Item> {
  const { decks, currentId } = useLibrary.getState()
  const deck = decks.find((d) => d.id === currentId)
  const item = await drive.create({ kind: "deck", name: useStore.getState().deck?.title ?? deck?.title ?? "Untitled deck", content: { text: useStore.getState().source } })
  await shareDeck(item.id, true)
  await setDriveTitle(currentId, item.name)
  return item
}
