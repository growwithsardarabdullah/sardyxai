import React, { type ReactNode, type ErrorInfo } from 'react'
import { Button } from '@/components/ui/button'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, errorInfo)
    this.setState((state) => ({ ...state, errorInfo }))
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-background flex items-center justify-center p-4">
          <div className="w-full max-w-md space-y-4">
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4">
              <h1 className="text-lg font-semibold text-destructive mb-2">Application Error</h1>
              <p className="text-sm text-destructive/90 mb-4">
                {this.state.error?.message || 'An unexpected error occurred'}
              </p>
              {process.env.NODE_ENV === 'development' && this.state.errorInfo && (
                <details className="text-xs text-destructive/80 whitespace-pre-wrap overflow-auto max-h-64 font-mono">
                  <summary className="cursor-pointer font-semibold mb-2">Error Details</summary>
                  <code>{this.state.errorInfo.componentStack}</code>
                </details>
              )}
            </div>
            <div className="flex gap-2">
              <Button 
                onClick={() => window.location.reload()} 
                className="flex-1"
              >
                Reload Page
              </Button>
              <Button 
                variant="outline"
                onClick={() => window.location.href = '/'}
                className="flex-1"
              >
                Go Home
              </Button>
            </div>
            <p className="text-xs text-muted-foreground text-center">
              Check the browser console for more details.
            </p>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
