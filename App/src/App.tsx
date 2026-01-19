import { Suspense } from "react";
import { useRoutes, Routes, Route } from "react-router-dom";
import Home from "./components/home";

function App() {
  // Get tempo routes safely
  let routes: any[] = [];
  try {
    if (typeof window !== 'undefined' && import.meta.env.VITE_TEMPO === "true") {
      // Import tempo routes dynamically
      routes = [];
    }
  } catch (error) {
    routes = [];
  }

  const tempoRoutes = import.meta.env.VITE_TEMPO === "true" ? useRoutes(routes) : null;

  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-cyan-400 text-lg animate-pulse">Loading NOCTIS ORBIT...</div>
      </div>
    }>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="*" element={<Home />} />
      </Routes>
      {tempoRoutes}
    </Suspense>
  );
}

export default App;