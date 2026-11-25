import { useState } from 'react'
import { sb, loginEmail, errText } from '../lib/supabase'

export default function Login() {
  const [login, setLogin] = useState('')
  const [pass, setPass] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!login.trim() || !pass) return setErr('Введите телефон или email и пароль')
    setBusy(true)
    setErr('')
    const { error } = await sb.auth.signInWithPassword({ email: loginEmail(login), password: pass })
    setBusy(false)
    if (error) setErr(errText(error))
  }

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <img className="logo" src="logo-dark-bg.png" alt="DJIGIT TAU" />
        <div className="auth-title">CRM</div>
        <label className="field">
          <span>Телефон или email</span>
          <input autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} placeholder="+7 700 000 00 00" />
        </label>
        <label className="field">
          <span>Пароль</span>
          <input type="password" autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} />
        </label>
        {err && <div className="alert bad">{err}</div>}
        <button className="btn wide" disabled={busy}>
          {busy ? 'Вход…' : 'Войти'}
        </button>
        <p className="muted small center">Аккаунты создаёт директор студии.</p>
      </form>
    </div>
  )
}
