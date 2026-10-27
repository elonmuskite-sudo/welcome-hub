import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/query-client.js";
import App from "./App.jsx";
import "./index.css";
import { initializeNativeCallPush } from "./lib/callPush.js";

void initializeNativeCallPush().catch((error) => {
  console.error("Native call push initialization failed:", error);
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).catch(() => {
      console.warn("Service worker registration failed")
    })
  })
}

createRoot(document.getElementById("root")).render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>
);
