import Header from './Header'
import AuthBottomNav from './AuthBottomNav'

export default function AuthShell({ children, title, subtitle, compact = false }) {
  return (
    <div className="min-h-screen bg-background text-foreground pb-24 md:pb-0">
      <Header />
      <main className={`mx-auto flex flex-col px-5 py-12 sm:px-8 sm:py-16 ${compact ? 'max-w-lg' : 'max-w-5xl'} chat-enter`}>
        {(title || subtitle) && (
          <div className="mb-6 max-w-2xl">
            {title && <h2 className="text-3xl font-semibold sm:text-4xl">{title}</h2>}
            {subtitle && <p className="mt-3 text-base leading-7 text-muted-foreground">{subtitle}</p>}
          </div>
        )}
        <div>
          {children}
        </div>
      </main>
      <AuthBottomNav />
    </div>
  )
}
