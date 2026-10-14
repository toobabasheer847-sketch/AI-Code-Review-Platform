import { jsx as _jsx } from "react/jsx-runtime";
export const LoadingSpinner = ({ size = 'md', fullScreen = false }) => {
    const sizeClasses = {
        sm: 'h-4 w-4',
        md: 'h-8 w-8',
        lg: 'h-12 w-12',
    };
    const spinner = (_jsx("div", { className: `${sizeClasses[size]} animate-spin`, children: _jsx("div", { className: "h-full w-full border-4 border-muted rounded-full border-t-primary" }) }));
    if (fullScreen) {
        return (_jsx("div", { className: "flex items-center justify-center min-h-screen", children: spinner }));
    }
    return _jsx("div", { className: "flex items-center justify-center p-4", children: spinner });
};
