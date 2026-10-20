import { useMemo, useState } from "react"
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@alexandernygard/components"
import { ICON_NAMES, iconFor } from "@ppt2/react"

const LIMIT = 120

/** Search Lucide's icons by name. */
export function IconPicker({ open, onOpenChange, onPick }: { open: boolean; onOpenChange: (o: boolean) => void; onPick: (name: string) => void }) {
  const [q, setQ] = useState("")
  const matches = useMemo(() => {
    const t = q.trim().toLowerCase().replace(/\s+/g, "-")
    const hits = t ? ICON_NAMES.filter((n) => n.includes(t)).sort((a, b) => Number(!a.startsWith(t)) - Number(!b.startsWith(t)) || a.length - b.length) : ICON_NAMES
    return hits.slice(0, LIMIT)
  }, [q])
  return (
    <CommandDialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setQ("") }} title="Insert icon" description="Search icons by name" className="sm:max-w-2xl">
      <Command shouldFilter={false}>
      <CommandInput value={q} onValueChange={setQ} placeholder="Search icons: rocket, chart, shield…" />
      <CommandList className="max-h-[420px]">
        <CommandEmpty>No icon matches “{q}”.</CommandEmpty>
        <CommandGroup heading={q ? matches.length === LIMIT ? `First ${LIMIT} matches` : `${matches.length} match${matches.length === 1 ? "" : "es"}` : "All icons"}>
          <div className="grid grid-cols-6 gap-1 sm:grid-cols-8">
            {matches.map((name) => {
              const Icon = iconFor(name)!
              return (
                <CommandItem key={name} value={name} onSelect={() => { onPick(name); onOpenChange(false); setQ("") }} className="flex aspect-square flex-col items-center justify-center gap-1 p-1 text-center" title={name}>
                  <Icon className="size-6!" />
                  <span className="line-clamp-1 w-full text-[10px] text-muted-foreground">{name}</span>
                </CommandItem>
              )
            })}
          </div>
        </CommandGroup>
      </CommandList>
      </Command>
    </CommandDialog>
  )
}
