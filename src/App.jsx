import { lazy, Suspense } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./lib/AuthContext.jsx";
import { SettingsProvider } from "./lib/SettingsContext.jsx";
import ProtectedRoute from "./components/ProtectedRoute.jsx";
import AuthGuard from "./components/AuthGuard.jsx";
import AdminGuard from "./components/AdminGuard.jsx";
import ChatLayout from "./layouts/ChatLayout.jsx";
import Home from "./pages/Home.jsx";
import ChatPage from "./pages/ChatPage.jsx";
import SettingsPage from "./pages/SettingsPage.jsx";
import ContactsPanel from "./components/chat/ContactsPanel.jsx";
import FeedsPage from "./pages/FeedsPage.jsx";
import PaymentStatusPage from "./pages/PaymentStatusPage.jsx";
import InvoicePage from "./pages/InvoicePage.jsx";
const AdminDashboard = lazy(() => import("./pages/AdminDashboard.jsx"));
const AdminDiagnostics = lazy(() => import("./pages/AdminDiagnostics.jsx"));
import AuthLanding from "./pages/AuthLanding.jsx";
import Login from "./pages/Login.jsx";
import Register from "./pages/Register.jsx";
import VerifyEmail from "./pages/VerifyEmail.jsx";
import ForgotPassword from "./pages/ForgotPassword.jsx";
import ResetPassword from "./pages/ResetPassword.jsx";
import PageNotFound from "./lib/PageNotFound.jsx";
import ScrollToTop from "./components/ScrollToTop.jsx";

function App() {
  return (
    <SettingsProvider>
      <AuthProvider>
        <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <ScrollToTop />
          <Routes>
            <Route path="/" element={<AuthGuard><AuthLanding /></AuthGuard>} />
            <Route path="/login" element={<AuthGuard><Login /></AuthGuard>} />
            <Route path="/register" element={<AuthGuard><Register /></AuthGuard>} />
            <Route path="/verify-email" element={<VerifyEmail />} />
            <Route path="/forgot-password" element={<AuthGuard><ForgotPassword /></AuthGuard>} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route
              path="/app"
              element={
                <ProtectedRoute>
                  <ChatLayout />
                </ProtectedRoute>
              }
            >
              <Route index element={<Home />} />
              <Route path="chat/:chatId" element={<ChatPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="settings/:section" element={<SettingsPage />} />
              <Route path="contacts" element={<ContactsPanel />} />
              <Route path="feeds" element={<FeedsPage />} />
              <Route path="payment/:purchaseId" element={<PaymentStatusPage />} />
              <Route path="invoice/:purchaseId" element={<InvoicePage />} />
            </Route>
            <Route
              path="/admin"
              element={
                <AdminGuard>
                  <Suspense fallback={null}><AdminDashboard /></Suspense>
                </AdminGuard>
              }
            />
            <Route path="/admin/diagnostics" element={<AdminGuard><Suspense fallback={null}><AdminDiagnostics /></Suspense></AdminGuard>} />
            <Route path="/default-path" element={<Navigate to="/" replace />} />
            <Route path="*" element={<PageNotFound />} />
          </Routes>
        </Router>
      </AuthProvider>
    </SettingsProvider>
  );
}

export default App;
