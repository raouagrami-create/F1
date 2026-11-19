(() => {
  const module = document.querySelector("[data-aero-module]");
  if (!module) return;

  const buttons = module.querySelectorAll("[data-aero-mode]");
  const status = module.querySelector("[data-aero-status]");
  const modeLabels = {
    straight: "Low drag • High speed • Straight Mode",
    corner: "High downforce • Corner Mode"
  };

  if (!buttons.length || !status) {
    console.error("Active aero module is missing its controls or status label.");
    return;
  }

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const mode = button.dataset.aeroMode;
      if (!modeLabels[mode]) return;

      module.dataset.mode = mode;
      status.textContent = modeLabels[mode];

      buttons.forEach((item) => {
        item.setAttribute("aria-pressed", String(item === button));
      });
    });
  });
})();
