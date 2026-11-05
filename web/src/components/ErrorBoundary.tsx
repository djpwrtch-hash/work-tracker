import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { isProduction } from '../lib/env';

interface ErrorInfo {
  componentStack: string;
  digest?: string;
}

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ errorInfo: errorInfo as unknown as ErrorInfo });

    if (!isProduction()) {
      console.error('[ErrorBoundary]', error, errorInfo);
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center p-8">
          <div className="text-center max-w-lg">
            <div className="flex justify-center mb-6">
              <div className="h-16 w-16 rounded-2xl bg-rose-500/15 flex items-center justify-center">
                <AlertTriangle className="h-8 w-8 text-rose-400" />
              </div>
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">Something Went Wrong</h1>
            <p className="text-slate-400 mb-6">
              An unexpected error occurred. The error has been logged for investigation.
            </p>

            {!isProduction() && this.state.error && (
              <details className="mb-6 text-left">
                <summary className="cursor-pointer text-sm text-slate-500 hover:text-slate-300 transition mb-2">
                  Error Details (Development)
                </summary>
                <div className="p-4 bg-slate-900 border border-slate-700 rounded-xl text-xs font-mono text-rose-300 overflow-auto max-h-48">
                  <p className="font-bold mb-1">{this.state.error.name}: {this.state.error.message}</p>
                  {this.state.error.stack && (
                    <pre className="whitespace-pre-wrap text-slate-500">{this.state.error.stack}</pre>
                  )}
                  {this.state.errorInfo?.componentStack && (
                    <pre className="whitespace-pre-wrap text-slate-500 mt-2">{this.state.errorInfo.componentStack}</pre>
                  )}
                </div>
              </details>
            )}

            <div className="flex items-center justify-center gap-4">
              <button onClick={this.handleReset}
                className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-violet-600 hover:bg-violet-500 rounded-xl transition">
                <RefreshCw className="h-4 w-4" />Try Again
              </button>
              <button onClick={() => window.location.reload()}
                className="px-5 py-2.5 text-sm font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded-xl transition">
                Reload Page
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
