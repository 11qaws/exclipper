import { Component, type ErrorInfo, type ReactNode } from "react";

interface AppErrorBoundaryProps {
  readonly children: ReactNode;
}

interface AppErrorBoundaryState {
  readonly failed: boolean;
}

export default class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  public state: AppErrorBoundaryState = { failed: false };

  public static getDerivedStateFromError(): AppErrorBoundaryState {
    return { failed: true };
  }

  public componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("ExClipper display recovery required", error, info.componentStack);
  }

  public render(): ReactNode {
    if (!this.state.failed) return this.props.children;

    return (
      <div className="rh-app rh-recovery-shell">
        <main className="rh-recovery-main">
          <section className="rh-recovery-card" role="alert">
            <p className="rh-eyebrow">화면 복구 필요</p>
            <h1>결과 화면을 표시하지 못했어요</h1>
            <p>
              새로고침은 저장된 분석 기록을 지우지 않습니다. 화면을 다시 불러온 뒤 저장된
              분석에서 계속 확인해 주세요.
            </p>
            <button
              className="btn btn-primary"
              type="button"
              onClick={() => window.location.reload()}
            >
              화면 다시 불러오기
            </button>
          </section>
        </main>
      </div>
    );
  }
}
