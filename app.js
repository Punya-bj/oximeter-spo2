const elements = {
  connectButton: document.querySelector("#connectButton"),
  disconnectButton: document.querySelector("#disconnectButton"),
  clearLogButton: document.querySelector("#clearLogButton"),
  exportButton: document.querySelector("#exportButton"),
  settingsForm: document.querySelector("#settingsForm"),
  personForm: document.querySelector("#personForm"),
  statusDot: document.querySelector("#statusDot"),
  connectionState: document.querySelector("#connectionState"),
  deviceName: document.querySelector("#deviceName"),
  spo2Value: document.querySelector("#spo2Value"),
  heartRateValue: document.querySelector("#heartRateValue"),
  batteryValue: document.querySelector("#batteryValue"),
  spo2Message: document.querySelector("#spo2Message"),
  heartRateMessage: document.querySelector("#heartRateMessage"),
  batteryMessage: document.querySelector("#batteryMessage"),
  lastUpdated: document.querySelector("#lastUpdated"),
  recordCount: document.querySelector("#recordCount"),
  logList: document.querySelector("#logList"),
  recordsList: document.querySelector("#recordsList"),
  chart: document.querySelector("#spo2Chart"),
  personSelect: document.querySelector("#personSelect"),
  personNameInput: document.querySelector("#personNameInput"),
  namePrefixInput: document.querySelector("#namePrefixInput"),
  serviceUuidInput: document.querySelector("#serviceUuidInput"),
  characteristicUuidInput: document.querySelector("#characteristicUuidInput")
};

const defaultSettings = {
  namePrefix: "Oximeter",
  serviceUuid: "6e400001-b5a3-f393-e0a9-e50e24dcca9e",
  characteristicUuid: "6e400003-b5a3-f393-e0a9-e50e24dcca9e"
};

let settings = loadSettings();
let peopleStore = loadPeopleStore();
let bluetoothDevice = null;
let notifyCharacteristic = null;
let activePersonId = peopleStore.activePersonId;
let history = getActiveReadings().slice(-32);

function loadSettings() {
  try {
    return { ...defaultSettings, ...JSON.parse(localStorage.getItem("pulselinkSettings")) };
  } catch {
    return { ...defaultSettings };
  }
}

function saveSettings() {
  settings = {
    namePrefix: elements.namePrefixInput.value.trim() || defaultSettings.namePrefix,
    serviceUuid: elements.serviceUuidInput.value.trim() || defaultSettings.serviceUuid,
    characteristicUuid: elements.characteristicUuidInput.value.trim() || defaultSettings.characteristicUuid
  };
  localStorage.setItem("pulselinkSettings", JSON.stringify(settings));
  addLog("BLE settings saved.");
}

function hydrateSettings() {
  elements.namePrefixInput.value = settings.namePrefix;
  elements.serviceUuidInput.value = settings.serviceUuid;
  elements.characteristicUuidInput.value = settings.characteristicUuid;
}

function loadPeopleStore() {
  const fallbackPerson = createPerson("Default Person");

  try {
    const saved = JSON.parse(localStorage.getItem("pulselinkPeople"));
    if (saved?.people?.length) {
      const people = saved.people.map((person) => ({
        ...person,
        readings: Array.isArray(person.readings) ? person.readings : []
      }));
      return {
        people,
        activePersonId: people.some((person) => person.id === saved.activePersonId) ? saved.activePersonId : people[0].id
      };
    }
  } catch {
    // Fall through to a fresh store.
  }

  return {
    people: [fallbackPerson],
    activePersonId: fallbackPerson.id
  };
}

function createPerson(name) {
  return {
    id: `person-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name,
    readings: []
  };
}

function savePeopleStore() {
  peopleStore.activePersonId = activePersonId;
  localStorage.setItem("pulselinkPeople", JSON.stringify(peopleStore));
}

function getActivePerson() {
  return peopleStore.people.find((person) => person.id === activePersonId) || peopleStore.people[0];
}

function getActiveReadings() {
  return getActivePerson()?.readings || [];
}

function renderPeople() {
  elements.personSelect.innerHTML = "";

  peopleStore.people.forEach((person) => {
    const option = document.createElement("option");
    option.value = person.id;
    option.textContent = `${person.name} (${person.readings.length})`;
    option.selected = person.id === activePersonId;
    elements.personSelect.append(option);
  });

  renderActivePerson();
}

function renderActivePerson() {
  const readings = getActiveReadings();
  history = readings.slice(-32).map(restoreReadingDates);
  elements.recordCount.textContent = `${readings.length} saved`;

  const latest = readings.at(-1);
  if (latest) {
    renderReading(restoreReadingDates(latest), { save: false });
  } else {
    resetMetricDisplay();
    drawChart();
  }

  renderRecordsList();
}

function restoreReadingDates(reading) {
  return {
    ...reading,
    time: reading.time instanceof Date ? reading.time : new Date(reading.time)
  };
}

function resetMetricDisplay() {
  elements.spo2Value.textContent = "--";
  elements.heartRateValue.textContent = "--";
  elements.batteryValue.textContent = "--";
  elements.spo2Message.textContent = `Waiting for ${getActivePerson().name}'s sensor data`;
  elements.heartRateMessage.textContent = "Place finger on MAX30102";
  elements.batteryMessage.textContent = "TP4056 charging module";
  elements.lastUpdated.textContent = "No readings yet";
}

function addPerson(event) {
  event.preventDefault();
  const name = elements.personNameInput.value.trim();
  if (!name) {
    addLog("Enter a person name before saving.");
    return;
  }

  const existing = peopleStore.people.find((person) => person.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    activePersonId = existing.id;
    addLog(`${existing.name} is now the active person.`);
  } else {
    const person = createPerson(name);
    peopleStore.people.push(person);
    activePersonId = person.id;
    addLog(`${person.name} added as a new person.`);
  }

  elements.personNameInput.value = "";
  savePeopleStore();
  renderPeople();
}

function switchPerson() {
  activePersonId = elements.personSelect.value;
  savePeopleStore();
  addLog(`${getActivePerson().name} is now the active person.`);
  renderActivePerson();
}

async function connectDevice() {
  if (!navigator.bluetooth) {
    addLog("Web Bluetooth is not available. Use Chrome or Edge on Android, desktop Chrome, or another supported browser.");
    return;
  }

  saveSettings();
  setConnecting(true);

  try {
    bluetoothDevice = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: settings.namePrefix }],
      optionalServices: [settings.serviceUuid]
    });

    bluetoothDevice.addEventListener("gattserverdisconnected", handleDisconnect);
    updateConnection("Connecting", bluetoothDevice.name || "ESP32-C3 oximeter", false);

    const server = await bluetoothDevice.gatt.connect();
    const service = await server.getPrimaryService(settings.serviceUuid);
    notifyCharacteristic = await service.getCharacteristic(settings.characteristicUuid);
    notifyCharacteristic.addEventListener("characteristicvaluechanged", handleNotification);
    await notifyCharacteristic.startNotifications();

    updateConnection("Connected", bluetoothDevice.name || "ESP32-C3 oximeter", true);
    addLog("Connected and listening for live readings.");
  } catch (error) {
    addLog(`Connection failed: ${error.message}`);
    updateConnection("Not connected", "No device selected", false);
  } finally {
    setConnecting(false);
  }
}

async function disconnectDevice() {
  try {
    if (notifyCharacteristic) {
      await notifyCharacteristic.stopNotifications();
      notifyCharacteristic.removeEventListener("characteristicvaluechanged", handleNotification);
    }
  } catch (error) {
    addLog(`Notification stop warning: ${error.message}`);
  }

  if (bluetoothDevice?.gatt?.connected) {
    bluetoothDevice.gatt.disconnect();
  } else {
    handleDisconnect();
  }
}

function handleDisconnect() {
  notifyCharacteristic = null;
  bluetoothDevice = null;
  updateConnection("Not connected", "No device selected", false);
  addLog("Device disconnected.");
}

function handleNotification(event) {
  const decoder = new TextDecoder("utf-8");
  const rawText = decoder.decode(event.target.value).trim();
  addLog(`RX ${rawText}`);

  const reading = parseReading(rawText);
  if (!reading) {
    addLog("Could not parse reading. Send JSON or CSV: spo2,bpm,battery.");
    return;
  }

  renderReading(reading);
}

function parseReading(rawText) {
  try {
    const data = JSON.parse(rawText);
    return normalizeReading({
      spo2: data.spo2 ?? data.SpO2 ?? data.oxygen,
      bpm: data.bpm ?? data.hr ?? data.heartRate,
      battery: data.battery ?? data.bat
    });
  } catch {
    const parts = rawText.split(",").map((part) => Number(part.trim()));
    if (parts.length >= 2 && parts.every((part) => Number.isFinite(part))) {
      return normalizeReading({ spo2: parts[0], bpm: parts[1], battery: parts[2] });
    }
  }
  return null;
}

function normalizeReading(reading) {
  const spo2 = Number(reading.spo2);
  const bpm = Number(reading.bpm);
  const battery = Number(reading.battery);

  if (!Number.isFinite(spo2) || !Number.isFinite(bpm)) {
    return null;
  }

  return {
    spo2: clamp(Math.round(spo2), 0, 100),
    bpm: clamp(Math.round(bpm), 0, 240),
    battery: Number.isFinite(battery) ? clamp(Math.round(battery), 0, 100) : null,
    time: new Date()
  };
}

function renderReading(reading, options = { save: true }) {
  elements.spo2Value.textContent = reading.spo2;
  elements.heartRateValue.textContent = reading.bpm;
  elements.batteryValue.textContent = reading.battery === null ? "--" : reading.battery;
  elements.spo2Message.textContent = getSpo2Message(reading.spo2);
  elements.heartRateMessage.textContent = reading.bpm < 45 || reading.bpm > 130 ? "Check sensor placement" : "Pulse signal received";
  elements.batteryMessage.textContent = reading.battery === null ? "Battery not reported" : getBatteryMessage(reading.battery);
  elements.lastUpdated.textContent = `Updated ${reading.time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;

  if (options.save) {
    saveReadingForActivePerson(reading);
  } else {
    history = getActiveReadings().slice(-32).map(restoreReadingDates);
  }

  drawChart();
}

function saveReadingForActivePerson(reading) {
  const activePerson = getActivePerson();
  const storedReading = {
    spo2: reading.spo2,
    bpm: reading.bpm,
    battery: reading.battery,
    time: reading.time.toISOString()
  };

  activePerson.readings.push(storedReading);
  activePerson.readings = activePerson.readings.slice(-250);
  history = activePerson.readings.slice(-32).map(restoreReadingDates);
  savePeopleStore();
  renderPeople();
  renderRecordsList();
  addLog(`Saved reading for ${activePerson.name}.`);
}

function renderRecordsList() {
  const readings = getActiveReadings().slice(-8).reverse().map(restoreReadingDates);
  elements.recordsList.innerHTML = "";

  if (readings.length === 0) {
    const emptyItem = document.createElement("li");
    emptyItem.textContent = `No saved readings for ${getActivePerson().name} yet.`;
    elements.recordsList.append(emptyItem);
    return;
  }

  readings.forEach((reading) => {
    const item = document.createElement("li");
    const title = document.createElement("strong");
    title.textContent = `${reading.spo2}% SpO2 · ${reading.bpm} BPM`;
    const details = document.createElement("span");
    details.textContent = `${reading.time.toLocaleString()} · Battery ${reading.battery === null ? "not reported" : `${reading.battery}%`}`;
    item.append(title, details);
    elements.recordsList.append(item);
  });
}

function exportActivePersonCsv() {
  const person = getActivePerson();
  const rows = [
    ["name", "spo2", "bpm", "battery", "time"],
    ...person.readings.map((reading) => [
      person.name,
      reading.spo2,
      reading.bpm,
      reading.battery ?? "",
      reading.time
    ])
  ];
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${person.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "person"}-spo2-readings.csv`;
  link.click();
  URL.revokeObjectURL(url);
  addLog(`Exported CSV for ${person.name}.`);
}

function csvCell(value) {
  return `"${String(value).replaceAll("\"", "\"\"")}"`;
}

function getSpo2Message(value) {
  if (value >= 95) return "Normal oxygen range";
  if (value >= 90) return "Low reading, retest calmly";
  return "Very low reading, seek medical help";
}

function getBatteryMessage(value) {
  if (value >= 70) return "Battery healthy";
  if (value >= 30) return "Battery medium";
  return "Charge soon with TP4056";
}

function updateConnection(state, name, connected) {
  elements.connectionState.textContent = state;
  elements.deviceName.textContent = name;
  elements.statusDot.classList.toggle("connected", connected);
  elements.connectButton.disabled = connected;
  elements.disconnectButton.disabled = !connected;
}

function setConnecting(isConnecting) {
  elements.connectButton.disabled = isConnecting;
  elements.connectButton.textContent = isConnecting ? "Connecting..." : "⌁ Connect Bluetooth";
}

function addLog(message) {
  const item = document.createElement("li");
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  item.textContent = `${time} - ${message}`;
  elements.logList.prepend(item);

  while (elements.logList.children.length > 40) {
    elements.logList.lastElementChild.remove();
  }
}

function drawChart() {
  const canvas = elements.chart;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const padding = 34;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#f8fbfa";
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "#d7e2df";
  ctx.lineWidth = 1;
  [90, 95, 100].forEach((mark) => {
    const y = mapRange(mark, 85, 100, height - padding, padding);
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(width - padding, y);
    ctx.stroke();
    ctx.fillStyle = "#617174";
    ctx.font = "14px system-ui";
    ctx.fillText(`${mark}%`, 8, y + 5);
  });

  if (history.length === 0) {
    ctx.fillStyle = "#617174";
    ctx.font = "18px system-ui";
    ctx.fillText("Waiting for Bluetooth readings", padding, height / 2);
    return;
  }

  ctx.strokeStyle = "#0b7285";
  ctx.lineWidth = 4;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();

  history.forEach((point, index) => {
    const x = history.length === 1 ? width / 2 : mapRange(index, 0, history.length - 1, padding, width - padding);
    const y = mapRange(point.spo2, 85, 100, height - padding, padding);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  const latest = history.at(-1);
  const latestX = history.length === 1 ? width / 2 : width - padding;
  const latestY = mapRange(latest.spo2, 85, 100, height - padding, padding);
  ctx.fillStyle = "#0b7285";
  ctx.beginPath();
  ctx.arc(latestX, latestY, 7, 0, Math.PI * 2);
  ctx.fill();
}

function mapRange(value, inMin, inMax, outMin, outMax) {
  const safeValue = clamp(value, inMin, inMax);
  return ((safeValue - inMin) * (outMax - outMin)) / (inMax - inMin) + outMin;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

elements.connectButton.addEventListener("click", connectDevice);
elements.disconnectButton.addEventListener("click", disconnectDevice);
elements.personForm.addEventListener("submit", addPerson);
elements.personSelect.addEventListener("change", switchPerson);
elements.exportButton.addEventListener("click", exportActivePersonCsv);
elements.settingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  saveSettings();
});
elements.clearLogButton.addEventListener("click", () => {
  elements.logList.innerHTML = "";
});

window.addEventListener("resize", drawChart);

hydrateSettings();
renderPeople();
addLog("Ready. Use HTTPS or localhost for Web Bluetooth.");
