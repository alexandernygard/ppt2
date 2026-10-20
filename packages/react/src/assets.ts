import type { ThemeFontFace } from "@ppt2/sdk"

// Deck assets: images and fonts stored with the deck and referenced as "assets/<name>".
// The host app registers an object URL per asset name before rendering; the
// renderer resolves references through here, so the source stays portable.

const urls = new Map<string, string>()

/** Replace the registered assets (e.g. when opening another deck). */
export function setAssetUrls(map: Record<string, string>) {
  urls.clear()
  for (const [k, v] of Object.entries(map)) urls.set(k, v)
}

export function addAssetUrl(name: string, url: string) {
  urls.set(name, url)
}

export const isAssetRef = (src: unknown): boolean => typeof src === "string" && src.startsWith("assets/")

/** Turn an image reference into something a browser can load. Unknown assets resolve to "". */
export function resolveSrc(src: unknown): string {
  if (typeof src !== "string") return ""
  return isAssetRef(src) ? urls.get(src.slice(7)) ?? "" : src
}

// --- fonts --------------------------------------------------------------------

const faces = new Map<string, { url: string; face: FontFace }>()

/** Register a theme's font files with the document (idempotent; re-registers when an asset's URL changes). */
export function registerFonts(list: ThemeFontFace[] | undefined) {
  if (!list?.length || typeof document === "undefined" || typeof FontFace === "undefined") return
  for (const f of list) {
    const url = resolveSrc(f.src)
    if (!url) continue
    const key = `${f.family}|${f.weight}|${f.style}|${f.src}`
    const known = faces.get(key)
    if (known?.url === url) continue
    if (known) document.fonts.delete(known.face)
    const face = new FontFace(f.family, `url("${url}")`, { weight: f.weight, style: f.style })
    faces.set(key, { url, face })
    document.fonts.add(face)
    face.load().catch((e) => console.warn(`Couldn't load font ${f.src}:`, e))
  }
}
