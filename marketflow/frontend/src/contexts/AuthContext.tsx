'use client'

import { createContext, useContext, type ReactNode } from 'react'
import { useSession, signOut } from 'next-auth/react'

interface AuthUser {
  id:    string
  email: string
  plan:  'FREE' | 'PREMIUM'
}

interface AuthContextValue {
  user:        AuthUser | null
  isPremium:   boolean
  isLoggedIn:  boolean
  isLoading:   boolean
  logout:      () => void
}

const AuthContext = createContext<AuthContextValue>({
  user:       null,
  isPremium:  false,
  isLoggedIn: false,
  isLoading:  true,
  logout:     () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession()
  const isLoading  = status === 'loading'
  const user       = session?.user as AuthUser | null ?? null
  const isLoggedIn = !!user
  const isPremium  = user?.plan === 'PREMIUM'

  return (
    <AuthContext.Provider value={{ user, isPremium, isLoggedIn, isLoading, logout: () => signOut() }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
