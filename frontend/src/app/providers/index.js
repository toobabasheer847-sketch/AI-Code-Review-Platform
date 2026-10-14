import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter as Router } from 'react-router-dom';
import { Toaster } from 'sonner';
import { ErrorBoundary } from '@components/common/ErrorBoundary';
import { queryClient } from '@lib/queryClient';
export const Providers = ({ children }) => {
    return (_jsx(ErrorBoundary, { children: _jsx(QueryClientProvider, { client: queryClient, children: _jsxs(Router, { children: [children, _jsx(Toaster, { position: "top-right" })] }) }) }));
};
