import { useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth, useMe } from './lib/auth'
import { Icon, initials, type IconName } from './lib/ui'
import { ROLE_LABEL, type Role } from './lib/supabase'

// Меню зависит от роли. Пункты добавляются по мере готовности этапов — неработающих разделов нет.
export type MenuItem = { to: string; label: string; icon: IconName; roles: Role[] }
const ALL: Role[] = ['director', 'manager', 'admin', 'sales', 'trainer']
export const MENU: MenuItem[] = [
  { to: '/', label: 'Главная', icon: 'home', roles: ['director', 'manager'] },
  { to: '/profile', label: 'Профиль', icon: 'user', roles: ALL },
  { to: '/shift', label: 'Смена', icon: 'clock', roles: ALL },
  { to: '/trial-new', label: 'Заполнение пробников', icon: 'plus', roles: ['sales'] },
  { to: '/trials', label: 'Обработка пробников', icon: 'funnel', roles: ['sales'] },
  { to: '/trials', label: 'Пробники', icon: 'funnel', roles: ['director', 'manager', 'admin'] },
  { to: '/attendance', label: 'Посещаемость', icon: 'check', roles: ['director', 'manager', 'admin', 'trainer'] },
  { to: '/students', label: 'Ученики', icon: 'users', roles: ['director', 'manager', 'admin', 'trainer'] },
  { to: '/parents', label: 'Родители', icon: 'family', roles: ['director', 'manager', 'admin'] },
  { to: '/groups', label: 'Группы', icon: 'layers', roles: ['director', 'manager', 'admin'] },
  { to: '/schedule', label: 'Расписание', icon: 'calendar', roles: ['director', 'manager', 'admin', 'trainer'] },
  { to: '/shifts', label: 'Смены сотрудников', icon: 'clock', roles: ['director', 'manager', 'admin'] },
  { to: '/analytics', label: 'Аналитика и LTV', icon: 'funnel', roles: ['director', 'manager'] },
  { to: '/finance', label: 'Финансы', icon: 'layers', roles: ['director', 'manager', 'admin'] },
  { to: '/salaries', label: 'Зарплаты', icon: 'user', roles: ['director', 'manager', 'admin'] },
  { to: '/rent', label: 'Аренда и коммунальные', icon: 'building', roles: ['director', 'manager', 'admin'] },
  { to: '/expenses', label: 'Доп. расходы', icon: 'layers', roles: ['director', 'manager', 'admin'] },
  { to: '/insurance', label: 'Медстраховка', icon: 'plus', roles: ['director', 'manager', 'admin'] },
  { to: '/fines', label: 'Штрафы', icon: 'x', roles: ['director', 'manager', 'admin'] },
  { to: '/branches', label: 'Филиалы', icon: 'building', roles: ['director', 'manager', 'admin'] },
  { to: '/employees', label: 'Сотрудники', icon: 'user', roles: ['director', 'manager'] },
  { to: '/audit', label: 'Журнал действий', icon: 'lock', roles: ['director', 'manager'] },
  { to: '/amocrm', label: 'Интеграция amoCRM', icon: 'key', roles: ['director'] },
  { to: '/settings', label: 'Настройки', icon: 'settings', roles: ['director'] },
]
export const homeOf = (r: Role) => (r === 'director' || r === 'manager' ? '/' : '/profile')

export default function Layout() {
  const me = useMe()
  const { signOut } = useAuth()
  const [mini, setMini] = useState(localStorage.getItem('dt_mini') === '1')
  const [open, setOpen] = useState(false)
  const loc = useLocation()
  const items = MENU.filter((m) => m.roles.includes(me.role))
  const title = items.find((m) => (m.to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(m.to)))?.label ?? ''

  return (
    <div className={'shell' + (mini ? ' mini' : '') + (open ? ' open' : '')}>
      <aside className="side">
        <div className="brand">
          <img src="eagle.png" alt="" />
          <b>
            DJIGIT TAU<span>CRM</span>
          </b>
        </div>
        <nav>
          {items.map((m) => (
            <NavLink key={m.to} to={m.to} end={m.to === '/'} title={m.label} onClick={() => setOpen(false)}>
              <Icon name={m.icon} />
              <span>{m.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="side-foot">
          <button
            className="nav-btn collapse"
            onClick={() => {
              setMini(!mini)
              localStorage.setItem('dt_mini', mini ? '0' : '1')
            }}
            title={mini ? 'Развернуть меню' : 'Свернуть меню'}
          >
            <Icon name="side" />
            <span>{mini ? 'Развернуть' : 'Свернуть меню'}</span>
          </button>
          <button className="nav-btn" onClick={signOut} title="Выйти">
            <Icon name="out" />
            <span>Выйти</span>
          </button>
        </div>
      </aside>
      <div className="dim" onClick={() => setOpen(false)} />
      <main className="main">
        <header className="top">
          <button className="icon-btn burger" onClick={() => setOpen(true)} aria-label="Открыть меню">
            <Icon name="menu" />
          </button>
          <h2>{title}</h2>
          <div className="me">
            <span className="avatar">{me.photo_url ? <img src={me.photo_url} alt="" /> : initials(me.full_name)}</span>
            <div>
              <b>{me.full_name}</b>
              <small>{ROLE_LABEL[me.role]}</small>
            </div>
          </div>
        </header>
        <div className="content">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
