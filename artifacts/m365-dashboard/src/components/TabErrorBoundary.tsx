import { Component, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

interface Props { children: ReactNode }
interface State { error: Error | null }

export class TabErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center text-muted-foreground">
          <AlertTriangle className="w-8 h-8 text-destructive" />
          <p className="font-semibold text-destructive">Failed to load this tab</p>
          <p className="text-sm max-w-sm">{this.state.error.message}</p>
          <button
            className="text-sm underline underline-offset-4 hover:text-foreground"
            onClick={() => this.setState({ error: null })}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
