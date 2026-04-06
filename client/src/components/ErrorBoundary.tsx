import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  name: string;
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary:${this.props.name}] Render crash:`, error);
    console.error(`[ErrorBoundary:${this.props.name}] Component stack:`, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full p-4 bg-dark-800 rounded-lg border border-red-900/40">
          <div className="text-red-400 text-sm font-medium mb-2">
            {this.props.name} crashed
          </div>
          <div className="text-xs text-gray-500 max-w-md text-center mb-3 font-mono break-all">
            {this.state.error?.message}
          </div>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="px-3 py-1 text-xs bg-dark-700 border border-gray-600 rounded text-gray-300 hover:text-white hover:border-gray-500 transition-colors"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
