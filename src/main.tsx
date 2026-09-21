import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { useTacticalStore } from './store/useTacticalStore'

// Hook debug chỉ tồn tại ở chế độ DEV: cho phép script kiểm thử tự động (chụp ảnh, đo đạc)
// điều khiển store mà không cần thao tác UI. Không xuất hiện trong bản production vì
// import.meta.env.DEV được Vite thay bằng false và nhánh này bị loại bỏ khi build.
declare global {
  interface Window {
    __vomkq?: { store: typeof useTacticalStore }
  }
}

if (import.meta.env.DEV) {
  window.__vomkq = { store: useTacticalStore }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
