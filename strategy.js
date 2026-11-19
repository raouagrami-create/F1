(() => {
  "use strict";

  const API_BASE = "https://api.openf1.org/v1";
  const TOP_DRIVER_COUNT = 10;
  const YEARS_TO_LOAD = 4;
  const REFRESH_INTERVAL = 15 * 60 * 1000;
  const AXIS_TICKS = [1, 10, 20, 30, 40, 50, 60, 70];
  const REQUEST_GAP = 350;

  const chart = document.querySelector("[data-strategy-chart]");
  const chartScroll = chart ? chart.closest(".strategy-chart-scroll") : null;
  const tooltip = document.querySelector("[data-strategy-tooltip]");
  const eventLabel = document.querySelector("[data-strategy-event]");
  const status = document.querySelector("[data-strategy-status]");
  const raceSelect = document.querySelector("[data-race-select]");
  const lapsStat = document.querySelector("[data-stat-laps]");
  const driversStat = document.querySelector("[data-stat-drivers]");
  const stopsStat = document.querySelector("[data-stat-stops]");

  const requiredElements = [
    chart,
    chartScroll,
    tooltip,
    eventLabel,
    status,
    raceSelect,
    lapsStat,
    driversStat,
    stopsStat
  ];

  if (requiredElements.some((element) => element === null)) {
    console.error("Strategy timeline is missing required page elements.");
    return;
  }

  const raceCache = new Map();
  let races = [];
  let selectedSessionKey = null;
  let followsLatestRace = true;
  let requestNumber = 0;
  let queuedRequest = Promise.resolve();
  let lastRequestTime = 0;

  function delay(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  function requestJson(path, parameters) {
    const query = new URLSearchParams(parameters);
    const url = `${API_BASE}/${path}?${query.toString()}`;
    const request = queuedRequest.catch(() => {}).then(async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const wait = Math.max(0, REQUEST_GAP - (Date.now() - lastRequestTime));
        if (wait > 0) await delay(wait);

        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 15000);
        let response;
        try {
          response = await fetch(url, { signal: controller.signal });
        } catch (error) {
          if (error.name === "AbortError") {
            throw new Error("OpenF1 request timed out. Please try again.");
          }
          throw new Error(`Could not connect to OpenF1: ${error.message}`);
        } finally {
          window.clearTimeout(timeout);
          lastRequestTime = Date.now();
        }

        if (response.status === 429 && attempt < 2) {
          const retryAfter = Number(response.headers.get("Retry-After"));
          await delay(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1200 * (attempt + 1));
          continue;
        }
        if (!response.ok) {
          throw new Error(`OpenF1 returned HTTP ${response.status} for ${path}.`);
        }

        const data = await response.json();
        if (!Array.isArray(data)) {
          throw new Error(`OpenF1 returned invalid ${path} data.`);
        }
        return data;
      }

      throw new Error("OpenF1 is rate-limiting requests. Please retry shortly.");
    });

    queuedRequest = request;
    return request;
  }

  async function getCompletedRaces() {
    const currentYear = new Date().getFullYear();
    const firstYear = Math.max(2023, currentYear - YEARS_TO_LOAD + 1);
    const yearRequests = [];

    for (let year = currentYear; year >= firstYear; year -= 1) {
      yearRequests.push(requestJson("sessions", { year, session_name: "Race" }));
    }

    const sessionLists = await Promise.all(yearRequests);
    const now = Date.now();

    return sessionLists.flat()
      .filter((race) =>
        race.session_key &&
        race.session_name === "Race" &&
        !race.is_cancelled &&
        Number.isFinite(Date.parse(race.date_end)) &&
        Date.parse(race.date_end) <= now
      )
      .sort((a, b) => Date.parse(b.date_start) - Date.parse(a.date_start));
  }

  function getFinishingOrder(positions, drivers) {
    const driverByNumber = new Map(
      drivers.map((driver) => [Number(driver.driver_number), driver])
    );
    const latestByDriver = new Map();

    positions.forEach((entry) => {
      const driverNumber = Number(entry.driver_number);
      const position = Number(entry.position);
      const timestamp = Date.parse(entry.date);
      if (!Number.isFinite(driverNumber) || !Number.isFinite(position)) return;

      const previous = latestByDriver.get(driverNumber);
      if (!previous || timestamp >= previous.timestamp) {
        latestByDriver.set(driverNumber, { position, timestamp });
      }
    });

    return [...latestByDriver.entries()]
      .map(([number, result]) => ({
        number,
        position: result.position,
        driver: driverByNumber.get(number)
      }))
      .filter((result) => result.driver)
      .sort((a, b) => a.position - b.position)
      .slice(0, TOP_DRIVER_COUNT)
      .map((result) => ({
        ...result,
        name: [result.driver.first_name, result.driver.last_name].filter(Boolean).join(" ") ||
          result.driver.full_name ||
          result.driver.broadcast_name ||
          `Driver ${result.number}`
      }));
  }

  async function getRaceData(race, { refresh = false } = {}) {
    if (!refresh && raceCache.has(race.session_key)) {
      return raceCache.get(race.session_key);
    }

    const [stints, positions, drivers, meetings] = await Promise.all([
      requestJson("stints", { session_key: race.session_key }),
      requestJson("position", { session_key: race.session_key }),
      requestJson("drivers", { session_key: race.session_key }),
      requestJson("meetings", { meeting_key: race.meeting_key })
    ]);

    if (stints.length === 0 || positions.length === 0 || drivers.length === 0) {
      throw new Error("OpenF1 has not published complete strategy data for this race yet.");
    }

    const finishers = getFinishingOrder(positions, drivers);
    const finishPositionByNumber = new Map(
      finishers.map((driver) => [driver.number, driver.position])
    );
    const raceStints = stints
      .filter((stint) => finishPositionByNumber.has(Number(stint.driver_number)))
      .map((stint) => ({
        driverNumber: Number(stint.driver_number),
        compound: String(stint.compound || "UNKNOWN").toUpperCase(),
        start: Number(stint.lap_start),
        end: Number(stint.lap_end),
        stintNumber: Number(stint.stint_number)
      }))
      .filter((stint) =>
        Number.isFinite(stint.start) &&
        Number.isFinite(stint.end) &&
        stint.end >= stint.start
      );

    if (raceStints.length === 0) {
      throw new Error("OpenF1 has no usable tyre stints for the top ten in this race.");
    }

    const driversWithStints = finishers.map((finisher) => ({
      number: finisher.number,
      position: finisher.position,
      name: finisher.name,
      stints: raceStints
        .filter((stint) => stint.driverNumber === finisher.number)
        .sort((a, b) => a.stintNumber - b.stintNumber || a.start - b.start)
    })).filter((driver) => driver.stints.length > 0);

    if (driversWithStints.length === 0) {
      throw new Error("No top-ten drivers have published tyre stints for this race.");
    }

    const meeting = meetings[0];
    const raceName = meeting?.meeting_name ||
      `${race.circuit_short_name || "Formula 1"} Grand Prix`;
    const raceLaps = Math.max(...raceStints.map((stint) => stint.end));
    const raceData = {
      race,
      name: raceName,
      country: meeting?.country_name || race.country_name || "",
      laps: raceLaps,
      drivers: driversWithStints,
      stops: driversWithStints.reduce(
        (total, driver) => total + Math.max(0, driver.stints.length - 1),
        0
      )
    };

    raceCache.set(race.session_key, raceData);
    return raceData;
  }

  function hideTooltip() {
    tooltip.hidden = true;
  }

  function showTooltip(stint, bar, pointerEvent) {
    const stintLength = stint.end - stint.start + 1;
    tooltip.textContent = `Lap ${stint.start}-${stint.end} • ${stint.compound} • ${stintLength} laps`;
    tooltip.hidden = false;

    const scrollRect = chartScroll.getBoundingClientRect();
    const barRect = bar.getBoundingClientRect();
    const x = pointerEvent
      ? pointerEvent.clientX - scrollRect.left
      : barRect.left - scrollRect.left + barRect.width / 2;
    const y = pointerEvent
      ? pointerEvent.clientY - scrollRect.top - 42
      : barRect.top - scrollRect.top - 42;
    const maxLeft = chartScroll.clientWidth - tooltip.offsetWidth - 8;
    tooltip.style.left = `${Math.max(8, Math.min(x + 10, maxLeft))}px`;
    tooltip.style.top = `${Math.max(8, y)}px`;
  }

  function getLapTicks(totalLaps) {
    return [...new Set([1, ...AXIS_TICKS.filter((lap) => lap < totalLaps), totalLaps])];
  }

  function makeAxis(totalLaps) {
    const row = document.createElement("div");
    row.className = "strategy-axis-row";

    const heading = document.createElement("span");
    heading.className = "strategy-driver-label strategy-axis-label";
    heading.textContent = "FINISH / DRIVER";
    row.append(heading);

    const track = document.createElement("div");
    track.className = "strategy-track strategy-axis";
    const ticks = getLapTicks(totalLaps);

    ticks.forEach((lap, index) => {
      const tick = document.createElement("span");
      tick.className = "strategy-axis-tick";
      if (index === ticks.length - 1) tick.classList.add("is-last");
      tick.style.left = `${((lap - 1) / totalLaps) * 100}%`;
      tick.textContent = String(lap);
      track.append(tick);
    });

    row.append(track);
    return row;
  }

  function makeStintBar(driver, stint, index, totalLaps) {
    const bar = document.createElement("button");
    const stintLength = stint.end - stint.start + 1;
    const description = `Lap ${stint.start}-${stint.end} • ${stint.compound} • ${stintLength} laps`;
    const gap = index > 0 ? 4 : 0;

    bar.type = "button";
    bar.className = `strategy-stint compound-${stint.compound.toLowerCase()}`;
    bar.style.left = `calc(${((stint.start - 1) / totalLaps) * 100}% + ${gap}px)`;
    bar.style.width = `calc(${(stintLength / totalLaps) * 100}% - ${gap}px)`;
    bar.setAttribute("aria-label", `${driver.name}: ${description}`);
    bar.title = description;
    bar.addEventListener("pointerenter", (event) => showTooltip(stint, bar, event));
    bar.addEventListener("pointermove", (event) => showTooltip(stint, bar, event));
    bar.addEventListener("pointerleave", hideTooltip);
    bar.addEventListener("focus", () => showTooltip(stint, bar));
    bar.addEventListener("blur", hideTooltip);
    return bar;
  }

  function makeDriverRow(driver, totalLaps) {
    const row = document.createElement("div");
    row.className = "strategy-driver-row";

    const label = document.createElement("span");
    label.className = "strategy-driver-label";
    label.textContent = `${driver.position}. ${driver.name}`;
    row.append(label);

    const track = document.createElement("div");
    track.className = "strategy-track";

    getLapTicks(totalLaps).forEach((lap) => {
      const line = document.createElement("span");
      line.className = "strategy-grid-line";
      line.style.left = `${((lap - 1) / totalLaps) * 100}%`;
      line.setAttribute("aria-hidden", "true");
      track.append(line);
    });

    driver.stints.forEach((stint, index) => {
      track.append(makeStintBar(driver, stint, index, totalLaps));
    });
    row.append(track);
    return row;
  }

  function renderRace(raceData) {
    const fragment = document.createDocumentFragment();
    fragment.append(makeAxis(raceData.laps));
    raceData.drivers.forEach((driver) => {
      fragment.append(makeDriverRow(driver, raceData.laps));
    });
    chart.replaceChildren(fragment);

    eventLabel.textContent =
      `${raceData.race.year} · ${raceData.name}` +
      `${raceData.country ? ` · ${raceData.country}` : ""} · ${raceData.laps} LAPS`;
    lapsStat.textContent = String(raceData.laps);
    driversStat.textContent = String(raceData.drivers.length);
    stopsStat.textContent = String(raceData.stops);
    chart.setAttribute(
      "aria-label",
      `Top ${raceData.drivers.length} finishers' tyre stints at the ${raceData.name}`
    );
    selectedSessionKey = raceData.race.session_key;
    raceSelect.value = String(selectedSessionKey);
    status.textContent = `Race data loaded from OpenF1 · Updated ${new Date().toLocaleTimeString()}.`;
    status.classList.remove("is-error");
  }

  function updateRaceOptions(raceList) {
    const selectedValue = raceSelect.value || String(selectedSessionKey || "");
    const options = raceList.map((race) => {
      const option = document.createElement("option");
      option.value = String(race.session_key);
      option.textContent =
        `${race.year} · ${race.circuit_short_name || race.country_name || "Grand Prix"}`;
      return option;
    });

    raceSelect.replaceChildren(...options);
    raceSelect.disabled = options.length === 0;
    if (raceList.some((race) => String(race.session_key) === selectedValue)) {
      raceSelect.value = selectedValue;
    }
  }

  async function loadRace(race, { quiet = false, refresh = false } = {}) {
    const currentRequest = ++requestNumber;
    if (!quiet) {
      status.textContent = `Loading ${race.circuit_short_name || "race"} data from OpenF1…`;
      status.classList.remove("is-error");
    }

    try {
      const raceData = await getRaceData(race, { refresh });
      if (currentRequest !== requestNumber) return;
      renderRace(raceData);
      if (quiet && race.session_key !== races[0]?.session_key) {
        status.textContent = `Showing the latest race with complete tyre data. Updated ${new Date().toLocaleTimeString()}.`;
      }
    } catch (error) {
      if (currentRequest !== requestNumber) return;
      console.error(`Could not load race ${race.session_key}:`, error);
      status.textContent = `Could not load race data: ${error.message}`;
      status.classList.add("is-error");
    }
  }

  async function initialize() {
    status.textContent = "Finding the latest completed Grand Prix…";

    try {
      races = await getCompletedRaces();
      if (races.length === 0) {
        throw new Error("No completed races were found in the OpenF1 calendar.");
      }

      updateRaceOptions(races);
      let raceData = null;
      let lastError = null;

      for (const race of races) {
        try {
          raceData = await getRaceData(race);
          break;
        } catch (error) {
          lastError = error;
          console.warn(`Strategy data is not available for session ${race.session_key}: ${error.message}`);
        }
      }

      if (!raceData) {
        throw lastError || new Error("No completed race has published tyre data yet.");
      }

      followsLatestRace = raceData.race.session_key === races[0].session_key;
      renderRace(raceData);
      if (!followsLatestRace) {
        status.textContent = "Showing the latest race with complete tyre data. A newer race may not have published results yet.";
      }
    } catch (error) {
      console.error("Could not initialize the strategy timeline:", error);
      eventLabel.textContent = "RACE DATA UNAVAILABLE";
      status.textContent = `Could not load race data: ${error.message}`;
      status.classList.add("is-error");
      raceSelect.replaceChildren(new Option("Race data unavailable", ""));
      raceSelect.disabled = true;
    }
  }

  raceSelect.addEventListener("change", () => {
    const race = races.find((item) => String(item.session_key) === raceSelect.value);
    if (!race) return;

    followsLatestRace = race.session_key === races[0]?.session_key;
    loadRace(race);
  });

  async function refreshRaceCalendar() {
    try {
      races = await getCompletedRaces();
      if (races.length === 0) return;

      updateRaceOptions(races);
      if (!followsLatestRace) return;

      const latestRace = races[0];
      await loadRace(latestRace, { quiet: true, refresh: true });
    } catch (error) {
      console.error("Could not refresh the race calendar:", error);
      status.textContent = `Could not refresh race data: ${error.message}`;
      status.classList.add("is-error");
    }
  }

  initialize();
  window.setInterval(refreshRaceCalendar, REFRESH_INTERVAL);
})();
