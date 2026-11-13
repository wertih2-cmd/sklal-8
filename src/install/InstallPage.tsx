import { useEffect, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { Download, CircleCheck as CheckCircle2, ExternalLink, Share, SquarePlus } from 'lucide-react'
import { useI18n, useDocumentDir } from '@/i18n'
import { LangSwitcher } from '@/components/LangSwitcher'
import { INSTALL_APPS, type InstallApp } from './apps'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function isStandalone(): boolean {
  const nav = window.navigator as Navigator & { standalone?: boolean }
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true
}

function isIos(): boolean {
  const ua = window.navigator.userAgent
  return /iphone|ipad|ipod/i.test(ua) || (ua.includes('Mac') && navigator.maxTouchPoints > 1)
}

/** Страница, с которой сотрудник ставит приложение на телефон. Манифест и иконка у каждой страницы свои. */
export function InstallPage({ app }: { app: InstallApp }) {
  const { t } = useI18n()
  useDocumentDir()
  // Регистрирует сервис-воркер, если сотрудник открыл эту страницу первой.
  useRegisterSW({ onRegisterError() {} })

  const meta = INSTALL_APPS[app]
  const text = t.install[app]
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(isStandalone)
  const ios = isIos()

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setPromptEvent(e as BeforeInstallPromptEvent)
    }
    const onInstalled = () => {
      setInstalled(true)
      setPromptEvent(null)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const install = async () => {
    if (!promptEvent) return
    await promptEvent.prompt()
    const choice = await promptEvent.userChoice
    if (choice.outcome === 'accepted') setInstalled(true)
    setPromptEvent(null)
  }

  return (
    <div className="min-h-screen bg-app text-ink flex flex-col items-center px-6 pt-[calc(2rem+env(safe-area-inset-top,0px))] pb-[calc(2rem+env(safe-area-inset-bottom,0px))]">
      <div className="w-full max-w-sm flex justify-end mb-6">
        <LangSwitcher compact />
      </div>

      <img src={meta.icon} alt="" width={112} height={112} className="w-28 h-28 rounded-[26px] shadow-lg mb-5" />
      <h1 className="text-xl font-semibold text-center mb-2">{text.title}</h1>
      <p className="text-sm text-muted text-center max-w-xs mb-8">{text.text}</p>

      <div className="w-full max-w-sm space-y-3">
        {installed ? (
          <div className="flex items-center justify-center gap-2 bg-ok-soft text-ok rounded-2xl px-4 py-3 text-sm font-medium">
            <CheckCircle2 className="w-5 h-5 shrink-0" />
            {t.install.installed}
          </div>
        ) : promptEvent ? (
          <button
            onClick={() => void install()}
            className="w-full min-h-[52px] bg-accent text-on-accent rounded-2xl px-4 py-3 text-base font-medium flex items-center justify-center gap-2.5 active:opacity-90"
          >
            <Download className="w-5 h-5 shrink-0" />
            {t.install.install}
          </button>
        ) : ios ? (
          <div className="tile rounded-[20px] px-4 py-4">
            <p className="text-sm font-medium mb-3">{t.install.iosTitle}</p>
            <ol className="space-y-2.5 text-sm text-muted">
              <li className="flex items-start gap-2.5">
                <Share className="w-4 h-4 mt-0.5 shrink-0 text-accent" />
                <span>{t.install.iosShare}</span>
              </li>
              <li className="flex items-start gap-2.5">
                <SquarePlus className="w-4 h-4 mt-0.5 shrink-0 text-accent" />
                <span>{t.install.iosAdd}</span>
              </li>
            </ol>
          </div>
        ) : (
          <div className="tile rounded-[20px] px-4 py-4 text-sm text-muted">{t.install.otherHint}</div>
        )}

        <a
          href={meta.launchPath}
          className="w-full min-h-[48px] well border border-line rounded-2xl px-4 py-3 text-sm font-medium flex items-center justify-center gap-2 text-ink"
        >
          <ExternalLink className="w-4 h-4 shrink-0" />
          {t.install.open}
        </a>
      </div>
    </div>
  )
}
