import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import * as api from "../services/api"

type Registration = { username: string; email: string; password: string; role: "CLIENT" | "PROVIDER" }
type AuthContextValue = {
  user: api.AuthUser | null
  token: string | null
  isAuthenticated: boolean
  isLoading: boolean
  restoreError: boolean
  retryRestore: () => void
  login: (email: string, password: string) => Promise<api.AuthUser>
  register: (data: Registration) => Promise<api.AuthUser>
  logout: () => void
  refreshUser: () => Promise<api.AuthUser | null>
}

const AuthContext = createContext<AuthContextValue | null>(null)
const sessionKey = `secureescrow.session:${api.API_BASE_URL}`

function readSession() {
  try { return window.sessionStorage.getItem(sessionKey) }
  catch { return null }
}

function saveSession(token: string | null) {
  try {
    if (token) window.sessionStorage.setItem(sessionKey, token)
    else window.sessionStorage.removeItem(sessionKey)
  } catch { /* Storage can be disabled. Sign-in still works in memory. */ }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<api.AuthUser | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [savedToken, setSavedToken] = useState(readSession)
  const [restoreError, setRestoreError] = useState(false)
  const [restoreAttempt, setRestoreAttempt] = useState(0)
  const isLoading = isSigningIn || Boolean(savedToken && !restoreError)

  const logout = useCallback(() => {
    saveSession(null)
    api.setAccessToken(null)
    setToken(null)
    setUser(null)
    setSavedToken(null)
    setRestoreError(false)
  }, [])

  const retryRestore = useCallback(() => {
    setRestoreError(false)
    setRestoreAttempt(attempt => attempt + 1)
  }, [])

  const refreshUser = useCallback(async () => {
    if (!token) return null
    try {
      const current = await api.me()
      setUser(current)
      return current
    } catch (error) {
      if (error instanceof api.ApiError && error.status === 401) logout()
      throw error
    }
  }, [logout, token])

  const login = useCallback(async (email: string, password: string) => {
    setIsSigningIn(true)
    try {
      const result = await api.login(email, password)
      api.setAccessToken(result.accessToken)
      // Verify the signed-in identity through the protected endpoint before
      // exposing it to the rest of the application.
      let verifiedUser: api.AuthUser
      try {
        verifiedUser = await api.me()
      } catch (error) {
        logout()
        throw error
      }
      saveSession(result.accessToken)
      setToken(result.accessToken)
      setUser(verifiedUser)
      return verifiedUser
    } finally { setIsSigningIn(false) }
  }, [logout])

  const register = useCallback((data: Registration) => api.register(data), [])

  useEffect(() => {
    api.setUnauthorizedHandler(logout)
    return () => api.setUnauthorizedHandler(null)
  }, [logout])

  useEffect(() => {
    if (!savedToken) return
    const controller = new AbortController()
    api.setAccessToken(savedToken)
    void api.me(controller.signal).then(current => {
      if (controller.signal.aborted) return
      setUser(current)
      setToken(savedToken)
      setSavedToken(null)
    }).catch(error => {
      if (controller.signal.aborted) return
      if (error instanceof api.ApiError && error.status === 401) logout()
      else {
        api.setAccessToken(null)
        setRestoreError(true)
      }
    })
    return () => controller.abort()
  }, [savedToken, restoreAttempt, logout])

  const value = useMemo(() => ({
    user, token, isAuthenticated: Boolean(user && token), isLoading,
    restoreError, retryRestore, login, register, logout, refreshUser,
  }), [user, token, isLoading, restoreError, retryRestore, login, register, logout, refreshUser])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error("useAuth must be used within AuthProvider")
  return value
}
