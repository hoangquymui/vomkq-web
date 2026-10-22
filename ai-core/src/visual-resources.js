// Cache both a successful load and concurrent callers; failed loads can retry.
export function lazyResource(load) {
  let pending;
  return () => {
    if (!pending) {
      pending = Promise.resolve().then(load).catch((error) => {
        pending = undefined;
        throw error;
      });
    }
    return pending;
  };
}

export function createVisualRenderer({ loadChart, loadMermaid }) {
  const charts = new WeakMap();
  const pending = new WeakSet();
  const generations = new WeakMap();
  let diagramQueue = Promise.resolve();

  function dispose(root) {
    generations.set(root, (generations.get(root) || 0) + 1);
    for (const canvas of root.querySelectorAll("canvas")) {
      const chart = charts.get(canvas);
      if (chart) {
        chart.destroy();
        charts.delete(canvas);
      }
    }
  }

  async function renderChart(canvas, source, isCurrent = () => true) {
    const config = JSON.parse(source);
    const Chart = await loadChart();
    if (!canvas.isConnected || !isCurrent()) return;
    config.options = {
      responsive: true, maintainAspectRatio: false, color: "#cfd8d7",
      ...(config.options || {}),
    };
    charts.get(canvas)?.destroy();
    charts.delete(canvas);
    try {
      const chart = new Chart(canvas, config);
      charts.set(canvas, chart);
      return chart;
    } catch (error) {
      // Chart.js can register an instance before rejecting an invalid config.
      Chart.getChart?.(canvas)?.destroy();
      throw error;
    }
  }

  async function renderDiagram(element, source, isCurrent = () => true) {
    const mermaid = await loadMermaid();
    // Mermaid uses shared rendering state. Serialize across chat and preview panels.
    const render = diagramQueue.then(async () => {
      if (!element.isConnected || !isCurrent()) return;
      element.textContent = source;
      element.classList.add("mermaid");
      await mermaid.run({ nodes: [element], suppressErrors: true });
    });
    diagramQueue = render.catch(() => {});
    return render;
  }

  async function hydrate(root) {
    const generation = generations.get(root) || 0;
    const isCurrent = (element) => root.isConnected && element.isConnected
      && root.contains(element) && (generations.get(root) || 0) === generation;
    const tasks = [];
    for (const element of root.querySelectorAll(".mermaid-pending, .chart-pending")) {
      if (pending.has(element)) continue;
      pending.add(element);
      const diagram = element.classList.contains("mermaid-pending");
      tasks.push((async () => {
        try {
          const source = decodeURIComponent(element.dataset.source || "");
          if (diagram) await renderDiagram(element, source, () => isCurrent(element));
          else await renderChart(element.querySelector("canvas"), source, () => isCurrent(element));
          if (isCurrent(element)) element.classList.remove("mermaid-pending", "chart-pending");
        } catch (error) {
          // A preview failure must not discard the model's completed answer.
          if (isCurrent(element)) {
            element.className = "visual-error";
            element.textContent = `Không dựng được ${diagram ? "sơ đồ" : "biểu đồ"}: ${error.message || error}`;
          }
        } finally {
          pending.delete(element);
        }
      })());
    }
    await Promise.all(tasks);
  }

  return { hydrate, dispose, renderChart, renderDiagram };
}
