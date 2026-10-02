// A native WebRTC/device promise may remain pending even after the user cancels.
export function mediaOperation<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  timeoutMs = 10000,
  onLate?: (value: T) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, value?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", aborted);
      if (error) reject(error);
      else resolve(value as T);
    };
    const aborted = () => finish(new Error("Tham gia đã bị hủy."));
    const timer = setTimeout(
      () => finish(new Error("Thiết lập media quá thời gian. Hãy thử lại hoặc dùng Chrome/Edge.")),
      timeoutMs,
    );
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted();
    promise.then(
      (value) => {
        if (settled) onLate?.(value);
        else finish(undefined, value);
      },
      (error) => finish(error instanceof Error ? error : new Error(String(error))),
    );
  });
}
