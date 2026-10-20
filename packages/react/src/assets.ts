// Deck assets: images stored with the deck and referenced as "assets/<name>".
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
