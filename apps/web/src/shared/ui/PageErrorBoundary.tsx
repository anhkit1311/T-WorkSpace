import { Component, type ReactNode, type ErrorInfo } from "react";
export class PageErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Page failed", error, info.componentStack);
  }
  render() {
    return this.state.failed ? (
      <section className="page-load-error" role="alert">
        <h2>Không mở được trang</h2>
        <p>Hãy tải lại trang để tiếp tục. Bản nháp đã lưu vẫn được giữ.</p>
        <button onClick={() => window.location.reload()}>Tải lại trang</button>
      </section>
    ) : (
      this.props.children
    );
  }
}
