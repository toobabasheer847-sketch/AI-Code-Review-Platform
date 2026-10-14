import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useNavigate } from 'react-router-dom';
export const NotFound = () => {
    const navigate = useNavigate();
    return (_jsx("div", { className: "flex items-center justify-center min-h-screen", children: _jsxs("div", { className: "text-center", children: [_jsx("h1", { className: "text-6xl font-bold text-primary mb-4", children: "404" }), _jsx("p", { className: "text-xl text-muted-foreground mb-8", children: "Page not found" }), _jsx("button", { onClick: () => navigate('/'), className: "px-6 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity", children: "Back to Home" })] }) }));
};
