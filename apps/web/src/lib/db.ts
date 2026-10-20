// A small promise wrapper over IndexedDB: decks, their version history, their
// assets (image blobs) and their links to files on disk.

export interface DeckRecord {
  id: string
  title: string
  source: string
  slides: number
  createdAt: number
  updatedAt: number
}

export interface VersionRecord {
  id?: number
  deckId: string
  source: string
  title: string
  slides: number
  /** Named by the user, or why it was taken ("Before AI edit"). */
  label?: string
  /** Automatic snapshots get pruned; named ones are kept. */
  auto: boolean
  createdAt: number
}

export interface AssetRecord {
  key: string // `${deckId}/${name}`
  deckId: string
  name: string
  blob: Blob
  width?: number
  height?: number
  createdAt: number
}

export interface LinkRecord {
  deckId: string
  kind: "file" | "folder"
  name: string
  /** Folder links: the deck file inside the folder. */
  file?: string
  handle: FileSystemFileHandle | FileSystemDirectoryHandle
}

type Stores = { decks: DeckRecord; versions: VersionRecord; assets: AssetRecord; links: LinkRecord }
type StoreName = keyof Stores

let dbp: Promise<IDBDatabase> | undefined

function open(): Promise<IDBDatabase> {
  return (dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open("ppt2", 1)
    req.onupgradeneeded = () => {
      const db = req.result
      db.createObjectStore("decks", { keyPath: "id" })
      db.createObjectStore("versions", { keyPath: "id", autoIncrement: true }).createIndex("deckId", "deckId")
      db.createObjectStore("assets", { keyPath: "key" }).createIndex("deckId", "deckId")
      db.createObjectStore("links", { keyPath: "deckId" })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  }))
}

const done = <T,>(req: IDBRequest<T>) => new Promise<T>((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error) })

async function store<S extends StoreName>(name: S, mode: IDBTransactionMode = "readonly") {
  return (await open()).transaction(name, mode).objectStore(name)
}

export const db = {
  get: async <S extends StoreName>(name: S, key: IDBValidKey) => done((await store(name)).get(key)) as Promise<Stores[S] | undefined>,
  all: async <S extends StoreName>(name: S) => done((await store(name)).getAll()) as Promise<Stores[S][]>,
  byDeck: async <S extends "versions" | "assets">(name: S, deckId: string) => done((await store(name)).index("deckId").getAll(deckId)) as Promise<Stores[S][]>,
  put: async <S extends StoreName>(name: S, value: Stores[S]) => done((await store(name, "readwrite")).put(value)),
  delete: async (name: StoreName, key: IDBValidKey) => done((await store(name, "readwrite")).delete(key)),
  /** Remove a deck and everything that belongs to it. */
  async deleteDeck(id: string) {
    const tx = (await open()).transaction(["decks", "versions", "assets", "links"], "readwrite")
    tx.objectStore("decks").delete(id)
    tx.objectStore("links").delete(id)
    for (const name of ["versions", "assets"] as const) {
      const req = tx.objectStore(name).index("deckId").openKeyCursor(IDBKeyRange.only(id))
      req.onsuccess = () => { const c = req.result; if (c) { tx.objectStore(name).delete(c.primaryKey); c.continue() } }
    }
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error) })
  },
}
