import { useState } from 'react'
import { sb, errText } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { toast } from '../lib/ui'

// Смена пароля. forced — при первом входе с временным паролем от директора.
export default function ChangePassword({ forced, onDone }: { forced?: boolean; onDone?: () => void }) {
  const { reload, signOut } = useAuth()
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (a.length < 8) return setErr('Пароль — минимум 8 символов')
    if (!/\d/.test(a) || !/\p{L}/u.test(a)) return setErr('В пароле нужны буквы и цифры')
    if (a !== b) return setErr('Пароли не совпадают')
    setBusy(true)
    const { error } = await sb.auth.updateUser({ password: a, data: { must_change: false } })
    setBusy(false)
    if (error) return setErr(/different from the old/i.test(error.message) ? 'Новый пароль должен отличаться от старого' : errText(error))
    toast('Пароль изменён')
    setA('')
    setB('')
    await reload()
    onDone?.()
  }

  const form = (
    <form className={forced ? 'auth-card' : 'form-grid'} onSubmit={submit}>
      {forced && <img className="logo" src="logo-dark-bg.png" alt="DJIGIT TAU" />}
      {forced && <p className="muted">Это первый вход. Придумайте свой пароль — временный больше не будет работать.</p>}
      <label className="field">
        <span>Новый пароль</span>
        <input type="password" autoComplete="new-password" value={a} onChange={(e) => setA(e.target.value)} />
      </label>
      <label className="field">
        <span>Повторите пароль</span>
        <input type="password" autoComplete="new-password" value={b} onChange={(e) => setB(e.target.value)} />
      </label>
      {err && <div className="alert bad full">{err}</div>}
      <div className="full row">
        <button className={'btn' + (forced ? ' wide' : '')} disabled={busy}>
          Сохранить пароль
        </button>
        {forced && (
          <button type="button" className="btn ghost" onClick={signOut}>
            Выйти
          </button>
        )}
      </div>
    </form>
  )
  return forced ? <div className="auth-wrap">{form}</div> : form
}
