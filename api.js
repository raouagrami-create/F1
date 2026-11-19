(function () {
  const DRIVERS_URL = "https://api.openf1.org/v1/drivers?session_key=latest";

  async function fetchDrivers() {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 12000);

    try {
      const response = await fetch(DRIVERS_URL, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`OpenF1 returned HTTP ${response.status}.`);
      }

      const drivers = await response.json();
      if (!Array.isArray(drivers) || drivers.length === 0) {
        throw new Error("OpenF1 did not return a driver list for the latest session.");
      }

      return drivers;
    } catch (error) {
      if (error.name === "AbortError") {
        throw new Error("The OpenF1 request timed out. Check your connection and try again.");
      }
      throw error;
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  window.F1Api = { fetchDrivers };
})();
