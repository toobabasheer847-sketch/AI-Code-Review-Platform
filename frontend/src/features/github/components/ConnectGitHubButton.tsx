import { Github, Loader2 } from 'lucide-react'
import { useConnectGitHub } from '../hooks/useGitHub'

interface ConnectGitHubButtonProps {
  className?: string
}

export const ConnectGitHubButton = ({ className = '' }: ConnectGitHubButtonProps): JSX.Element => {
  const { mutate: connectGitHub, isPending, error } = useConnectGitHub()

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => connectGitHub()}
        disabled={isPending}
        className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Github className="h-4 w-4" />}
        {isPending ? 'Connecting...' : 'Connect GitHub'}
      </button>
      {error && (
        <p className="mt-2 text-sm text-destructive">
          {error instanceof Error ? error.message : 'Unable to start GitHub connection'}
        </p>
      )}
    </div>
  )
}
