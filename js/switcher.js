// Переключатель станций с задержкой: табло (onPreview) отвечает на каждое нажатие сразу,
// а тяжёлая смена потока (onCommit) — один раз, когда нажатия стихли на delayMs.
export function createSwitcher({ onPreview, onCommit, delayMs = 300 }) {
  let timer = null;
  let pending = null;
  return {
    request(code) {
      pending = code;
      onPreview(code);
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        const next = pending;
        pending = null;
        onCommit(next);
      }, delayMs);
    },
  };
}
