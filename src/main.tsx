import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import AppErrorBoundary from "./AppErrorBoundary";
import "../styles/streamsaver-reference.css";
import "../styles/exclipper-foundation.css";
import "../styles/retto-highlight.css";
import "../styles/exclipper-app.css";
import "../styles/exclipper-surface.css";
import "../styles/review-surface.css";
// 공용 폼이 먼저 와야 화면별 스타일이 그 위를 덮을 수 있다.
import "../styles/forms/ui-forms.css";
import "../styles/unfinished-jobs.css";

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
