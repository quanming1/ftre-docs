import { Routes, Route, Navigate } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import DocPage from './components/DocPage'
import { docs } from './docs'

export default function App() {
  return (
    <div className="h-screen flex overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-8 py-12">
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
      </main>
    </div>
  )
}
