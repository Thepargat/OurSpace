import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', height: '100vh', padding: '24px',
          background: '#fcf9f4', color: '#1A1A1A', textAlign: 'center',
          fontFamily: 'system-ui, sans-serif'
        }}>
          <h1 style={{ fontSize: '24px', marginBottom: '16px' }}>Oops, something broke.</h1>
          <p style={{ color: '#6B6560', marginBottom: '24px' }}>
            We've encountered an unexpected error. Refreshing the page usually fixes this.
          </p>
          <pre style={{
            background: 'rgba(0,0,0,0.05)', padding: '16px', borderRadius: '8px',
            fontSize: '12px', whiteSpace: 'pre-wrap', textAlign: 'left',
            maxWidth: '100%', overflowX: 'auto', marginBottom: '24px'
          }}>
            {this.state.error?.message || 'Unknown error'}
          </pre>
          <button 
            onClick={() => window.location.reload()}
            style={{
              background: '#1A1A1A', color: 'white', border: 'none',
              padding: '12px 24px', borderRadius: '8px', cursor: 'pointer',
              fontWeight: 600
            }}
          >
            Refresh Page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
