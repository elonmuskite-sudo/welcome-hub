import { lazy, Suspense } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./lib/AuthContext.jsx";
import { SettingsProvider } from "./lib/SettingsContext.jsx";
import { CallProvider } from "./lib/CallContext.jsx";
import ProtectedRoute from "./components/ProtectedRoute.jsx";
import AuthGuard from "./components/AuthGuard.jsx";
import AdminGuard from "./components/AdminGuard.jsx";
import AuthLanding from "./pages/AuthLanding.jsx";
import Login from "./pages/Login.jsx";
import Register from "./pages/Register.jsx";
import VerifyEmail from "./pages/VerifyEmail.jsx";
import ForgotPassword from "./pages/ForgotPassword.jsx";
import ResetPassword from "./pages/ResetPassword.jsx";
import PageNotFound from "./lib/PageNotFound.jsx";
import ScrollToTop from "./components/ScrollToTop.jsx";

// Signed-in surfaces are split out of the entry bundle. They are large (the
// settings tree, chat thread, media pickers) and none of them is needed to paint
// the auth screens, so loading them on demand keeps first paint inside budget.
const ChatLayout = lazy(() => import("./layouts/ChatLayout.jsx"));
const Home = lazy(() => import("./pages/Home.jsx"));
const ChatPage = lazy(() => import("./pages/ChatPage.jsx"));
const SettingsPage = lazy(() => import("./pages/SettingsPage.jsx"));
const ContactsPanel = lazy(() => import("./components/chat/ContactsPanel.jsx"));
const FeedsPage = lazy(() => import("./pages/FeedsPage.jsx"));
const PaymentStatusPage = lazy(() => import("./pages/PaymentStatusPage.jsx"));
const InvoicePage = lazy(() => import("./pages/InvoicePage.jsx"));
const AdminLogin = lazy(() => import("./pages/AdminLogin.jsx"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard.jsx"));
const AdminUsers = lazy(() => import("./pages/AdminUsers.jsx"));
const AdminDiagnostics = lazy(() => import("./pages/AdminDiagnostics.jsx"));

// Minimal, dependency-free fallback so a route split never flashes an empty shell.
function RouteFallback() {
  return (
    <div className="chat-shell flex items-center justify-center bg-background" aria-busy="true">
      <span
        role="status"
        aria-label="Loading"
        className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-primary/25 border-t-primary"
      />
    </div>
  );
}

function App() {
  return (
    <SettingsProvider>
      <AuthProvider>
        <CallProvider>
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
                  <Suspense fallback={<RouteFallback />}>
                    <ChatLayout />
                  </Suspense>
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
            <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
            <Route
              path="/admin/login"
              element={<Suspense fallback={<RouteFallback />}><AdminLogin /></Suspense>}
            />
            <Route
              path="/admin/dashboard"
              element={
                <AdminGuard>
                  <Suspense fallback={<RouteFallback />}><AdminDashboard /></Suspense>
                </AdminGuard>
              }
            />
            <Route
              path="/admin/users"
              element={
                <AdminGuard>
                  <Suspense fallback={<RouteFallback />}><AdminUsers /></Suspense>
                </AdminGuard>
              }
            />
            <Route path="/admin/diagnostics" element={<AdminGuard><Suspense fallback={<RouteFallback />}><AdminDiagnostics /></Suspense></AdminGuard>} />
            <Route path="/default-path" element={<Navigate to="/" replace />} />
            <Route path="*" element={<PageNotFound />} />
          </Routes>
          </Router>
        </CallProvider>
      </AuthProvider>
    </SettingsProvider>
  );
}

export default App;
