import { Component, type ReactNode } from "react";

interface Props { children: ReactNode; }
interface State { error: Error | null; }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="center-screen">
          <div className="card stack" style={{ maxWidth: 420, textAlign: "center" }}>
            <strong>Algo quebrou nesta tela</strong>
            <div className="muted" style={{ fontSize: 13 }}>{this.state.error.message}</div>
            <button className="primary" onClick={() => this.setState({ error: null })}>Tentar de novo</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
