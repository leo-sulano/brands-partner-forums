import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled UI error', error, info.componentStack);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="h-screen flex items-center justify-center bg-slate-50 text-slate-900 p-6">
        <div className="max-w-sm text-center space-y-4">
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <p className="text-sm text-slate-600">
            The dashboard hit an unexpected error. Reloading usually fixes it.
          </p>
          <button
            onClick={this.handleReload}
            className="rounded-md bg-slate-800 px-4 py-2 text-sm text-white hover:bg-slate-700"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
