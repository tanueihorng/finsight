import { Component, type ReactNode } from 'react';
import { ErrorLine } from './ErrorLine.tsx';
// React error boundaries require a class; all panel components remain functions.
export class IslandBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  render() { return this.state.error ? <ErrorLine>This panel could not load. Reload to try again.</ErrorLine> : this.props.children; }
}
