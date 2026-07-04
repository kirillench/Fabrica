import { FlaskConical, KeyRound, Loader2 } from 'lucide-react'
import { useState } from 'react'
import * as api from '../api.js'

/**
 * Экран входа (уровень 1 безопасности): бэкенд запущен с APP_TOKENS,
 * доступ к данным — по персональному токену. Каждый пользователь
 * видит только свои сессии.
 */
export default function AuthGate({ onSuccess }) {
  const [value, setValue] = useState('')
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    if (!value.trim() || checking) return
    setChecking(true)
    setError('')
    api.setToken(value)
    try {
      const me = await api.getMe() // проверка токена
      onSuccess(me.user)
    } catch {
      api.clearToken()
      setError('Токен не подошёл. Проверьте и попробуйте ещё раз.')
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="glass w-full max-w-sm p-6 text-center">
        <div className="glass-soft mx-auto flex h-12 w-12 items-center justify-center">
          <FlaskConical size={22} className="text-base-200" />
        </div>
        <h1 className="mt-4 text-lg font-semibold text-base-100">Фабрика гипотез</h1>
        <p className="mt-1 text-sm text-base-400">
          Доступ по персональному токену. Сессии и база знаний защищены —
          вы увидите только свои данные.
        </p>
        <div className="mt-5 flex items-center gap-2">
          <KeyRound size={16} className="shrink-0 text-base-400" />
          <input
            type="password"
            autoFocus
            className="glass-input w-full px-3 py-2.5 text-sm text-base-100 placeholder:text-base-400"
            placeholder="Токен доступа"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
        {error && <p className="fade-up mt-2 text-xs text-base-300">{error}</p>}
        <button
          type="submit"
          disabled={!value.trim() || checking}
          className="btn-primary mt-4 flex w-full items-center justify-center gap-2 px-4 py-2.5 text-sm"
        >
          {checking ? <Loader2 size={15} className="spin" /> : 'Войти'}
        </button>
      </form>
    </div>
  )
}
