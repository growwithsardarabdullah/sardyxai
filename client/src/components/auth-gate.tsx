import { useEffect, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, UNAUTHORIZED_EVENT } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface AuthStatus {
  needsSetup: boolean
  authenticated: boolean
  email: string | null
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  )
}

type AuthMode = 'login' | 'register' | 'forgot-password' | 'reset-password'

function AuthForm({ mode: initialMode, onAuthed }: { mode: 'setup' | 'login'; onAuthed: () => void }) {
  const [mode, setMode] = useState<AuthMode>(initialMode === 'setup' ? 'register' : 'login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [resetToken, setResetToken] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setSuccess('')

    try {
      if (mode === 'register') {
        if (password !== confirmPassword) {
          setError('Passwords do not match')
          setBusy(false)
          return
        }
        await apiFetch('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        })
        onAuthed()
      } else if (mode === 'login') {
        await apiFetch('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        })
        onAuthed()
      } else if (mode === 'forgot-password') {
        const res = await apiFetch<{ success: boolean; message: string; resetToken?: string }>('/api/auth/forgot-password', {
          method: 'POST',
          body: JSON.stringify({ email }),
        })
        if (res.resetToken) {
          setResetToken(res.resetToken)
          setMode('reset-password')
          setSuccess('Reset token generated. Enter your new password below.')
        } else {
          setSuccess(res.message || 'If an account exists, a reset link has been generated.')
        }
      } else if (mode === 'reset-password') {
        if (newPassword !== confirmPassword) {
          setError('Passwords do not match')
          setBusy(false)
          return
        }
        await apiFetch('/api/auth/reset-password', {
          method: 'POST',
          body: JSON.stringify({ token: resetToken, password: newPassword }),
        })
        setSuccess('Password reset successfully! Signing you in...')
        // Auto-login after password reset
        await apiFetch('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password: newPassword }),
        })
        onAuthed()
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const isRegister = mode === 'register'
  const isLogin = mode === 'login'
  const isForgot = mode === 'forgot-password'
  const isReset = mode === 'reset-password'

  return (
    <Centered>
      <div className="mb-6 flex items-center gap-2">
        <span className="inline-block size-2 rounded-full bg-foreground" />
        <span className="font-semibold tracking-tight text-sm">FreeLLMAPI</span>
      </div>
      <div className="rounded-lg border bg-card p-6">
        <h1 className="text-base font-medium">
          {isRegister && 'Create your account'}
          {isLogin && 'Sign in'}
          {isForgot && 'Reset your password'}
          {isReset && 'Set new password'}
        </h1>
        <p className="text-xs text-muted-foreground mt-1 mb-4">
          {isRegister && 'Sign up to get started with FreeLLMAPI.'}
          {isLogin && 'Sign in to manage your keys, routing, and analytics.'}
          {isForgot && 'Enter your email to receive a password reset link.'}
          {isReset && 'Enter your new password below.'}
        </p>

        <form onSubmit={submit} className="space-y-3">
          {/* Email field - shown in register, login, forgot-password modes */}
          {(isRegister || isLogin || isForgot) && (
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="auth-email">Email</Label>
              <Input
                id="auth-email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>
          )}

          {/* Password field - shown in register, login modes */}
          {(isRegister || isLogin) && (
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="auth-password">Password</Label>
              <Input
                id="auth-password"
                type="password"
                autoComplete={isRegister ? 'new-password' : 'current-password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={isRegister ? 'at least 8 characters' : 'your password'}
                required
              />
            </div>
          )}

          {/* Confirm password - shown in register and reset-password modes */}
          {(isRegister || isReset) && (
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="auth-confirm-password">Confirm password</Label>
              <Input
                id="auth-confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="repeat your password"
                required
              />
            </div>
          )}

          {/* New password - shown in reset-password mode */}
          {isReset && (
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="auth-new-password">New password</Label>
              <Input
                id="auth-new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="at least 8 characters"
                required
              />
            </div>
          )}

          {error && <p className="text-destructive text-xs">{error}</p>}
          {success && <p className="text-emerald-600 text-xs">{success}</p>}

          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? 'Please wait…' : isRegister ? 'Create account' : isLogin ? 'Sign in' : isForgot ? 'Send reset link' : 'Reset password'}
          </Button>
        </form>

        {/* Mode switching links */}
        <div className="mt-4 text-center text-xs text-muted-foreground space-y-1">
          {isLogin && (
            <>
              <p>
                Don&apos;t have an account?{' '}
                <button type="button" className="text-foreground underline underline-offset-2 hover:no-underline" onClick={() => { setMode('register'); setError(''); setSuccess(''); }}>
                  Sign up
                </button>
              </p>
              <p>
                <button type="button" className="text-foreground underline underline-offset-2 hover:no-underline" onClick={() => { setMode('forgot-password'); setError(''); setSuccess(''); }}>
                  Forgot password?
                </button>
              </p>
            </>
          )}
          {isRegister && (
            <p>
              Already have an account?{' '}
              <button type="button" className="text-foreground underline underline-offset-2 hover:no-underline" onClick={() => { setMode('login'); setError(''); setSuccess(''); }}>
                Sign in
              </button>
            </p>
          )}
          {(isForgot || isReset) && (
            <p>
              <button type="button" className="text-foreground underline underline-offset-2 hover:no-underline" onClick={() => { setMode('login'); setError(''); setSuccess(''); }}>
                Back to sign in
              </button>
            </p>
          )}
        </div>
      </div>
    </Centered>
  )
}

export function AuthGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const { data, isLoading, isError, refetch } = useQuery<AuthStatus>({
    queryKey: ['auth-status'],
    queryFn: () => apiFetch('/api/auth/status'),
    retry: false,
    staleTime: 0,
  })

  useEffect(() => {
    const handler = () => { refetch() }
    window.addEventListener(UNAUTHORIZED_EVENT, handler)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handler)
  }, [refetch])

  function onAuthed() {
    queryClient.invalidateQueries()
    refetch()
  }

  if (isLoading) return <Centered><p className="text-sm text-muted-foreground text-center">Loading…</p></Centered>
  if (isError || !data) {
    return (
      <Centered>
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
          Can&apos;t reach the server. Make sure the backend is running (<code className="font-mono">npm run dev</code>).
        </div>
      </Centered>
    )
  }

  if (data.needsSetup) return <AuthForm mode="setup" onAuthed={onAuthed} />
  if (!data.authenticated) return <AuthForm mode="login" onAuthed={onAuthed} />

  return <>{children}</>
}
