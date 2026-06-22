import './App.css'
import { useRoutes } from 'react-router-dom'
import { routes } from './router/routes'

function App(): JSX.Element | null {
  const routeElements = useRoutes(routes)

  return (
    <div className="min-h-screen bg-slate-950">
      {routeElements}
    </div>
  )
}

export default App
