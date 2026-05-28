import './assets/theme.css'

import { StrictMode, Component, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './i18n'

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('[ErrorBoundary] Caught error:', error, info)
  }

  render() {
    if (this.state.error) {
      const msg = (this.state.error as Error).message
      const stack = (this.state.error as Error).stack
      return (
        <div
          style={{
            padding: 24,
            fontFamily: 'monospace',
            color: '#f87171',
            background: '#1e1e2e',
            minHeight: '100vh'
          }}
        >
          <h2 style={{ color: '#fb923c', marginBottom: 12 }}>⚠️ App Crashed</h2>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              background: '#2a2a3e',
              padding: 16,
              borderRadius: 8
            }}
          >
            {msg}
            {'\n\n'}
            {stack}
          </pre>
        </div>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
)
