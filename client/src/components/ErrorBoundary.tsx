import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props { children: ReactNode }
interface State { error: Error | null }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[page error]', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto max-w-2xl p-8">
        <div className="panel border-rose-500/20 p-8 text-center">
          <AlertTriangle className="mx-auto h-10 w-10 text-rose-400" />
          <h1 className="mt-4 text-xl font-semibold text-white">This page could not be rendered</h1>
          <p className="mt-2 text-sm text-slate-500">{this.state.error.message}</p>
          <button onClick={() => { this.setState({ error: null }); window.location.reload(); }} className="mt-6 inline-flex items-center gap-2 rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-semibold text-white">
            <RotateCcw className="h-4 w-4" /> Reload page
          </button>
        </div>
      </div>
    );
  }
}
