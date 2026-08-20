"use client";

import type { ErrorInfo, ReactNode } from "react";
import { Component } from "react";

type ClientErrorBoundaryProps = {
  children: ReactNode;
  fallback?: ReactNode;
  label: string;
};

type ClientErrorBoundaryState = {
  failed: boolean;
};

export class ClientErrorBoundary extends Component<
  ClientErrorBoundaryProps,
  ClientErrorBoundaryState
> {
  state: ClientErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ClientErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      `[Lendora] ${this.props.label} failed without interrupting the page.`,
      error,
      info,
    );
  }

  render() {
    if (this.state.failed) {
      return this.props.fallback ?? null;
    }
    return this.props.children;
  }
}

