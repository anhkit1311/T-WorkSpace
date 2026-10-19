export interface QueuedCall {
  callId: string;
  departmentId: string;
  /** Epoch ms when the call first entered the queue; kept when a call is put back at the head. */
  enqueuedAt: number;
}

/** In-memory FIFO queue per department. The ACD runs in one process, so memory is the source of truth. */
export class CallQueues {
  private readonly queues = new Map<string, QueuedCall[]>();

  enqueue(call: QueuedCall, front = false): void {
    this.remove(call.callId);
    const queue = this.queues.get(call.departmentId) ?? [];
    if (front) queue.unshift(call);
    else queue.push(call);
    this.queues.set(call.departmentId, queue);
  }

  /** The call at the head of a department's queue, without removing it. */
  peek(departmentId: string): QueuedCall | undefined {
    return this.queues.get(departmentId)?.[0];
  }

  remove(callId: string): QueuedCall | undefined {
    for (const [departmentId, queue] of this.queues) {
      const index = queue.findIndex((call) => call.callId === callId);
      if (index >= 0) {
        const [removed] = queue.splice(index, 1);
        if (!queue.length) this.queues.delete(departmentId);
        return removed;
      }
    }
    return undefined;
  }

  /** Q5 metrics: waiting calls and the longest wait (ms) per department with a queue. */
  sizes(now: number): { departmentId: string; waiting: number; longestMs: number }[] {
    return [...this.queues].map(([departmentId, queue]) => ({
      departmentId,
      waiting: queue.length,
      longestMs: Math.max(0, ...queue.map((call) => now - call.enqueuedAt)),
    }));
  }

  waiting(departmentId: string): readonly QueuedCall[] {
    return this.queues.get(departmentId) ?? [];
  }

  departments(): string[] {
    return [...this.queues.keys()];
  }
}
