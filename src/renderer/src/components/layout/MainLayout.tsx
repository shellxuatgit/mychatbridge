import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'

export function MainLayout() {
  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg-primary)]">
      <div className="bokeh-bg">
        <div className="bokeh-blob bokeh-blob-1" />
        <div className="bokeh-blob bokeh-blob-2" />
      </div>
      <Sidebar />
      <main className="relative z-10 flex-1 overflow-auto p-6">
        <Outlet />
      </main>
    </div>
  )
}
