/* eslint-disable react/prop-types */
import { Component } from 'react'

/**
 * Last line of defence for a routed surface.
 *
 * An uncaught error thrown while React renders a subtree makes React unmount
 * that whole subtree — for the messaging flow that wiped the message thread and
 * the composer at once, leaving a dead page. Layout fixes remove the cause; this
 * boundary removes the blast radius: the app shell (header, sidebar, bottom
 * navigation) stays mounted and the user gets a recovery path instead of a
 * blank screen.
 *
 * Navigating to another route clears the fallback via `resetKey`, so a broken
 * screen can never trap the user.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', this.props.label || 'surface', error, info?.componentStack)
  }

  componentDidUpdate(previousProps) {
    if (this.state.error && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  handleRetry = () => this.setState({ error: null })

  render() {
    const { error } = this.state
    if (!error) return this.props.children || null

    return (
      <div role="alert" className="flex-1 min-h-0 overflow-y-auto chat-page-x flex items-center justify-center py-8">
        <div className="w-full max-w-sm space-y-3 rounded-xl border border-border bg-card p-6 text-center chat-enter">
          <p className="text-sm font-semibold text-foreground">This screen hit a problem</p>
          <p className="break-words text-xs text-muted-foreground">
            {error?.message || 'An unexpected error occurred.'}
          </p>
          <button
            type="button"
            onClick={this.handleRetry}
            className="chat-button h-10 w-full bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            Try again
          </button>
        </div>
      </div>
    )
  }
}
