import { useEffect, useRef, useState } from "react"
import {
  Button,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Switch,
  toast,
} from "@alexandernygard/components"
import { ImageUpIcon, TypeIcon, XIcon } from "lucide-react"
import type { Corner, ThemeLogo, ThemeObjectInput } from "@ppt2/sdk"
import { resolveSrc } from "@ppt2/react"
import { useStore } from "../store"
import { addFonts, addImages } from "../library"

const CORNERS: { value: Corner; label: string }[] = [
  { value: "top-left", label: "Top left" },
  { value: "top-right", label: "Top right" },
  { value: "bottom-left", label: "Bottom left" },
  { value: "bottom-right", label: "Bottom right" },
]
const FONT_ACCEPT = ".woff2,.woff,.ttf,.otf"
const firstFamily = (stack: string) => stack.split(",")[0].replace(/["']/g, "").trim()

/** Pick a file with a hidden input. */
function useFilePicker(accept: string, onFile: (f: File) => void) {
  const ref = useRef<HTMLInputElement>(null)
  const input = <input ref={ref} type="file" accept={accept} hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = "" }} />
  return [input, () => ref.current?.click()] as const
}

/**
 * The deck's brand kit: logo, footer, slide numbers and fonts. Every change is a
 * patch to the Deck's theme prop, so the source stays the single source of truth.
 */
export function BrandPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const deck = useStore((s) => s.deck)
  const setBrand = useStore((s) => s.setBrand)
  const raw: ThemeObjectInput = typeof deck?.themeInput === "object" ? deck.themeInput : {}
  const theme = deck?.theme
  const logo = theme?.logo

  const [footer, setFooter] = useState(theme?.footer ?? "")
  useEffect(() => setFooter(theme?.footer ?? ""), [theme?.footer, open])
  const commitFooter = () => { if (footer.trim() !== (theme?.footer ?? "")) setBrand({ footer: footer.trim() || undefined }) }

  /** Write the logo in its shortest form: a plain reference when everything else is default. */
  const writeLogo = (next: Partial<ThemeLogo> | null) => {
    if (!next?.src) { setBrand({ logo: undefined }); return }
    const value: Record<string, unknown> = { src: next.src }
    if (next.position && next.position !== "top-right") value.position = next.position
    if (next.height && next.height !== 56) value.height = next.height
    if (next.inverse) value.inverse = next.inverse
    setBrand({ logo: Object.keys(value).length === 1 ? next.src : value })
  }
  const uploadImage = async (f: File, key: "src" | "inverse") => {
    try {
      const [img] = await addImages([f], [f.name.replace(/\.[^.]+$/, "")])
      writeLogo({ ...logo, [key]: img.ref })
    } catch (e) { toast.error(`Couldn't add the logo: ${(e as Error).message}`) }
  }
  const [logoInput, pickLogo] = useFilePicker("image/*", (f) => void uploadImage(f, "src"))
  const [inverseInput, pickInverse] = useFilePicker("image/*", (f) => void uploadImage(f, "inverse"))

  const fontsRaw = (raw.fonts ?? {}) as Record<string, unknown>
  const setFont = (key: "heading" | "body", value: string | undefined) => {
    const next = { ...fontsRaw, [key]: value }
    if (value === undefined) delete next[key]
    setBrand({ fonts: Object.keys(next).length ? next : undefined })
  }
  const uploadFont = async (key: "heading" | "body", f: File) => {
    try {
      const [font] = await addFonts([f])
      setFont(key, font.ref)
      toast.success(`${font.family} is now the ${key} font`)
    } catch (e) { toast.error((e as Error).message) }
  }
  const [headingInput, pickHeading] = useFilePicker(FONT_ACCEPT, (f) => void uploadFont("heading", f))
  const [bodyInput, pickBody] = useFilePicker(FONT_ACCEPT, (f) => void uploadFont("body", f))

  const layouts = Object.keys(theme?.layouts ?? {})
  const masters = theme?.master?.length ?? 0

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent side="right" className="w-96 overflow-y-auto sm:max-w-96" onInteractOutside={(e) => e.preventDefault()}>
        <SheetHeader>
          <SheetTitle>Brand</SheetTitle>
          <SheetDescription>Logo, footer, numbers and fonts on every slide. Stored in the deck's theme, so they travel with the code.</SheetDescription>
        </SheetHeader>
        <FieldGroup className="px-4 pb-6">
          <Field>
            <FieldLabel>Logo</FieldLabel>
            {logo ? (
              <div className="flex items-center gap-3">
                <div className="flex h-16 flex-1 items-center justify-center rounded-md border bg-muted/40 p-2">
                  {resolveSrc(logo.src) ? <img src={resolveSrc(logo.src)} alt="Logo" className="max-h-full max-w-full object-contain" /> : <span className="text-xs text-muted-foreground">Missing {logo.src}</span>}
                </div>
                <Button size="sm" variant="outline" onClick={pickLogo}>Replace</Button>
                <Button size="icon-sm" variant="ghost" aria-label="Remove logo" onClick={() => writeLogo(null)}><XIcon /></Button>
              </div>
            ) : (
              <Button variant="outline" onClick={pickLogo}><ImageUpIcon /> Upload logo…</Button>
            )}
            {logoInput}
          </Field>
          {logo && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <FieldLabel>Position</FieldLabel>
                  <Select value={logo.position} onValueChange={(position) => writeLogo({ ...logo, position: position as Corner })}>
                    <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
                    <SelectContent>{CORNERS.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="logo-height">Height</FieldLabel>
                  <Input id="logo-height" type="number" min={16} max={240} step={4} className="h-8" key={logo.height} defaultValue={logo.height}
                    onBlur={(e) => { const h = Math.round(+e.target.value); if (h && h !== logo.height) writeLogo({ ...logo, height: Math.max(16, Math.min(240, h)) }) }}
                    onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur() }} />
                </Field>
              </div>
              <Field>
                <FieldLabel>Logo on dark slides</FieldLabel>
                <div className="flex items-center gap-2">
                  {logo.inverse ? (
                    <>
                      <div className="flex h-10 flex-1 items-center justify-center rounded-md border bg-neutral-900 p-1.5"><img src={resolveSrc(logo.inverse)} alt="Logo for dark slides" className="max-h-full max-w-full object-contain" /></div>
                      <Button size="icon-sm" variant="ghost" aria-label="Remove dark logo" onClick={() => writeLogo({ ...logo, inverse: undefined })}><XIcon /></Button>
                    </>
                  ) : <Button size="sm" variant="outline" onClick={pickInverse}><ImageUpIcon /> Upload…</Button>}
                </div>
                <FieldDescription>Optional. Used on inverse and accent slides.</FieldDescription>
                {inverseInput}
              </Field>
            </>
          )}

          <FieldSeparator />
          <Field>
            <FieldLabel htmlFor="footer">Footer</FieldLabel>
            <Input id="footer" value={footer} placeholder="Acme Corp · Confidential" onChange={(e) => setFooter(e.target.value)} onBlur={commitFooter} onKeyDown={(e) => { if (e.key === "Enter") commitFooter() }} />
            <FieldDescription>{"{n}"}, {"{total}"} and {"{title}"} are replaced on each slide.</FieldDescription>
          </Field>
          <Field orientation="horizontal">
            <FieldLabel htmlFor="numbers" className="flex-1">Slide numbers</FieldLabel>
            <Switch id="numbers" checked={!!theme?.slideNumbers} onCheckedChange={(on) => setBrand({ slideNumbers: on || undefined })} />
          </Field>

          <FieldSeparator />
          {(["heading", "body"] as const).map((key) => {
            const uploaded = typeof fontsRaw[key] === "string" && (fontsRaw[key] as string).startsWith("assets/")
            return (
              <Field key={key}>
                <FieldLabel>{key === "heading" ? "Heading font" : "Body font"}</FieldLabel>
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1 truncate rounded-md border px-3 py-1.5 text-lg" style={{ fontFamily: theme?.fonts[key] }}>
                    {theme ? firstFamily(theme.fonts[key]) : ""}
                  </div>
                  <Button size="sm" variant="outline" onClick={key === "heading" ? pickHeading : pickBody}><TypeIcon /> Upload…</Button>
                  {fontsRaw[key] != null && <Button size="icon-sm" variant="ghost" aria-label={`Reset ${key} font`} onClick={() => setFont(key, undefined)}><XIcon /></Button>}
                </div>
                {uploaded && <FieldDescription>{String(fontsRaw[key])}</FieldDescription>}
              </Field>
            )
          })}
          <FieldDescription>.woff2, .woff, .ttf or .otf. Fonts are stored with the deck and saved to assets/ with it. PowerPoint uses the font by name, so it must be installed where the file is opened.</FieldDescription>
          {headingInput}{bodyInput}

          <FieldSeparator />
          <div className="text-sm text-muted-foreground">
            {masters || layouts.length ? (
              <p>This theme also has {[masters && `${masters} master element${masters > 1 ? "s" : ""}`, layouts.length && `layouts: ${layouts.join(", ")}`].filter(Boolean).join(" and ")}. Edit them in the code (theme.master, theme.layouts), or ask the AI.</p>
            ) : (
              <p>Master elements (shapes or images on every slide) and company layouts live in the code: theme.master and theme.layouts. Ask the AI to set them up from your template.</p>
            )}
            <p className="mt-2">Hide everything on one slide with <code className="rounded bg-muted px-1">{"<Slide master={false}>"}</code>.</p>
          </div>
        </FieldGroup>
      </SheetContent>
    </Sheet>
  )
}
