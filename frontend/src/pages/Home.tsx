export const Home = (): JSX.Element => {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <h1 className="text-4xl font-bold tracking-tight text-foreground mb-4">
          Welcome to AI-CodeGuard
        </h1>
        <p className="text-lg text-muted-foreground mb-8">
          Production-ready SaaS Code Review Platform with AI
        </p>
        <div className="flex gap-4 justify-center">
          <a
            href="/login"
            className="px-6 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity"
          >
            Login
          </a>
          <a
            href="/register"
            className="px-6 py-2 bg-secondary text-secondary-foreground rounded-lg hover:opacity-90 transition-opacity"
          >
            Register
          </a>
        </div>
      </div>
    </div>
  )
}
