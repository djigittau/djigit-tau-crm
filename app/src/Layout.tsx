import { useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth, useMe } from './lib/auth'
import { Icon, initials, ThemeToggle, type IconName } from './lib/ui'
import { ROLE_LABEL, type Role } from './lib/supabase'

// Меню зависит от роли. Пункты добавляются по мере готовности этапов — неработающих разделов нет.
export type MenuItem = { to: string; label: string; icon: IconName; roles: Role[]; group: string }
const ALL: Role[] = ['director', 'manager', 'admin', 'sales', 'trainer']
const OFFICE: Role[] = ['director', 'manager', 'admin']
export const MENU: MenuItem[] = [
  { to: '/', label: 'Главная', icon: 'home', roles: ['director', 'manager'], group: '' },
  { to: '/profile', label: 'Профиль', icon: 'user', roles: ALL, group: '' },
  { to: '/shift', label: 'Смена', icon: 'clock', roles: ['manager', 'admin', 'sales', 'trainer'], group: '' },
  { to: '/trial-new', label: 'Заполнение пробников', icon: 'plus', roles: ['sales'], group: '' },
  { to: '/trials', label: 'Обработка пробников', icon: 'funnel', roles: ['sales'], group: '' },
  { to: '/trials', label: 'Пробники', icon: 'funnel', roles: OFFICE, group: 'Клиенты' },
  { to: '/students', label: 'Ученики', icon: 'users', roles: [...OFFICE, 'trainer'], group: 'Клиенты' },
  { to: '/attendance', label: 'Посещаемость', icon: 'check', roles: [...OFFICE, 'trainer'], group: 'Занятия' },
  { to: '/groups', label: 'Группы', icon: 'layers', roles: OFFICE, group: 'Занятия' },
  { to: '/schedule', label: 'Расписание', icon: 'calendar', roles: [...OFFICE, 'trainer'], group: 'Занятия' },
  { to: '/shifts', label: 'Смены сотрудников', icon: 'clock', roles: OFFICE, group: 'Занятия' },
  { to: '/finance', label: 'Финансы', icon: 'layers', roles: OFFICE, group: 'Деньги' },
  { to: '/analytics', label: 'Аналитика и LTV', icon: 'funnel', roles: ['director', 'manager'], group: 'Деньги' },
  { to: '/salaries', label: 'Зарплаты', icon: 'user', roles: OFFICE, group: 'Деньги' },
  { to: '/rent', label: 'Аренда и коммунальные', icon: 'building', roles: OFFICE, group: 'Деньги' },
  { to: '/expenses', label: 'Доп. расходы', icon: 'layers', roles: OFFICE, group: 'Деньги' },
  { to: '/insurance', label: 'Медстраховка', icon: 'plus', roles: OFFICE, group: 'Деньги' },
  { to: '/fines', label: 'Штрафы', icon: 'x', roles: OFFICE, group: 'Деньги' },
  { to: '/branches', label: 'Филиалы', icon: 'building', roles: OFFICE, group: 'Управление' },
  { to: '/employees', label: 'Сотрудники', icon: 'user', roles: ['director', 'manager'], group: 'Управление' },
  { to: '/audit', label: 'Журнал действий', icon: 'lock', roles: ['director', 'manager'], group: 'Управление' },
  { to: '/amocrm', label: 'Интеграция amoCRM', icon: 'key', roles: ['director'], group: 'Управление' },
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
  // Разделы меню (как в amoCRM): заголовок сворачивает раздел, раздел с открытой страницей всегда раскрыт.
  const groups: [string, MenuItem[]][] = []
  for (const m of items) {
    const last = groups[groups.length - 1]
    if (last?.[0] === m.group) last[1].push(m)
    else groups.push([m.group, [m]])
  }
  const [closed, setClosed] = useState<string[]>(() => JSON.parse(localStorage.getItem('dt_closed') || '[]'))
  const toggle = (g: string) => {
    const next = closed.includes(g) ? closed.filter((x) => x !== g) : [...closed, g]
    setClosed(next)
    localStorage.setItem('dt_closed', JSON.stringify(next))
  }

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
          {groups.map(([g, list]) => {
            const shut = !!g && closed.includes(g) && !list.some((m) => m.label === title)
            return (
              <div key={g || '-'} className="nav-group">
                {g && (
                  <button className="nav-head" onClick={() => toggle(g)} aria-expanded={!shut}>
                    {g}
                    <Icon name="chevron" size={14} />
                  </button>
                )}
                {!shut &&
                  list.map((m) => (
                    <NavLink key={m.to} to={m.to} end={m.to === '/'} title={m.label} onClick={() => setOpen(false)}>
                      <Icon name={m.icon} />
                      <span>{m.label}</span>
                    </NavLink>
                  ))}
              </div>
            )
          })}
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
          <ThemeToggle />
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
