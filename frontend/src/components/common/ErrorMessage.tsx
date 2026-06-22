interface ErrorMessageProps {
  message: string
  onDismiss?: () => void
}

export const ErrorMessage = ({ message, onDismiss }: ErrorMessageProps): JSX.Element => {
  return (
    <div className="bg-destructive/10 border border-destructive rounded-lg p-4 flex items-start justify-between">
      <div className="flex-1">
        <p className="text-sm font-medium text-destructive">{message}</p>
      </div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="ml-4 text-destructive hover:opacity-75 transition-opacity"
          aria-label="Dismiss"
        >
          ✕
        </button>
      )}
    </div>
  )
}
