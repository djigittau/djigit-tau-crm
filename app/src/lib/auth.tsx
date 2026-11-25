import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { sb, type Profile } from './supabase'

type AuthState = {
  session: Session | null
  profile: Profile | null
  loading: boolean
  reload: () => Promise<void>
  signOut: () => Promise<void>
}

const Ctx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  async function load(s: Session | null) {
    setSession(s)
    if (!s) {
      setProfile(null)
      setLoading(false)
      return
    }
    const { data } = await sb.from('profiles').select('*').eq('id', s.user.id).maybeSingle()
    setProfile(data as Profile | null)
    setLoading(false)
  }

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => load(data.session))
    // Запросы к базе нельзя делать синхронно внутри onAuthStateChange — откладываем.
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => setTimeout(() => load(s)))
    return () => sub.subscription.unsubscribe()
  }, [])

  const value: AuthState = {
    session,
    profile,
    loading,
    reload: async () => load((await sb.auth.getSession()).data.session),
    signOut: async () => {
      await sb.auth.signOut()
    },
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth вне AuthProvider')
  return v
}

// Профиль гарантированно есть внутри защищённых страниц.
export function useMe() {
  const { profile } = useAuth()
  return profile as Profile
}
