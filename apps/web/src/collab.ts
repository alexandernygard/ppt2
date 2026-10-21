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
import { collabHooks, useStore } from "./store"
import { deckAssets, putAsset, useLibrary } from "./library"

// Live collaboration for the open deck. The Y.Doc holds the deck source as one text ("source") and the
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
  name: string
  setName(name: string): void
}

const NAME_KEY = "ppt2.name"
const loadName = () => {
  try {
    return localStorage.getItem(NAME_KEY) || `Guest ${100 + Math.floor(Math.random() * 900)}`
  } catch {
    return "Guest"
  }
}

export const useCollab = create<CollabState>()((set) => ({
  roomId: null,
  status: "off",
  failure: null,
  peers: [],
  canUndo: false,
  canRedo: false,
  name: loadName(),
  setName(name) {
    set({ name })
    try {
      localStorage.setItem(NAME_KEY, name)
    } catch {}
    session?.provider && setPresence(session.provider.awareness, { user: me() })
  },
}))

// One id per browser tab, so your own other tabs show up as separate people.
const tabId = Math.random().toString(36).slice(2, 8)
const me = () => ({ name: useCollab.getState().name, color: colorFor(tabId), id: tabId })

/** 22 random base64url characters (128 bits). Knowing the id is the permission to edit. */
export function newRoomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export const shareLink = (roomId: string) => `${location.origin}/?room=${roomId}`

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
  const provider = new CollabProvider({ url: collabUrl(roomId) })
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
      useCollab.setState({ roomId: null, status: "off", peers: [], failure: null, canUndo: false, canRedo: false })
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
