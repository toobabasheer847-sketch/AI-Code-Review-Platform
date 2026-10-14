import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Github, Loader2 } from 'lucide-react';
import { useConnectGitHub } from '../hooks/useGitHub';
export const ConnectGitHubButton = ({ className = '' }) => {
    const { mutate: connectGitHub, isPending, error } = useConnectGitHub();
    return (_jsxs("div", { className: className, children: [_jsxs("button", { type: "button", onClick: () => connectGitHub(), disabled: isPending, className: "inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60", children: [isPending ? _jsx(Loader2, { className: "h-4 w-4 animate-spin" }) : _jsx(Github, { className: "h-4 w-4" }), isPending ? 'Connecting...' : 'Connect GitHub'] }), error && (_jsx("p", { className: "mt-2 text-sm text-destructive", children: error instanceof Error ? error.message : 'Unable to start GitHub connection' }))] }));
};
