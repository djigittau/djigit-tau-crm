import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import { Toasts } from './lib/ui'
import Layout, { MENU, homeOf } from './Layout'
import Login from './pages/Login'
import ChangePassword from './pages/ChangePassword'
import Home from './pages/Home'
import Profile from './pages/Profile'
import Shift from './pages/Shift'
import Branches from './pages/Branches'
import Employees from './pages/Employees'
import Settings from './pages/Settings'
import Students from './pages/Students'
import Parents from './pages/Parents'
import Groups from './pages/Groups'
import Schedule from './pages/Schedule'
import Attendance from './pages/Attendance'
import Shifts from './pages/Shifts'
import Trials from './pages/Trials'
import TrialFill from './pages/TrialFill'
import Finance from './pages/Finance'
import Salaries from './pages/Salaries'
import Expenses from './pages/Expenses'
import Insurance from './pages/Insurance'
import Fines from './pages/Fines'

const PAGES: Record<string, () => React.JSX.Element> = {
  '/': Home,
  '/profile': Profile,
  '/shift': Shift,
  '/branches': Branches,
  '/employees': Employees,
  '/settings': Settings,
  '/students': Students,
  '/parents': Parents,
  '/groups': Groups,
  '/schedule': Schedule,
  '/attendance': Attendance,
  '/shifts': Shifts,
  '/trials': Trials,
  '/trial-new': TrialFill,
  '/finance': Finance,
  '/salaries': Salaries,
  '/rent': () => <Expenses only={['rent', 'utilities']} title="Аренда и коммунальные" />,
  '/expenses': () => <Expenses title="Дополнительные расходы" />,
  '/insurance': Insurance,
  '/fines': Fines,
}

function Gate() {
  const { session, profile, loading, signOut } = useAuth()
  if (loading) return <div className="splash">Загрузка…</div>
  if (!session) return <Login />
  if (!profile || profile.status !== 'active')
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <img className="logo" src="logo-dark-bg.png" alt="DJIGIT TAU" />
          <div className="alert bad">Доступ закрыт. Обратитесь к директору студии.</div>
          <button className="btn ghost wide" onClick={signOut}>
            Выйти
          </button>
        </div>
      </div>
    )
  if (session.user.user_metadata?.must_change) return <ChangePassword forced />

  // Страница открывается только ролям из меню. Данные дополнительно защищены RLS в базе.
  const allowed = MENU.filter((m) => m.roles.includes(profile.role))
  return (
    <Routes>
      <Route element={<Layout />}>
        {allowed.map((m) => {
          const P = PAGES[m.to]
          return <Route key={m.to} path={m.to} element={<P />} />
        })}
        <Route path="*" element={<Navigate to={homeOf(profile.role)} replace />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <HashRouter>
      <AuthProvider>
        <Gate />
        <Toasts />
      </AuthProvider>
    </HashRouter>
  )
}
