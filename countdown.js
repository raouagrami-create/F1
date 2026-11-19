(() => {
    const section = document.querySelector("[data-race-countdown]");
    if (!section) return;

    const targetTime = Date.parse(section.dataset.target);
    const fields = {
        days: section.querySelector("[data-countdown-days]"),
        hours: section.querySelector("[data-countdown-hours]"),
        minutes: section.querySelector("[data-countdown-minutes]"),
        seconds: section.querySelector("[data-countdown-seconds]")
    };
    const status = section.querySelector("[data-countdown-status]");

    if (!Number.isFinite(targetTime) || Object.values(fields).some((field) => !field) || !status) {
        console.error("Race countdown is missing a valid target date or display element.");
        return;
    }

    const pad = (value) => String(value).padStart(2, "0");
    let timer = null;

    function updateCountdown() {
        const remaining = targetTime - Date.now();

        if (remaining <= 0) {
            Object.values(fields).forEach((field) => { field.textContent = "00"; });
            status.textContent = "LIGHTS OUT!";
            status.classList.add("is-lights-out");
            if (timer !== null) window.clearInterval(timer);
            return false;
        }

        const totalSeconds = Math.floor(remaining / 1000);
        fields.days.textContent = pad(Math.floor(totalSeconds / 86400));
        fields.hours.textContent = pad(Math.floor((totalSeconds % 86400) / 3600));
        fields.minutes.textContent = pad(Math.floor((totalSeconds % 3600) / 60));
        fields.seconds.textContent = pad(totalSeconds % 60);
        return true;
    }

    if (updateCountdown()) {
        timer = window.setInterval(updateCountdown, 1000);
    }
})();