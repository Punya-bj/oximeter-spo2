# PulseLink SpO2 Bluetooth Website

This website connects to an ESP32-C3 oximeter over Bluetooth Low Energy and displays live readings from a MAX30102 sensor.
It can save readings for multiple people separately by name in the browser's local storage.

## Files

- `index.html` - mobile-friendly dashboard
- `styles.css` - responsive visual design
- `app.js` - Web Bluetooth connection, parsing, status updates, and chart

## Multiple People

1. Add a person name in `Person Records`.
2. Select the active person before taking a reading.
3. Every Bluetooth reading is saved under that selected person's name.
4. Switch names to view each person's separate chart and saved readings.
5. Use `Export CSV` to download the selected person's readings.

Data is stored on the same phone/browser. Clearing browser data will remove saved readings.

## How To Open

Web Bluetooth needs a secure browser context:

- Good for testing on this computer: `http://localhost:8000`
- Good for mobile use: HTTPS hosting, or a local server opened from Chrome/Edge on Android
- Not supported well on iPhone Safari

If a local server is running from this folder, open:

```text
http://localhost:8000
```

## ESP32-C3 BLE Settings

Default website settings:

```text
Device name prefix: Oximeter
Service UUID: 6e400001-b5a3-f393-e0a9-e50e24dcca9e
Notify UUID: 6e400003-b5a3-f393-e0a9-e50e24dcca9e
```

Send readings as JSON:

```json
{"spo2":98,"bpm":76,"battery":87}
```

CSV also works:

```text
98,76,87
```

The first value is SpO2 percent, the second is heart rate in BPM, and the optional third value is battery percent.

## Important Note

This is a project display interface, not a certified medical device. Use it for learning and prototyping only.
