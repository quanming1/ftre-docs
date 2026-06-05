import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import DocPage from './components/DocPage'
import LandingPage from './components/LandingPage'
import SiteHeader from './components/SiteHeader'
import { docs } from './docs'

export default function App() {
  const location = useLocation()
  const isDocs = location.pathname.startsWith('/docs')

  if (!isDocs) {
    return (
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    )
  }

  return (
    <div className="min-h-screen bg-base text-t-primary lg:h-screen lg:overflow-hidden">
      <SiteHeader />
      <div className="lg:flex lg:h-[calc(100vh-80px)] lg:overflow-hidden">
        <Sidebar />
        <main className="min-w-0 flex-1 bg-surface lg:overflow-y-auto">
          <div className="mx-auto w-full max-w-[1320px] px-5 py-6 sm:px-8 lg:px-10 lg:py-7">
            <div key={location.pathname} className="doc-page-transition">
            <Routes>
              <Route path="/" element={<Navigate to="/docs/overview" replace />} />
              {docs.map((doc) => (
                <Route
                  key={doc.path}
                  path={`/docs/${doc.path}`}
                  element={<DocPage doc={doc} />}
                />
              ))}
            </Routes>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
