(() => {
  const clamp = (value, min, max, fallback) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  };

  function pairRange(range) {
    if (!range || range.type !== "range" || range.dataset.rangeNumberPaired === "1") return;
    if (range.dataset.filterRange) return;
    range.dataset.rangeNumberPaired = "1";
    if (!range.id) range.id = "range-" + Math.random().toString(36).slice(2);

    const min = Number.isFinite(Number(range.min)) ? Number(range.min) : 0;
    const max = Number.isFinite(Number(range.max)) ? Number(range.max) : 100;
    const step = range.step && range.step !== "any" ? range.step : "1";

    const pair = document.createElement("span");
    pair.className = "range-number-pair";
    const number = document.createElement("input");
    number.type = "number";
    number.className = "range-number-value";
    number.min = String(min);
    number.max = String(max);
    number.step = step;
    number.value = range.value;
    number.dataset.rangeNumberFor = range.id;
    number.setAttribute("aria-label", (range.getAttribute("aria-label") || range.closest("label")?.childNodes?.[0]?.textContent?.trim() || "Значение") + " числом");

    range.parentNode.insertBefore(pair, range);
    pair.append(range, number);

    const fromRange = () => {
      if (document.activeElement !== number) number.value = range.value;
    };
    const applyNumber = () => {
      const fallback = Number(range.value) || 0;
      const value = clamp(number.value, min, max, fallback);
      number.value = String(value);
      if (range.value !== String(value)) {
        range.value = String(value);
        range.dispatchEvent(new Event("input", { bubbles:true }));
      }
    };

    range.addEventListener("input", fromRange);
    range.addEventListener("change", fromRange);
    number.addEventListener("input", applyNumber);
    number.addEventListener("change", applyNumber);
    number.addEventListener("blur", applyNumber);
    number.addEventListener("keydown", event => { if (event.key === "Enter") { applyNumber(); number.blur(); } });

    const observer = setInterval(() => {
      if (!number.isConnected) return clearInterval(observer);
      fromRange();
    }, 160);
  }

  function scan(root=document) {
    root.querySelectorAll?.('input[type="range"]').forEach(pairRange);
  }

  scan();
  new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) if (node.nodeType === 1) {
      if (node.matches?.('input[type="range"]')) pairRange(node);
      scan(node);
    }
  }).observe(document.body, { childList:true, subtree:true });

  window.RangeNumberSync = { scan, pairRange };
})();