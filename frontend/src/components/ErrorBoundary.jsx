import React from 'react';

export default class ErrorBoundary extends React.Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Uncaught application error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="screen-shell flex items-center justify-center">
          <section className="panel-card w-full max-w-md p-6 text-center">
            <p className="eyebrow mb-2">DEBT-SETTLE</p>
            <h1 className="text-2xl font-black text-ink-900">Something went wrong</h1>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="primary-btn mt-5 w-full"
            >
              Reload
            </button>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}
