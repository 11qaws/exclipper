import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import AppErrorBoundary from "./AppErrorBoundary";
import "../styles/streamsaver-reference.css";
import "../styles/retto-highlight.css";

const rootElement = document.getElementById("root");

if (rootElement === null) {
  throw new Error("앱을 시작할 #root 요소를 찾지 못했습니다.");
}

createRoot(rootElement).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);
