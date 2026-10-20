// The deck library: many decks in IndexedDB, autosave, version history,
// assets (images and fonts stored with each deck) and two-way sync with files on disk.
//
// The editor store still holds one source string; this module loads a deck
// into it, and saves whatever the store's source becomes.

import { create } from "zustand"
import { toast } from "@alexandernygard/components"
import { compile, assetRefs, fontFamilyOf, setProps, STARTER_DECK } from "@ppt2/sdk"
import { addAssetUrl, setAssetUrls } from "@ppt2/react"
import { db, type DeckRecord, type LinkRecord, type VersionRecord } from "./lib/db"
import { useStore } from "./store"

export type { DeckRecord, VersionRecord }

interface Link { kind: "file" | "folder"; name: string; permission: PermissionState }
interface LibraryState {
  ready: boolean
  decks: DeckRecord[]
  currentId: string
  status: "saved" | "saving" | "error"
  link: Link | null
  /** Assets of the open deck, by name. */
  assets: Record<string, { width?: number; height?: number }>
}

export const useLibrary = create<LibraryState>()(() => ({ ready: false, decks: [], currentId: "", status: "saved", link: null, assets: {} }))

const CURRENT_KEY = "ppt2.deck"
const AUTO_VERSION_EVERY = 10 * 60_000
const KEEP_AUTO_VERSIONS = 60
const DECK_FILE = "deck.tsx"

export const BLANK_DECK = `import { Deck, Slide, Title, Subtitle } from "ppt2"

export default (
  <Deck title="Untitled deck" theme="snow">
    <Slide layout="title">
      <Title>Untitled deck</Title>
      <Subtitle>Click to edit, or ask the AI to write it</Subtitle>
    </Slide>
  </Deck>
)
`

export const diskSupported = typeof window !== "undefined" && "showOpenFilePicker" in window && "showDirectoryPicker" in window

const newId = () => crypto.randomUUID().slice(0, 8)
const byUpdated = (a: DeckRecord, b: DeckRecord) => b.updatedAt - a.updatedAt
const meta = (source: string) => { const d = compile(source).deck; return { title: d?.title ?? "Untitled deck", slides: d?.slides.length ?? 0 } }
const set = useLibrary.setState
const get = useLibrary.getState

function record(source: string, id = newId()): DeckRecord {
  const now = Date.now()
  return { id, source, ...meta(source), createdAt: now, updatedAt: now }
}

function upsertList(rec: DeckRecord) {
  set({ decks: [rec, ...get().decks.filter((d) => d.id !== rec.id)].sort(byUpdated) })
}

// --- assets -----------------------------------------------------------------

let objectUrls: string[] = []

export async function loadAssets(deckId: string) {
  objectUrls.forEach((u) => URL.revokeObjectURL(u))
  objectUrls = []
  const urls: Record<string, string> = {}
  const info: LibraryState["assets"] = {}
  for (const a of await db.byDeck("assets", deckId)) {
    const u = URL.createObjectURL(a.blob)
    objectUrls.push(u)
    urls[a.name] = u
    info[a.name] = { width: a.width, height: a.height }
  }
  setAssetUrls(urls)
  set({ assets: info })
}

const slugName = (name: string) => name.toLowerCase().replace(/\.[^.]+$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "image"

/** Downscale very large images so decks stay light; keep vectors and GIFs as they are. */
async function prepare(file: Blob): Promise<{ blob: Blob; width?: number; height?: number; ext: string }> {
  const ext = file.type === "image/svg+xml" ? "svg" : file.type === "image/gif" ? "gif" : file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg"
  if (ext === "svg" || ext === "gif") {
    const dims = await new Promise<{ width?: number; height?: number }>((resolve) => {
      const img = new Image()
      const u = URL.createObjectURL(file)
      img.onload = () => { resolve({ width: img.naturalWidth, height: img.naturalHeight }); URL.revokeObjectURL(u) }
      img.onerror = () => { resolve({}); URL.revokeObjectURL(u) }
      img.src = u
    })
    return { blob: file, ext, ...dims }
  }
  const bmp = await createImageBitmap(file)
  const MAX = 3200
  const k = Math.min(1, MAX / Math.max(bmp.width, bmp.height))
  if (k === 1 && file.size < 4_000_000) { const r = { blob: file, width: bmp.width, height: bmp.height, ext }; bmp.close(); return r }
  const c = new OffscreenCanvas(Math.round(bmp.width * k), Math.round(bmp.height * k))
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height)
  bmp.close()
  const png = ext === "png"
  return { blob: await c.convertToBlob({ type: png ? "image/png" : "image/jpeg", quality: 0.88 }), width: c.width, height: c.height, ext: png ? "png" : "jpg" }
}

/** Store images with the current deck. Returns their source references ("assets/<name>"). */
export async function addImages(files: Blob[], names: string[] = []): Promise<{ ref: string; width?: number; height?: number }[]> {
  const deckId = get().currentId
  const out: { ref: string; width?: number; height?: number }[] = []
  for (const [i, file] of files.entries()) {
    const { blob, width, height, ext } = await prepare(file)
    const base = slugName(names[i] ?? (file as File).name ?? "image")
    let name = `${base}.${ext}`
    for (let n = 2; get().assets[name]; n++) name = `${base}-${n}.${ext}`
    await db.put("assets", { key: `${deckId}/${name}`, deckId, name, blob, width, height, createdAt: Date.now() })
    const u = URL.createObjectURL(blob)
    objectUrls.push(u)
    addAssetUrl(name, u)
    set({ assets: { ...get().assets, [name]: { width, height } } })
    out.push({ ref: `assets/${name}`, width, height })
  }
  return out
}

const FONT_TYPES: Record<string, string> = { woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", otf: "font/otf" }

/** Store font files with the current deck. Returns their references ("assets/<name>") and the family each registers as. */
export async function addFonts(files: File[]): Promise<{ ref: string; family: string }[]> {
  const deckId = get().currentId
  const out: { ref: string; family: string }[] = []
  for (const file of files) {
    const ext = /\.(woff2?|ttf|otf)$/i.exec(file.name)?.[1].toLowerCase()
    if (!ext) throw new Error(`${file.name} isn't a font file (.woff2, .woff, .ttf or .otf)`)
    // Keep the file's own name (minus odd characters): it becomes the font's family name.
    const base = file.name.slice(0, -ext.length - 1).replace(/[^A-Za-z0-9 _-]+/g, "").trim().replace(/\s+/g, "-") || "font"
    let name = `${base}.${ext}`
    for (let n = 2; get().assets[name]; n++) name = `${base}-${n}.${ext}`
    const blob = file.type ? file : new Blob([file], { type: FONT_TYPES[ext] })
    await db.put("assets", { key: `${deckId}/${name}`, deckId, name, blob, createdAt: Date.now() })
    const u = URL.createObjectURL(blob)
    objectUrls.push(u)
    addAssetUrl(name, u)
    set({ assets: { ...get().assets, [name]: {} } })
    out.push({ ref: `assets/${name}`, family: fontFamilyOf(name) })
  }
  return out
}

// --- saving & versions ------------------------------------------------------

let timer: ReturnType<typeof setTimeout> | undefined
let lastSaved = ""
let suppress = false
let lastAiSnapshot = 0

async function save() {
  timer = undefined
  const { currentId, decks } = get()
  const { source, deck } = useStore.getState()
  if (source === lastSaved) { set({ status: "saved" }); return }
  const prev = decks.find((d) => d.id === currentId)
  if (!prev) return
  const rec: DeckRecord = { ...prev, source, title: deck?.title ?? prev.title, slides: deck?.slides.length ?? prev.slides, updatedAt: Date.now() }
  try {
    await db.put("decks", rec)
    lastSaved = source
    upsertList(rec)
    await autoVersion(rec)
    await writeDisk(source)
    set({ status: timer ? "saving" : "saved" })
  } catch (e) {
    console.error(e)
    set({ status: "error" })
  }
}

async function flush() {
  if (timer) { clearTimeout(timer); await save() }
}

async function addVersion(deckId: string, source: string, label: string | undefined, auto: boolean) {
  await db.put("versions", { deckId, source, ...meta(source), label, auto, createdAt: Date.now() })
}

async function autoVersion(rec: DeckRecord) {
  const versions = await listVersions(rec.id)
  const last = versions[0]
  if (last && (Date.now() - last.createdAt < AUTO_VERSION_EVERY || last.source === rec.source)) return
  await addVersion(rec.id, rec.source, undefined, true)
  const auto = versions.filter((v) => v.auto)
  for (const v of auto.slice(KEEP_AUTO_VERSIONS - 1)) await db.delete("versions", v.id!)
}

export async function listVersions(deckId = get().currentId): Promise<VersionRecord[]> {
  return (await db.byDeck("versions", deckId)).sort((a, b) => b.createdAt - a.createdAt)
}

export async function saveVersion(label: string) {
  await addVersion(get().currentId, useStore.getState().source, label.trim() || undefined, false)
}

export async function restoreVersion(v: VersionRecord) {
  const { source } = useStore.getState()
  if (source === v.source) return
  await addVersion(v.deckId, source, "Before restoring an older version", true)
  useStore.getState().setSource(v.source, "load")
}

// --- decks ------------------------------------------------------------------

async function activate(rec: DeckRecord) {
  await flush()
  await loadAssets(rec.id)
  set({ currentId: rec.id, status: "saved" })
  try { localStorage.setItem(CURRENT_KEY, rec.id) } catch { /* private mode */ }
  suppress = true
  useStore.getState().openSource(rec.source)
  suppress = false
  lastSaved = rec.source
  await loadLink(rec.id)
}

export async function boot() {
  let decks = await db.all("decks")
  if (!decks.length) {
    // First run (or upgrade from the single-deck version): keep what was in localStorage.
    let source = STARTER_DECK
    try { source = localStorage.getItem("ppt2.source") || STARTER_DECK } catch { /* ignore */ }
    const rec = record(source)
    await db.put("decks", rec)
    decks = [rec]
  }
  decks.sort(byUpdated)
  let want: string | null = null
  try { want = localStorage.getItem(CURRENT_KEY) } catch { /* ignore */ }
  set({ decks })
  await activate(decks.find((d) => d.id === want) ?? decks[0])
  useStore.subscribe((s, prev) => {
    if (suppress || s.source === prev.source) return
    if (s.lastOrigin === "ai" && (prev.lastOrigin !== "ai" || Date.now() - lastAiSnapshot > 60_000)) {
      lastAiSnapshot = Date.now()
      void addVersion(get().currentId, prev.source, "Before AI edit", true)
    }
    set({ status: "saving" })
    clearTimeout(timer)
    timer = setTimeout(save, 600)
  })
  addEventListener("pagehide", () => { void flush() })
  setInterval(() => { void watchDisk() }, 1500)
  set({ ready: true })
}

export async function openDeck(id: string) {
  if (id === get().currentId) return
  const rec = await db.get("decks", id)
  if (rec) await activate(rec)
}

export async function createDeck(source = BLANK_DECK) {
  await flush()
  const rec = record(source)
  await db.put("decks", rec)
  upsertList(rec)
  await activate(rec)
  return rec
}

export async function duplicateDeck(id: string) {
  await flush()
  const src = await db.get("decks", id)
  if (!src) return
  const model = compile(src.source).deck
  const source = model?.src != null ? setProps(src.source, model.src, { title: `${model.title} (copy)` }).source : src.source
  const rec = record(source)
  await db.put("decks", rec)
  for (const a of await db.byDeck("assets", id)) await db.put("assets", { ...a, key: `${rec.id}/${a.name}`, deckId: rec.id })
  upsertList(rec)
  await activate(rec)
}

export async function deleteDeck(id: string) {
  await db.deleteDeck(id)
  const decks = get().decks.filter((d) => d.id !== id)
  set({ decks })
  if (id === get().currentId) {
    timer && clearTimeout(timer)
    timer = undefined
    if (decks[0]) await activate(decks[0])
    else await createDeck()
  }
}

// --- files on disk ----------------------------------------------------------

let link: LinkRecord | null = null
let lastDisk = { text: "", modified: 0 }
let writtenAssets = new Set<string>()
let diskBusy = false

async function loadLink(deckId: string) {
  link = (await db.get("links", deckId)) ?? null
  lastDisk = { text: "", modified: 0 }
  writtenAssets = new Set()
  if (!link) { set({ link: null }); return }
  const permission = (await link.handle.queryPermission?.({ mode: "readwrite" })) ?? "granted"
  set({ link: { kind: link.kind, name: link.name, permission } })
  if (permission === "granted") await syncFromDisk(true)
}

async function deckFile(create = false): Promise<FileSystemFileHandle | undefined> {
  if (!link) return
  if (link.kind === "file") return link.handle as FileSystemFileHandle
  const dir = link.handle as FileSystemDirectoryHandle
  return dir.getFileHandle(link.file ?? DECK_FILE, { create })
}

async function writeFile(handle: FileSystemFileHandle, data: Blob | string) {
  const w = await handle.createWritable()
  await w.write(data)
  await w.close()
}

async function writeDisk(source: string) {
  if (!link || get().link?.permission !== "granted" || source === lastDisk.text) return
  diskBusy = true
  try {
    const file = (await deckFile(true))!
    await writeFile(file, source)
    lastDisk = { text: source, modified: (await file.getFile()).lastModified }
    if (link.kind === "folder") await writeAssets()
  } catch (e) {
    console.error(e)
    toast.error(`Couldn't write ${link.name}: ${(e as Error).message}`)
  } finally { diskBusy = false }
}

async function writeAssets() {
  const deck = useStore.getState().deck
  if (!link || link.kind !== "folder" || !deck) return
  const needed = assetRefs(deck).filter((n) => !writtenAssets.has(n))
  if (!needed.length) return
  const dir = await (link.handle as FileSystemDirectoryHandle).getDirectoryHandle("assets", { create: true })
  for (const name of needed) {
    const rec = await db.get("assets", `${get().currentId}/${name}`)
    if (!rec) continue
    const exists = await dir.getFileHandle(name).then((h) => h.getFile()).then((f) => f.size === rec.blob.size, () => false)
    if (!exists) await writeFile(await dir.getFileHandle(name, { create: true }), rec.blob)
    writtenAssets.add(name)
  }
}

/** Pick up edits made outside ppt2 (an editor, git, Claude Code). */
async function syncFromDisk(initial = false) {
  const handle = await deckFile().catch(() => undefined)
  if (!handle) return
  const file = await handle.getFile()
  if (file.lastModified === lastDisk.modified) return
  const text = await file.text()
  lastDisk = { text, modified: file.lastModified }
  if (link?.kind === "folder") await importFolderAssets(link.handle as FileSystemDirectoryHandle)
  const { source } = useStore.getState()
  if (text === source) return
  const current = get().decks.find((d) => d.id === get().currentId)
  if (initial && current && file.lastModified < current.updatedAt) { await writeDisk(source); return } // ours is newer
  useStore.getState().setSource(text, "load")
  toast.info(`Updated from ${link?.kind === "folder" ? `${link.name}/` : ""}${handle.name}`)
}

async function watchDisk() {
  if (!link || diskBusy || document.hidden || get().link?.permission !== "granted") return
  diskBusy = true
  try { await syncFromDisk() } catch { /* file moved or deleted; keep the in-app copy */ } finally { diskBusy = false }
}

async function importFolderAssets(dir: FileSystemDirectoryHandle) {
  const assets = await dir.getDirectoryHandle("assets").catch(() => undefined)
  if (!assets) return
  const files: File[] = []
  for await (const h of assets.values()) {
    if (h.kind !== "file" || get().assets[h.name] || !/\.(png|jpe?g|gif|webp|svg|avif|woff2?|ttf|otf)$/i.test(h.name)) continue
    files.push(await (h as FileSystemFileHandle).getFile())
  }
  // Keep file names as they are on disk, since the source refers to them.
  const deckId = get().currentId
  for (const f of files) {
    const bmp = f.type.startsWith("image/") && f.type !== "image/svg+xml" ? await createImageBitmap(f).catch(() => undefined) : undefined
    await db.put("assets", { key: `${deckId}/${f.name}`, deckId, name: f.name, blob: f, width: bmp?.width, height: bmp?.height, createdAt: Date.now() })
    const u = URL.createObjectURL(f)
    objectUrls.push(u)
    addAssetUrl(f.name, u)
    set({ assets: { ...get().assets, [f.name]: { width: bmp?.width, height: bmp?.height } } })
    writtenAssets.add(f.name)
    bmp?.close()
  }
}

async function setLink(rec: LinkRecord) {
  await db.put("links", rec)
  link = rec
  writtenAssets = new Set()
  lastDisk = { text: "", modified: 0 }
  set({ link: { kind: rec.kind, name: rec.name, permission: "granted" } })
}

const slug = () => (useStore.getState().deck?.title ?? "deck").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "deck"
const TSX: FilePickerType[] = [{ description: "ppt2 deck", accept: { "text/plain": [".tsx"] } }]
const cancelled = (e: unknown) => (e as Error)?.name === "AbortError"

export async function saveToFile() {
  try {
    const handle = await window.showSaveFilePicker!({ suggestedName: `${slug()}.deck.tsx`, types: TSX, id: "ppt2" })
    await flush()
    await setLink({ deckId: get().currentId, kind: "file", name: handle.name, handle })
    await writeDisk(useStore.getState().source)
    const images = useStore.getState().deck ? assetRefs(useStore.getState().deck!).length : 0
    if (images) toast.warning(`Saved ${handle.name}, but its ${images} image${images > 1 ? "s" : ""} can't go in a single file. Use "Save as folder" to keep them together.`)
    else toast.success(`Saved to ${handle.name}. Changes now sync both ways.`)
  } catch (e) { if (!cancelled(e)) toast.error((e as Error).message) }
}

export async function saveToFolder() {
  try {
    const dir = await window.showDirectoryPicker!({ mode: "readwrite", id: "ppt2" })
    const existing = await findDeckFile(dir)
    const name = existing?.name ?? DECK_FILE
    if (existing) {
      const text = await (await existing.getFile()).text()
      if (text !== useStore.getState().source && !confirm(`${dir.name}/${name} already exists. Replace it with this deck?`)) return
    }
    await flush()
    await setLink({ deckId: get().currentId, kind: "folder", name: dir.name, handle: dir, file: name })
    await writeDisk(useStore.getState().source)
    toast.success(`Saved to ${dir.name}/ with its images. Changes now sync both ways.`)
  } catch (e) { if (!cancelled(e)) toast.error((e as Error).message) }
}

async function findDeckFile(dir: FileSystemDirectoryHandle): Promise<FileSystemFileHandle | undefined> {
  let fallback: FileSystemFileHandle | undefined
  for await (const h of dir.values()) {
    if (h.kind !== "file") continue
    if (h.name === DECK_FILE || h.name.endsWith(".deck.tsx")) return h as FileSystemFileHandle
    if (h.name.endsWith(".tsx")) fallback ??= h as FileSystemFileHandle
  }
  return fallback
}

/** Open a deck file. Returns false if the user cancelled. */
export async function openFile() {
  try {
    const [handle] = await window.showOpenFilePicker!({ types: TSX, id: "ppt2" })
    const text = await (await handle.getFile()).text()
    await createDeck(text)
    await setLink({ deckId: get().currentId, kind: "file", name: handle.name, handle })
    lastDisk = { text, modified: (await handle.getFile()).lastModified }
    toast.success(`Opened ${handle.name}. Edits save back to it.`)
  } catch (e) { if (!cancelled(e)) toast.error((e as Error).message) }
}

export async function openFolder() {
  try {
    const dir = await window.showDirectoryPicker!({ mode: "readwrite", id: "ppt2" })
    const file = await findDeckFile(dir)
    if (!file) { toast.error(`No deck.tsx or *.deck.tsx in ${dir.name}/`); return }
    const f = await file.getFile()
    const text = await f.text()
    await createDeck(text)
    await setLink({ deckId: get().currentId, kind: "folder", name: dir.name, handle: dir, file: file.name })
    await importFolderAssets(dir)
    lastDisk = { text, modified: f.lastModified }
    useStore.getState().openSource(text) // re-render with the images now registered
    toast.success(`Opened ${dir.name}/${file.name}. Edits save back to it.`)
  } catch (e) { if (!cancelled(e)) toast.error((e as Error).message) }
}

export async function importText(text: string) {
  await createDeck(text)
}

export async function reconnect() {
  if (!link) return
  const permission = (await link.handle.requestPermission?.({ mode: "readwrite" })) ?? "granted"
  set({ link: { kind: link.kind, name: link.name, permission } })
  if (permission === "granted") await syncFromDisk(true)
}

export async function unlink() {
  await db.delete("links", get().currentId)
  link = null
  set({ link: null })
}

/** For the audience window: register the open deck's images. */
export async function loadCurrentAssets() {
  let id: string | null = null
  try { id = localStorage.getItem(CURRENT_KEY) } catch { /* ignore */ }
  if (id) await loadAssets(id)
}

if (import.meta.env.DEV) (window as unknown as { __ppt2lib: unknown }).__ppt2lib = { useLibrary, saveToFolder, saveToFile, openFolder, openFile, unlink, listVersions }
