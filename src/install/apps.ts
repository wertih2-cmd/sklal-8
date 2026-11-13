export type InstallApp = 'sv' | 'qr'

interface InstallAppMeta {
  /** Страница установки (со своим манифестом и иконкой). */
  installPath: string
  /** Адрес, с которого запускается установленное приложение. */
  launchPath: string
  /** Иконка приложения. */
  icon: string
}

export const INSTALL_APPS: Record<InstallApp, InstallAppMeta> = {
  sv: { installPath: '/sv-install.html', launchPath: '/sv.html', icon: '/icons/sv-192.png' },
  qr: { installPath: '/qr-install.html', launchPath: '/qr.html', icon: '/icons/qr-192.png' },
}

/** Полная ссылка на страницу установки — её отправляют сотруднику. */
export function installUrl(app: InstallApp): string {
  return `${window.location.origin}${INSTALL_APPS[app].installPath}`
}
