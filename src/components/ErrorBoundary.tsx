import { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  label?: string;
}

interface State {
  hasError: boolean;
  message: string;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="rounded-xl p-6 text-center"
          style={{ background: '#fff', border: '1.5px solid #fca5a5' }}
        >
          <div className="text-2xl mb-2">⚠️</div>
          <div className="font-bold text-sm mb-1" style={{ color: '#252F3E' }}>
            {this.props.label || 'Component'} failed to render
          </div>
          <div className="text-xs text-gray-400">{this.state.message}</div>
          <button
            className="mt-3 text-xs font-semibold px-3 py-1.5 rounded-lg"
            style={{ background: 'rgba(68,114,232,0.1)', color: '#4472E8' }}
            onClick={() => this.setState({ hasError: false, message: '' })}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
