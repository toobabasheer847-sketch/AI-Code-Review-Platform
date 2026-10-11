import { QueryClientProvider } from '@tanstack/react-query'
import { ReactNode } from 'react'
import { BrowserRouter as Router } from 'react-router-dom'
import { Toaster } from 'sonner'

import { ErrorBoundary } from '@components/common/ErrorBoundary'
import { queryClient } from '@lib/queryClient'

interface ProvidersProps {
  children: ReactNode
}

export const Providers = ({ children }: ProvidersProps): JSX.Element => {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <Router>
          {children}
          <Toaster position="top-right" />
        </Router>
      </QueryClientProvider>
    </ErrorBoundary>
  )
}
