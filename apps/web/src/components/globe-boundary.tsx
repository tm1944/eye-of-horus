"use client";
import { Component, type ReactNode } from "react";
export default class GlobeBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <div className="globe-fallback" role="alert"><h2>The globe could not start.</h2><p>Enable WebGL in your browser and reload to explore Earth.</p></div>;
    return this.props.children;
  }
}
