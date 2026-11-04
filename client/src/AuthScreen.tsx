import { useState, type FormEvent } from 'react'
import type { Session } from './types'

type Mode = 'login' | 'register' | 'guest'

interface AuthScreenProps {
  hasUsers: boolean
  onLogin: (username: string, password: string) => Promise<Session>
  onRegister: (username: string, password: string, displayName: string, inviteCode: string) => Promise<Session>
  onGuest: (displayName: string, inviteCode: string) => Promise<Session>
}

export function AuthScreen({ hasUsers, onLogin, onRegister, onGuest }: AuthScreenProps) {
  const [mode, setMode] = useState<Mode>(hasUsers ? 'login' : 'register')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (mode === 'login') await onLogin(username, password)
      else if (mode === 'register') await onRegister(username, password, displayName, inviteCode)
      else await onGuest(displayName, inviteCode)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Sign-in failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <h1>Dungeon Theatre</h1>
        <p className="auth-intro">
          {hasUsers ? 'Enter the campaign hall.' : 'Create the first account to become the game master.'}
        </p>
        {hasUsers && (
          <div className="auth-tabs" role="tablist" aria-label="Sign-in method">
            <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>
              Sign in
            </button>
            <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>
              Create account
            </button>
            <button type="button" className={mode === 'guest' ? 'active' : ''} onClick={() => setMode('guest')}>
              Join as guest
            </button>
          </div>
        )}
        <form onSubmit={(e) => void submit(e)}>
          {mode !== 'guest' ? (
            <>
              {mode === 'register' && (
                <>
                  <label>
                    Display name
                    <input
                      autoComplete="nickname"
                      maxLength={40}
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                    />
                  </label>
                  <label>
                    Username
                    <input
                      required
                      autoComplete="username"
                      minLength={3}
                      maxLength={32}
                      pattern="[A-Za-z0-9_.-]{3,32}"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                    />
                  </label>
                  <p className="hint">Use 3–32 letters, numbers, dots, underscores or hyphens—not an email address.</p>
                </>
              )}
              {mode === 'login' && (
                <label>
                  Username
                  <input
                    required
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </label>
              )}
              <label>
                Password
                <input
                  required
                  type="password"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  minLength={mode === 'register' ? 8 : undefined}
                  maxLength={128}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              {mode === 'register' && hasUsers && (
                <label>
                  Invite code
                  <input
                    required
                    autoComplete="off"
                    maxLength={8}
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value)}
                  />
                  <span className="hint">Use the GM’s current 8-character invite code.</span>
                </label>
              )}
            </>
          ) : (
            <>
              <label>
                Display name
                <input
                  required
                  autoComplete="nickname"
                  maxLength={40}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </label>
              <label>
                Invite code
                <input
                  required
                  autoComplete="off"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                />
              </label>
            </>
          )}
          {error && <p className="error" role="alert">{error}</p>}
          <button className="auth-submit" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : mode === 'register' ? 'Create account' : 'Join game'}
          </button>
        </form>
      </section>
    </main>
  )
}
