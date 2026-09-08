/** A minimal EventSource for Node tests: reads an SSE stream with fetch and dispatches `data:` lines. */
export class FetchEventSource {
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  private controller = new AbortController();
  constructor(url: string) {
    void this.run(url);
  }
  private async run(url: string): Promise<void> {
    try {
      const res = await fetch(url, { signal: this.controller.signal });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const data = block
            .split('\n')
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).trimStart())
            .join('\n');
          if (data && this.onmessage) this.onmessage({ data });
        }
      }
    } catch (e) {
      if (!this.controller.signal.aborted && this.onerror) this.onerror(e);
    }
  }
  close(): void {
    this.controller.abort();
  }
}
