import { Component, type ReactNode } from "react"
import { Button } from "@alexandernygard/components"

/** Keeps a rendering bug from blanking the whole editor. The deck itself is already saved. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="grid h-full place-items-center p-8">
        <div className="flex max-w-lg flex-col gap-3">
          <h1 className="font-heading text-xl font-semibold">Something broke while drawing the editor</h1>
          <p className="text-sm text-muted-foreground">Your deck is saved. Reloading usually fixes it.</p>
          <pre className="overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">{this.state.error.message}</pre>
          <div className="flex gap-2">
            <Button onClick={() => location.reload()}>Reload</Button>
            <Button variant="outline" onClick={() => this.setState({ error: null })}>Try again</Button>
          </div>
        </div>
      </div>
    )
  }
}
