
const API_BASE = "https://api.open-meteo.com/v1/forecast";
const GEO_BASE = "https://geocoding-api.open-meteo.com/v1/search";

const $ = (selector) => document.querySelector(selector);

const form = $("#weather-form");
const cityInput = $("#city-input");
const suggestionsBox = $("#suggestions");
const status = $("#status");
const weatherResult = $("#weather-result");
const forecastContainer = $("#five-day-forecast");
const chartCanvas = $("#hourly-chart");
const themeToggle = $("#theme-toggle");
const forecastSection = $("#forecast");
const hourlySection = $("#hourly-section");
const skyOpenButton = $("#sky-open");
const weatherOverlay = $("#weather-overlay");
const overlayScene = $("#overlay-scene");
const overlayClose = weatherOverlay.querySelector(".overlay-close");
let overlayReturnFocus = null;

let selectedLocation = null;
let forecastData = null;
let searchTimer = null;
let searchController = null;
let forecastController = null;
let searchVersion = 0;
let cityTimezone = "UTC";
let selectedForecastDay = 0;
let localClockTimer = null;

const introScenes = [
    ["i-sun", "A little sunshine, wherever you are."],
    ["i-cloud", "Every cloud has a silver lining."],
    ["i-rain", "A fresh start, in every raindrop."],
    ["i-storm", "The sky has a story to tell."],
    ["i-snow", "A little wonder in the weather."],
    ["i-partly", "A brighter view is just ahead."],
    ["i-fog", "Take a breath. Find your horizon."]
];
let introIndex = 0;
function showIntroScene() {
    const [icon, caption] = introScenes[introIndex++ % introScenes.length];
    $("#intro-sky").innerHTML = `<svg><use href="#${icon}"/></svg>`;
    $("#intro-caption").textContent = caption;
}
showIntroScene();
const introTimer = window.setInterval(showIntroScene, 390);
window.setTimeout(() => {
    window.clearInterval(introTimer);
    $("#intro").classList.add("is-gone");
    window.setTimeout(() => $("#intro")?.remove(), 800);
}, 2780);

function setDarkMode(enabled, save = true) {
    document.body.dataset.mode = enabled ? "dark" : "light";
    themeToggle.setAttribute("aria-label", enabled ? "Switch to light mode" : "Switch to dark mode");
    themeToggle.title = enabled ? "Switch to light mode" : "Switch to dark mode";
    themeToggle.querySelector("span").textContent = enabled ? "Light mode" : "Dark mode";
    themeToggle.querySelector("use").setAttribute("href", enabled ? "#i-sun" : "#i-moon");
    document.querySelector('meta[name="theme-color"]').content = enabled ? "#202a2c" : "#f2eee6";
    if (save) {
        try { localStorage.setItem("brightersight-theme", enabled ? "dark" : "light"); } catch { /* Storage may be disabled. */ }
    }
    if (forecastData) displayHourlyChart(selectedForecastDay);
}

let savedTheme = null;
try { savedTheme = localStorage.getItem("brightersight-theme"); } catch { /* Use the device setting. */ }
setDarkMode(savedTheme ? savedTheme === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches, false);
themeToggle.addEventListener("click", () => setDarkMode(document.body.dataset.mode !== "dark"));

function openWeatherOverlay({ title, kicker, description, facts, weatherCode, sky = document.body.dataset.sky, moonPhase = 0.5 }) {
    overlayReturnFocus = document.activeElement;
    const theme = weatherTheme(weatherCode);
    overlayScene.dataset.sky = sky || "day";
    overlayScene.dataset.condition = theme;
    overlayScene.dataset.time = document.body.dataset.time || "noon";
    overlayScene.dataset.mode = document.body.dataset.mode || "light";
    const phaseCosine = Math.cos(2 * Math.PI * moonPhase);
    const shadowCenter = moonPhase <= 0.5
        ? 50 - (1 - phaseCosine) * 39
        : 50 + (1 - phaseCosine) * 39;
    overlayScene.style.setProperty("--moon-shadow-x", `${Math.max(-29, Math.min(129, shadowCenter))}%`);
    overlayScene.querySelector(".scene-condition use").setAttribute("href", `#${weatherIcon(weatherCode)}`);
    $("#overlay-kicker").textContent = kicker;
    $("#overlay-title").textContent = title;
    $("#overlay-description").textContent = description;
    const factContainer = $("#overlay-facts");
    factContainer.replaceChildren();
    facts.forEach(([label, value]) => {
        const item = document.createElement("div");
        const name = document.createElement("span");
        const detail = document.createElement("strong");
        name.textContent = label;
        detail.textContent = value;
        item.append(name, detail);
        factContainer.append(item);
    });
    weatherOverlay.showModal();
}

function openSkyView() {
    if (!forecastData || !selectedLocation) {
        openWeatherOverlay({
            title: "Your sky is almost ready", kicker: "A LITTLE LOOK OUTSIDE",
            description: "Search for a city to bring its real sky to life here.",
            facts: [["WEATHER", "Waiting for a city"], ["LOCAL TIME", "—"]], weatherCode: 0
        });
        return;
    }
    const current = forecastData.current;
    const phase = Number(forecastData.daily.moon_phase?.[0] ?? 0.5);
    const localTime = new Intl.DateTimeFormat("en", {
        timeZone: cityTimezone, weekday: "long", hour: "numeric", minute: "2-digit"
    }).format(new Date());
    openWeatherOverlay({
        title: `${selectedLocation.name}, ${selectedLocation.country || ""}`.replace(/,\s*$/, ""),
        kicker: "THE SKY, RIGHT NOW",
        description: `${describeWeather(current.weather_code)} · ${Math.round(current.temperature_2m)}°C. Take a moment beneath the ${document.body.dataset.sky === "night" ? "night" : "day"} sky.`,
        facts: [["LOCAL TIME", localTime], ["TIME ZONE", cityTimezone.replaceAll("_", " ")], ["MOON", moonPhaseName(phase)]],
        weatherCode: current.weather_code, moonPhase: phase
    });
}

skyOpenButton.addEventListener("click", openSkyView);
overlayClose.addEventListener("click", () => weatherOverlay.close());
weatherOverlay.addEventListener("click", (event) => {
    if (event.target === weatherOverlay) weatherOverlay.close();
});
weatherOverlay.addEventListener("close", () => overlayReturnFocus?.focus());

// Convert Open-Meteo weather codes into readable descriptions.
function describeWeather(code) {
    if (code === 0) return "Clear sky";
    if (code === 1) return "Mainly clear";
    if (code === 2) return "Partly cloudy";
    if (code === 3) return "Overcast";
    if ([45, 48].includes(code)) return "Fog";
    if ([51, 53, 55, 56, 57].includes(code)) return "Drizzle";
    if ([61, 63, 65, 66, 67].includes(code)) return "Rain";
    if ([71, 73, 75, 77].includes(code)) return "Snow";
    if ([80, 81, 82].includes(code)) return "Rain showers";
    if ([85, 86].includes(code)) return "Snow showers";
    if ([95, 96, 99].includes(code)) return "Thunderstorm";
    return "Conditions unavailable";
}

// Format a date/time returned by the API.
function formatTime(time) {
    const localClock = String(time).match(/T(\d{2}):(\d{2})/);
    return localClock ? `${localClock[1]}:${localClock[2]}` : "—";
}

function formatDate(date) {
    return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-ZA", {
        weekday: "short",
        day: "numeric",
        month: "short",
        timeZone: "UTC"
    });
}

function formatDay(date, timezone = cityTimezone) {
    const todayParts = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(new Date());
    const today = `${todayParts.find((part) => part.type === "year").value}-${todayParts.find((part) => part.type === "month").value}-${todayParts.find((part) => part.type === "day").value}`;
    const tomorrowDate = new Date(`${today}T12:00:00Z`);
    tomorrowDate.setUTCDate(tomorrowDate.getUTCDate() + 1);
    const tomorrow = tomorrowDate.toISOString().slice(0, 10);

    if (date === today) return "Today";
    if (date === tomorrow) return "Tomorrow";
    return formatDate(date);
}

// Fetch JSON and handle failed requests.
async function fetchJSON(url, signal) {
    const response = await fetch(url, { signal });

    if (!response.ok) {
        throw new Error(`Weather service error: ${response.status}`);
    }

    return response.json();
}

// Predictive search: find matching cities while the user types.
cityInput.addEventListener("input", () => {
    clearTimeout(searchTimer);

    const version = ++searchVersion;
    const query = cityInput.value.trim();

    selectedLocation = null;

    if (searchController) {
        searchController.abort();
    }

    if (query.length < 2) {
        suggestionsBox.replaceChildren();
        suggestionsBox.hidden = true;
        return;
    }

    searchTimer = setTimeout(() => {
        searchCities(query, version);
    }, 90);
});

async function searchCities(query, version) {
    const controller = new AbortController();
    searchController = controller;

    const params = new URLSearchParams({
        name: query,
        count: "6",
        language: "en",
        format: "json"
    });

    try {
        const data = await fetchJSON(
            `${GEO_BASE}?${params}`,
            controller.signal
        );

        // Ignore outdated results from an earlier search.
        if (version !== searchVersion) return;

        showSuggestions(data.results || []);
    } catch (error) {
        if (error.name !== "AbortError" && version === searchVersion) {
            suggestionsBox.replaceChildren();
            suggestionsBox.hidden = true;
        }
    }
}

function showSuggestions(places) {
    suggestionsBox.replaceChildren();

    if (places.length === 0) {
        const empty = document.createElement("div");
        empty.textContent = "No matching cities found";
        empty.className = "suggestion-item";
        suggestionsBox.appendChild(empty);
        suggestionsBox.hidden = false;
        return;
    }

    places.forEach((place) => {
        const button = document.createElement("button");

        button.type = "button";
        button.className = "suggestion-item";
        button.setAttribute("role", "option");
        button.setAttribute("aria-selected", "false");

        const details = [
            place.admin1,
            place.country
        ].filter(Boolean).join(", ");

        button.textContent = details
            ? `${place.name} — ${details}`
            : place.name;

        button.addEventListener("click", () => {
            selectedLocation = place;
            cityInput.value = place.name;
            suggestionsBox.hidden = true;
            suggestionsBox.replaceChildren();

            loadWeather(place);
        });

        suggestionsBox.appendChild(button);
    });

    suggestionsBox.hidden = false;
}

// Submit the search form.
form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const query = cityInput.value.trim();

    if (!query) return;

    // Use the chosen suggestion when it matches the input.
    if (
        selectedLocation &&
        selectedLocation.name.toLowerCase() === query.toLowerCase()
    ) {
        await loadWeather(selectedLocation);
        return;
    }

    // Otherwise resolve the typed city.
    clearTimeout(searchTimer);
    ++searchVersion;

    if (searchController) searchController.abort();

    try {
        status.textContent = "Searching for location...";

        const params = new URLSearchParams({
            name: query,
            count: "10",
            language: "en",
            format: "json"
        });

        const data = await fetchJSON(`${GEO_BASE}?${params}`);

        if (!data.results?.length) {
            throw new Error("City not found. Try another spelling.");
        }

        // If multiple places share the name, show the choices.
        if (data.results.length > 1) {
            showSuggestions(data.results);
            status.textContent = "Choose the correct location.";
            return;
        }

        selectedLocation = data.results[0];
        cityInput.value = selectedLocation.name;
        suggestionsBox.hidden = true;

        await loadWeather(selectedLocation);
    } catch (error) {
        status.textContent = error.message;
    }
});

// Retrieve current weather, hourly temperatures and five daily forecasts.
async function loadWeather(place) {
    if (forecastController) forecastController.abort();

    const controller = new AbortController();
    forecastController = controller;

    const { latitude, longitude } = place;

    const params = new URLSearchParams({
        latitude: latitude,
        longitude: longitude,
        timezone: "auto",
        forecast_days: "5",
        current: [
            "temperature_2m",
            "relative_humidity_2m",
            "apparent_temperature",
            "weather_code",
            "wind_speed_10m",
            "is_day"
        ].join(","),
        hourly: [
            "temperature_2m",
            "weather_code"
        ].join(","),
        daily: [
            "weather_code",
            "temperature_2m_max",
            "temperature_2m_min",
            "precipitation_probability_max",
            "sunrise",
            "sunset",
            "moonrise",
            "moonset",
            "moon_phase"
        ].join(",")
    });

    try {
        status.textContent = "Loading weather...";
        weatherResult.hidden = true;
        forecastSection.hidden = true;
        hourlySection.hidden = true;

        const data = await fetchJSON(
            `${API_BASE}?${params}`,
            controller.signal
        );

        // Do not let an old request replace a newer selection.
        if (controller.signal.aborted) return;

        forecastData = data;
        selectedLocation = place;
        cityTimezone = data.timezone || "UTC";

        displayCurrentWeather(place, data.current, data.daily);
        displayFiveDayForecast(data.daily);

        weatherResult.hidden = false;
        forecastSection.hidden = false;
        hourlySection.hidden = false;
        status.textContent = `Updated for ${place.name}.`;

        // The graph initially shows today's hourly temperatures.
        displayHourlyChart(0);
        if (localClockTimer) clearInterval(localClockTimer);
        localClockTimer = window.setInterval(updateLocalClock, 30_000);
    } catch (error) {
        if (error.name === "AbortError") return;

        status.textContent = error.message;
    }
}

// Display the current conditions.
function displayCurrentWeather(place, current, daily) {
    $("#city-name").textContent =
        `${place.name}, ${place.country || ""}`;

    $("#temperature").textContent =
        Math.round(current.temperature_2m);

    $("#description").textContent =
        describeWeather(current.weather_code);

    $("#feels-like").textContent =
        Math.round(current.apparent_temperature);

    $("#humidity").textContent =
        current.relative_humidity_2m;

    $("#wind").textContent =
        current.wind_speed_10m;

    $("#feels-detail").textContent = Math.round(current.apparent_temperature);
    const condition = describeWeather(current.weather_code);
    $("#condition-art use").setAttribute("href", `#${weatherIcon(current.weather_code)}`);
    $("#local-clock").textContent = new Intl.DateTimeFormat("en", {
        timeZone: cityTimezone,
        weekday: "long",
        hour: "numeric",
        minute: "2-digit"
    }).format(new Date());
    $("#timezone-label").textContent = cityTimezone.replaceAll("_", " ");
    document.body.dataset.weather = weatherTheme(current.weather_code);
    updateTimeTheme();
    updateSkyIllustration(current, daily);
    $("#dayline-text").textContent = `${condition} · local conditions`;
}

function updateSkyIllustration(current, daily) {
    const sunrise = daily.sunrise?.[0];
    const sunset = daily.sunset?.[0];
    const localParts = new Intl.DateTimeFormat("en-GB", {
        timeZone: cityTimezone,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23"
    }).formatToParts(new Date());
    const nowMinutes = Number(localParts.find((part) => part.type === "hour").value) * 60 +
        Number(localParts.find((part) => part.type === "minute").value);
    const riseMinutes = minutesOf(sunrise);
    const setMinutes = minutesOf(sunset);
    const sunUp = Number(current.is_day) === 1 || (current.is_day == null && riseMinutes >= 0 &&
        riseMinutes <= nowMinutes && nowMinutes < setMinutes);

    document.body.dataset.sky = sunUp ? "day" : "night";
    const phaseValue = daily.moon_phase?.[0];
    const phase = Number.isFinite(phaseValue) ? phaseValue : 0.5;
    const moonUp = moonIsUp(daily.moonrise?.[0], daily.moonset?.[0], nowMinutes);
    const shownPhase = moonUp ? phase : 0.5;
    const cosine = Math.cos(2 * Math.PI * shownPhase);
    const shadowCenter = shownPhase <= 0.5
        ? 50 - (1 - cosine) * 39
        : 50 + (1 - cosine) * 39;
    $("#moon-shadow").setAttribute("cx", Math.max(-29, Math.min(129, shadowCenter)).toFixed(2));

    const isClear = current.weather_code === 0;
    const conditionIcon = $("#sky-condition");
    const skyIcon = !sunUp && [1, 2].includes(current.weather_code)
        ? "i-cloud"
        : weatherIcon(current.weather_code);
    conditionIcon.querySelector("use").setAttribute("href", `#${skyIcon}`);
    conditionIcon.classList.toggle("is-clear", isClear);
    document.body.dataset.skyCondition = isClear ? "clear" : weatherTheme(current.weather_code);
    $("#sky-caption-time").textContent = sunUp ? "DAYLIGHT" : moonUp ? moonPhaseName(phase).toUpperCase() : "MOONLIGHT";
    $("#sky-caption-weather").textContent = describeWeather(current.weather_code).toUpperCase();
}

function minutesOf(value) {
    const match = String(value || "").match(/T(\d{2}):(\d{2})/);
    return match ? Number(match[1]) * 60 + Number(match[2]) : -1;
}

function moonIsUp(rise, set, now) {
    const riseAt = minutesOf(rise);
    const setAt = minutesOf(set);
    if (riseAt < 0 || setAt < 0) return false;
    return riseAt <= setAt ? now >= riseAt && now < setAt : now >= riseAt || now < setAt;
}

function moonPhaseName(phase) {
    if (phase < 0.04 || phase >= 0.96) return "New moon";
    if (phase < 0.21) return "Waxing crescent";
    if (phase < 0.29) return "First quarter";
    if (phase < 0.46) return "Waxing gibbous";
    if (phase < 0.54) return "Full moon";
    if (phase < 0.71) return "Waning gibbous";
    if (phase < 0.79) return "Last quarter";
    return "Waning crescent";
}

// Display five days, starting today.
function displayFiveDayForecast(daily) {
    forecastContainer.replaceChildren();
    selectedForecastDay = 0;

    daily.time.forEach((date, index) => {
        const card = document.createElement("button");

        card.type = "button";
        card.className = "forecast-card";
        card.setAttribute("aria-pressed", index === 0 ? "true" : "false");

        const day = document.createElement("span");
        day.className = "forecast-day-name";
        day.textContent = formatDay(date, cityTimezone);

        const dateLabel = document.createElement("span");
        dateLabel.className = "forecast-date-label";
        dateLabel.textContent = formatDate(date);

        const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        icon.classList.add("forecast-weather-icon");
        const iconUse = document.createElementNS("http://www.w3.org/2000/svg", "use");
        iconUse.setAttribute("href", `#${weatherIcon(daily.weather_code[index])}`);
        icon.append(iconUse);

        const description = document.createElement("p");
        description.className = "forecast-description";
        description.textContent = describeWeather(daily.weather_code[index]);

        const temperatures = document.createElement("p");
        temperatures.className = "forecast-temperatures";
        const high = document.createElement("strong");
        high.textContent = `${Math.round(daily.temperature_2m_max[index])}°`;
        const low = document.createElement("span");
        low.textContent = `${Math.round(daily.temperature_2m_min[index])}°`;
        temperatures.append(high, low);

        const rain = document.createElement("p");
        rain.className = "forecast-rain";
        rain.textContent = `Rain chance · ${daily.precipitation_probability_max[index] ?? "N/A"}%`;

        card.append(day, dateLabel, icon, description, temperatures, rain);

        card.addEventListener("click", () => {
            forecastContainer.querySelectorAll(".forecast-card")
                .forEach((item) => {
                    item.setAttribute("aria-pressed", "false");
                });

            card.setAttribute("aria-pressed", "true");
            selectedForecastDay = index;
            displayHourlyChart(index);
            openWeatherOverlay({
                title: `${formatDay(date, cityTimezone)} in ${selectedLocation?.name || "your city"}`,
                kicker: "A LITTLE LOOK AHEAD",
                description: `${describeWeather(daily.weather_code[index])} expected, with a high of ${Math.round(daily.temperature_2m_max[index])}°C and a low of ${Math.round(daily.temperature_2m_min[index])}°C.`,
                facts: [["RAIN CHANCE", `${daily.precipitation_probability_max[index] ?? "—"}%`], ["SUNRISE", formatTime(daily.sunrise?.[index])], ["SUNSET", formatTime(daily.sunset?.[index])]],
                weatherCode: daily.weather_code[index], sky: "day", moonPhase: Number(daily.moon_phase?.[index] ?? 0.5)
            });
        });

        forecastContainer.appendChild(card);
    });
}

// Draw a responsive, custom SVG temperature curve for the selected local day.
function displayHourlyChart(dayIndex) {
    if (!forecastData || !chartCanvas) {
        return;
    }

    const { hourly, daily } = forecastData;
    selectedForecastDay = dayIndex;

    const selectedDate = daily.time[dayIndex];

    const readings = hourly.time
        .map((time, index) => ({
            time,
            temperature: hourly.temperature_2m[index],
            date: time.slice(0, 10)
        }))
        .filter((reading) => reading.date === selectedDate);

    const styles = getComputedStyle(document.body);
    const ink = styles.getPropertyValue("--ink").trim();
    const muted = styles.getPropertyValue("--muted").trim();
    const accent = styles.getPropertyValue("--accent").trim();
    const line = styles.getPropertyValue("--line").trim();
    if (!readings.length) return;

    const width = 1000;
    const height = 340;
    const left = 70;
    const right = 28;
    const top = 35;
    const bottom = 270;
    const minTemp = Math.floor(Math.min(...readings.map((reading) => reading.temperature)) - 2);
    const maxTemp = Math.ceil(Math.max(...readings.map((reading) => reading.temperature)) + 2);
    const tempRange = Math.max(4, maxTemp - minTemp);
    const points = readings.map((reading, index) => ({
        x: left + index * (width - left - right) / Math.max(1, readings.length - 1),
        y: bottom - (reading.temperature - minTemp) / tempRange * (bottom - top),
        ...reading
    }));
    let curve = `M ${points[0].x} ${points[0].y}`;
    for (let index = 0; index < points.length - 1; index += 1) {
        const previous = points[Math.max(0, index - 1)];
        const start = points[index];
        const end = points[index + 1];
        const next = points[Math.min(points.length - 1, index + 2)];
        const c1x = start.x + (end.x - previous.x) / 6;
        const c1y = start.y + (end.y - previous.y) / 6;
        const c2x = end.x - (next.x - start.x) / 6;
        const c2y = end.y - (next.y - start.y) / 6;
        curve += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${end.x} ${end.y}`;
    }
    const area = `${curve} L ${points[points.length - 1].x} ${bottom} L ${points[0].x} ${bottom} Z`;
    const horizontalGrid = Array.from({ length: 5 }, (_, index) => {
        const y = top + index * (bottom - top) / 4;
        const value = Math.round(maxTemp - index * tempRange / 4);
        return `<path class="graph-grid-line" d="M ${left} ${y} H ${width - right}"/><text class="graph-y-label" x="${left - 14}" y="${y + 4}" text-anchor="end">${value}°</text>`;
    }).join("");
    const labelEvery = readings.length > 16 ? 3 : readings.length > 8 ? 2 : 1;
    const timeLabels = points.map((point, index) => {
        if (index % labelEvery !== 0 && index !== points.length - 1) return "";
        return `<text class="graph-x-label" x="${point.x}" y="${bottom + 29}" text-anchor="middle">${formatTime(point.time)}</text>`;
    }).join("");
    const markers = points.map((point) => `<g class="graph-point"><title>${formatTime(point.time)} · ${Math.round(point.temperature)}°C</title><circle class="graph-point-glow" cx="${point.x}" cy="${point.y}" r="10"/><circle class="graph-point-core" cx="${point.x}" cy="${point.y}" r="3.5"/></g>`).join("");
    const skyMark = document.body.dataset.sky === "night"
        ? `<g class="graph-moonmark" transform="translate(${width - 39} 18)"><circle cx="0" cy="0" r="7"/><circle class="graph-moon-cutout" cx="4" cy="-3" r="6"/></g>`
        : `<g class="graph-sunmark" transform="translate(${width - 39} 18)"><circle cx="0" cy="0" r="5"/><path d="M0 -9v-3m0 24v-3m-9-9h-3m24 0h-3m-15-6-2-2m17 17-2-2m0-13 2-2m-17 17 2-2"/></g>`;

    const locationLabel = escapeHtml(selectedLocation?.name || "selected location");
    chartCanvas.innerHTML = `<svg class="temperature-graph" viewBox="0 0 ${width} ${height}" role="img" aria-label="Hourly temperatures for ${formatDay(selectedDate, cityTimezone)} in ${locationLabel}">
        <defs><linearGradient id="temperature-wash" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="${accent}" stop-opacity=".25"/><stop offset="100%" stop-color="${accent}" stop-opacity="0"/></linearGradient></defs>
        <text class="graph-title" x="${left}" y="18">${formatDay(selectedDate, cityTimezone)} · A little rise &amp; fall</text>
        ${horizontalGrid}
        <path class="graph-area" d="${area}" fill="url(#temperature-wash)"/>
        <path class="graph-line" d="${curve}" stroke="${accent}"/>
        ${markers}
        ${timeLabels}
        ${skyMark}
        <text class="graph-caption" x="${left}" y="${height - 5}">LOCAL TIME</text>
        <text class="graph-caption" x="${width - right}" y="${height - 5}" text-anchor="end">TEMPERATURE · °C</text>
    </svg>`;
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);
}

function updateLocalClock() {
    $("#local-clock").textContent = new Intl.DateTimeFormat("en", {
        timeZone: cityTimezone,
        weekday: "long",
        hour: "numeric",
        minute: "2-digit"
    }).format(new Date());
    updateTimeTheme();
    if (forecastData?.current && forecastData?.daily) {
        updateSkyIllustration(forecastData.current, forecastData.daily);
    }
}

function weatherIcon(code) {
    if (code === 0) return "i-sun";
    if (code === 1 || code === 2) return "i-partly";
    if ([45, 48].includes(code)) return "i-fog";
    if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "i-rain";
    if ([71, 73, 75, 77, 85, 86].includes(code)) return "i-snow";
    if ([95, 96, 99].includes(code)) return "i-storm";
    return "i-cloud";
}

function weatherTheme(code) {
    if (code === 0 || code === 1) return "clear";
    if ([45, 48].includes(code)) return "fog";
    if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "rain";
    if ([71, 73, 75, 77, 85, 86].includes(code)) return "snow";
    if ([95, 96, 99].includes(code)) return "storm";
    return "cloud";
}

function updateTimeTheme() {
    const hour = Number(new Intl.DateTimeFormat("en-GB", {
        timeZone: cityTimezone,
        hour: "2-digit",
        hourCycle: "h23"
    }).format(new Date()));
    const timeTheme = hour >= 5 && hour < 7 ? "sunrise"
        : hour >= 7 && hour < 11 ? "morning"
        : hour >= 11 && hour < 14 ? "noon"
        : hour >= 14 && hour < 17 ? "afternoon"
        : hour >= 17 && hour < 19 ? "sunset" : "night";
    document.body.dataset.time = timeTheme;
    document.querySelectorAll(".moment").forEach((moment) => {
        moment.classList.toggle("is-current", moment.dataset.moment === timeTheme);
    });
}

// Hide suggestions when the user clicks elsewhere.
document.addEventListener("click", (event) => {
    if (
        !cityInput.contains(event.target) &&
        !suggestionsBox.contains(event.target)
    ) {
        suggestionsBox.hidden = true;
    }
});

// Load an example location on startup.
(async function initialiseWeather() {
    try {
        const params = new URLSearchParams({
            name: "Cape Town",
            count: "1",
            language: "en",
            format: "json"
        });

        const data = await fetchJSON(`${GEO_BASE}?${params}`);

        if (data.results?.length) {
            const capeTown = data.results[0];
            selectedLocation = capeTown;
            cityInput.value = capeTown.name;
            await loadWeather(capeTown);
        }
    } catch (error) {
        status.textContent =
            "Enter a city to load its weather.";
    }
})();
