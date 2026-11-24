import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import * as api from "../services/api"

type Registration = { username: string; email: string; password: string; role: "CLIENT" | "PROVIDER" }
type AuthContextValue = {
  user: api.AuthUser | null
  token: string | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (email: string, password: string) => Promise<api.AuthUser>
  register: (data: Registration) => Promise<api.AuthUser>
  logout: () => void
  refreshUser: () => Promise<api.AuthUser | null>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<api.AuthUser | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const logout = useCallback(() => {
    api.setAccessToken(null)
    setToken(null)
    setUser(null)
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
    setIsLoading(true)
    try {
      const result = await api.login(email, password)
      api.setAccessToken(result.accessToken)
      setToken(result.accessToken)
      // Verify the signed-in identity through the protected endpoint before
      // exposing it to the rest of the application.
      const verifiedUser = await api.me()
      setUser(verifiedUser)
      return verifiedUser
    } finally { setIsLoading(false) }
  }, [])

  const register = useCallback((data: Registration) => api.register(data), [])

  useEffect(() => {
    api.setUnauthorizedHandler(logout)
    return () => api.setUnauthorizedHandler(null)
  }, [logout])

  const value = useMemo(() => ({ user, token, isAuthenticated: Boolean(user && token), isLoading, login, register, logout, refreshUser }), [user, token, isLoading, login, register, logout, refreshUser])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error("useAuth must be used within AuthProvider")
  return value
}
