import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export const EmptyState = ({ icon: Icon, title, description, action }) => {
    return (_jsxs("div", { className: "flex flex-col items-center justify-center py-12 text-center", children: [Icon && _jsx(Icon, { className: "h-12 w-12 text-muted-foreground mb-4" }), _jsx("h3", { className: "text-lg font-semibold text-foreground mb-2", children: title }), description && _jsx("p", { className: "text-sm text-muted-foreground mb-4", children: description }), action && (_jsx("button", { onClick: action.onClick, className: "px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90 transition-opacity text-sm", children: action.label }))] }));
};
