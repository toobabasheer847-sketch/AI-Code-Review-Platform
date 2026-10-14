import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export const ErrorMessage = ({ message, onDismiss }) => {
    return (_jsxs("div", { className: "bg-destructive/10 border border-destructive rounded-lg p-4 flex items-start justify-between", children: [_jsx("div", { className: "flex-1", children: _jsx("p", { className: "text-sm font-medium text-destructive", children: message }) }), onDismiss && (_jsx("button", { onClick: onDismiss, className: "ml-4 text-destructive hover:opacity-75 transition-opacity", "aria-label": "Dismiss", children: "\u2715" }))] }));
};
