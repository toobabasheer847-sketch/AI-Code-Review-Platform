import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React from 'react';
export class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        Object.defineProperty(this, "handleReset", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: () => {
                this.setState({ hasError: false, error: null });
            }
        });
        this.state = { hasError: false, error: null };
    }
    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }
    componentDidCatch(error, errorInfo) {
        console.error('ErrorBoundary caught an error:', error, errorInfo);
    }
    render() {
        if (this.state.hasError && this.state.error) {
            return (this.props.fallback?.(this.state.error, this.handleReset) ?? (_jsx("div", { className: "flex items-center justify-center min-h-screen", children: _jsxs("div", { className: "bg-destructive/10 border border-destructive rounded-lg p-6 max-w-md", children: [_jsx("h2", { className: "text-xl font-semibold text-destructive mb-2", children: "Something went wrong" }), _jsx("p", { className: "text-sm text-muted-foreground mb-4", children: this.state.error.message || 'An unexpected error occurred' }), _jsx("button", { onClick: this.handleReset, className: "px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90 transition-opacity", children: "Try again" })] }) })));
        }
        return this.props.children;
    }
}
