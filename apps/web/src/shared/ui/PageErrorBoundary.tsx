import { Component, type ReactNode, type ErrorInfo } from "react";
import { Button } from "./Primitives";
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
        <Button icon="refresh" onClick={() => window.location.reload()}>
          Tải lại trang
        </Button>
      </section>
    ) : (
      this.props.children
    );
  }
}
