import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import '../lib/theme'
import { InstallPage } from './InstallPage'
import type { InstallApp } from './apps'

const app: InstallApp = document.body.dataset.app === 'qr' ? 'qr' : 'sv'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <InstallPage app={app} />
  </StrictMode>
)
