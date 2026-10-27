const abortError = () => new DOMException('已取消处理', 'AbortError');

// Shared flag reaches a busy WASM worker without relying on its blocked message loop.
export function createVideoControl({ signal, onState = () => {} } = {}) {
  const supported = globalThis.crossOriginIsolated === true && typeof SharedArrayBuffer === 'function';
  const words = supported ? new Int32Array(new SharedArrayBuffer(8)) : null;
  let state = 'running', closed = false, wake = null;
  const emit = next => { if (!closed && state !== next) { state = next; onState(next); } };
  const resume = () => {
    if (words) { Atomics.store(words, 0, 0); Atomics.notify(words, 0); }
    wake?.(); wake = null;
    emit('running');
  };
  const observer = words ? setInterval(() => {
    if (Atomics.load(words, 0) && Atomics.load(words, 1)) emit('paused');
  }, 100) : null;
  const abort = () => resume();
  signal?.addEventListener('abort', abort, { once: true });
  return {
    supported,
    buffer: words?.buffer,
    get state() { return state; },
    pause() {
      if (closed || !words || signal?.aborted || Atomics.load(words, 0)) return;
      Atomics.store(words, 0, 1);
      emit('pausing');
    },
    resume,
    async checkpoint() {
      if (signal?.aborted) throw abortError();
      if (words && Atomics.load(words, 0)) {
        emit('paused');
        await new Promise(resolve => { wake = resolve; });
      }
      if (signal?.aborted) throw abortError();
    },
    dispose() {
      closed = true;
      clearInterval(observer);
      signal?.removeEventListener('abort', abort);
      resume();
    },
  };
}
