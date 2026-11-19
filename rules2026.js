(() => {
    const tabs = [...document.querySelectorAll('[role="tab"][aria-controls]')];
    const aeroButtons = [...document.querySelectorAll("[data-rules-aero]")];
    const aeroDiagram = document.querySelector(".rules-aero-diagram");
    const aeroLabel = document.querySelector("[data-rules-aero-label]");
    const aeroLabels = {
        straight: "Low drag • Straight",
        corner: "High downforce • Corner"
    };

    function activateTab(tab) {
        tabs.forEach((item) => {
            const active = item === tab;
            item.setAttribute("aria-selected", String(active));
            item.tabIndex = active ? 0 : -1;
            document.getElementById(item.getAttribute("aria-controls")).hidden = !active;
        });
        tab.focus();
    }

    tabs.forEach((tab, index) => {
        tab.addEventListener("click", () => activateTab(tab));
        tab.addEventListener("keydown", (event) => {
            let nextIndex;
            if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
            else if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
            else if (event.key === "Home") nextIndex = 0;
            else if (event.key === "End") nextIndex = tabs.length - 1;
            else return;
            event.preventDefault();
            activateTab(tabs[nextIndex]);
        });
    });

    if (aeroDiagram && aeroLabel) {
        aeroButtons.forEach((button) => {
            button.addEventListener("click", () => {
                const mode = button.dataset.rulesAero;
                if (!aeroLabels[mode]) return;

                aeroDiagram.dataset.aeroMode = mode;
                aeroLabel.textContent = aeroLabels[mode];
                aeroButtons.forEach((item) => {
                    item.setAttribute("aria-pressed", String(item === button));
                });
            });
        });
    }
})();