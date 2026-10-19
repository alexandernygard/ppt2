import { useState, useEffect } from "react"
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@alexandernygard/components"
import { MODELS, useSettings, type Effort } from "../ai/settings"

export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const s = useSettings()
  const [key, setKey] = useState(s.apiKey)
  useEffect(() => { if (open) setKey(s.apiKey) }, [open])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>AI settings</DialogTitle>
          <DialogDescription>ppt2 calls the Claude API straight from your browser. There is no server; the key is stored in this browser's local storage only.</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="key">Anthropic API key</FieldLabel>
            <Input id="key" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-…" />
            <FieldDescription>Create one at console.anthropic.com. Anyone with access to this browser profile can read it.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel>Model</FieldLabel>
            <Select value={s.model} onValueChange={(model) => s.set({ model })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{MODELS.map((m) => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel>Effort</FieldLabel>
            <Select value={s.effort} onValueChange={(effort) => s.set({ effort: effort as Effort })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low — fastest, small edits</SelectItem>
                <SelectItem value="medium">Medium — balanced</SelectItem>
                <SelectItem value="high">High — best for whole decks</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => { s.set({ apiKey: key.trim() }); onOpenChange(false) }}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
