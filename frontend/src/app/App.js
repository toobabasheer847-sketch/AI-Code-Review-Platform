import { jsx as _jsx } from "react/jsx-runtime";
import './App.css';
import { useRoutes } from 'react-router-dom';
import { routes } from './router/routes';
function App() {
    const routeElements = useRoutes(routes);
    return (_jsx("div", { className: "min-h-screen bg-slate-950", children: routeElements }));
}
export default App;
