#include <Arduino.h>
#include <atomic>
#include <esp32-hal-tinyusb.h>
#include <BLE.h>
#include <M5Unified.h>
#include <Preferences.h>
#include <esp_random.h>
#include <USB.h>
#include <USBHID.h>
#include "Vf2Controls.h"
#include "NullFont.h"

#if !CONFIG_IDF_TARGET_ESP32P4 || ARDUINO_USB_MODE != 0 || ARDUINO_USB_PORT != 1 || ARDUINO_USB_CDC_ON_BOOT
#error "Select M5Stack Tab5, USB-OTG (TinyUSB Full Speed), and USB CDC Off."
#endif

namespace {
using namespace vf2;
constexpr char deviceName[] = "NULL CITY NC-04";
constexpr const char *buttonNames[] = {"G", "P", "K", "COIN", "1P", "2P"};
static_assert(sizeof(buttonNames) / sizeof(buttonNames[0]) == Count - Guard);
static_assert(sizeof(pins) / sizeof(pins[0]) == Player2);
constexpr uint32_t frameIntervalUs = 16667;

lgfx::PointerWrapper bodyFontData(nullFontBody, sizeof(nullFontBody));
lgfx::PointerWrapper headingFontData(nullFontHeading, sizeof(nullFontHeading));
lgfx::VLWfont bodyFont;
lgfx::VLWfont headingFont;

struct StickPosition { int x; int y; };
struct StickMotion {
    float x = 0, y = 0;
    StickPosition screenPosition{0, 0};

    StickPosition move(const Report &report, int travel) {
        const float target = (report.x && report.y) ? .7071f : 1.0f;
        x += (target * report.x / 127.0f - x) * .36f;
        y += (target * report.y / 127.0f - y) * .36f;
        return {static_cast<int>(lroundf(x * travel)), static_cast<int>(lroundf(y * travel))};
    }
};
StickMotion stickMotion;
constexpr uint8_t downloadReportId = 0x7e;
constexpr uint8_t downloadCommand[] = {'N', 'C', '0', '4', 'B', 'O', 'O', 'T'};
constexpr uint8_t downloadDescriptor[] = {
    0x06, 0x00, 0xff, 0x09, 0x01, 0xa1, 0x01,  // Vendor application collection.
    0x85, downloadReportId, 0x09, 0x01, 0x15, 0x00, 0x26, 0xff, 0x00,
    0x75, 0x08, 0x95, sizeof(downloadCommand), 0xb1, 0x02, 0xc0,
};

class UsbJoystick : public USBHIDDevice {
public:
    void begin() {
        USBHID::addDevice(this, sizeof(reportMap) + sizeof(downloadDescriptor));
        hid.begin();
        USB.productName(deviceName);
        USB.begin();
    }

    uint16_t _onGetDescriptor(uint8_t *buffer) override {
        memcpy(buffer, reportMap, sizeof(reportMap));
        memcpy(buffer + sizeof(reportMap), downloadDescriptor, sizeof(downloadDescriptor));
        return sizeof(reportMap) + sizeof(downloadDescriptor);
    }

    void _onSetFeature(uint8_t id, const uint8_t *buffer, uint16_t len) override {
        if (id == downloadReportId && len == sizeof(downloadCommand) &&
            memcmp(buffer, downloadCommand, len) == 0) {
            downloadRequested.store(true, std::memory_order_relaxed);
        }
    }

    void handleDownloadRequest() {
        if (!downloadRequested.exchange(false, std::memory_order_relaxed)) return;
        // Leave the USB task time to acknowledge SET_REPORT before disconnecting.
        delay(50);
        usb_persist_restart(RESTART_BOOTLOADER);
    }

    bool connected() { return static_cast<bool>(USB); }
    bool send(const Report &report) {
        return hid.ready() && hid.SendReport(reportId, &report, sizeof(report), 2);
    }

private:
    USBHID hid;
    std::atomic<bool> downloadRequested{false};
};

UsbJoystick usb;
BLEServer bleServer;
BLECharacteristic bleInput;
std::atomic<bool> bleEncrypted{false};
Debouncer contacts;
Macro macro;

void setBleIdentity() {
    // Keep the advertised name associated with a stable address across updates.
    Preferences settings;
    if (!settings.begin("nc04-ble", false)) return;
    uint8_t address[6];
    if (settings.getBytes("identity", address, sizeof(address)) != sizeof(address)) {
        esp_fill_random(address, sizeof(address));
        address[5] = (address[5] & 0x3f) | 0xc0;  // Static random BLE address.
        if (settings.putBytes("identity", address, sizeof(address)) != sizeof(address)) return;
    }
    if (BLE.setOwnAddress(BTAddress(address, BTAddress::Random))) {
        BLE.setOwnAddressType(BTAddress::Random);
    }
}

void startBle() {
    if (!BLE.begin(deviceName)) return;
    setBleIdentity();
    auto security = BLE.getSecurity();
    security.setIOCapability(BLEIOCapability::NoInputNoOutput);
    security.setAuthenticationMode(true, false, true);
    security.onAuthenticationComplete([](const BLEConnInfo &peer, bool success) {
        bleEncrypted.store(success && peer.isEncrypted());
    });
    bleServer = BLE.createServer();
    if (!bleServer) return;
    bleServer.onConnect([](BLEServer &, const BLEConnInfo &peer) {
        bleEncrypted.store(peer.isEncrypted());
        if (!peer.isEncrypted()) BLE.getSecurity().startSecurity(peer);
    });
    bleServer.onDisconnect([](BLEServer &, const BLEConnInfo &, uint8_t) {
        bleEncrypted.store(false);
    });
    BLEHIDDevice hid(bleServer);
    hid.manufacturer("NULL CITY");
    hid.pnp(0x02, USB.VID(), USB.PID(), 0x0100);
    hid.hidInfo(0, 0x02);
    hid.reportMap(reportMap, sizeof(reportMap));
    hid.setBatteryLevel(constrain(M5.Power.getBatteryLevel(), 0, 100));
    bleInput = hid.inputReport(reportId);
    const Report neutral{};
    bleInput.setValue(neutral);
    bleServer.advertiseOnDisconnect(true);
    bleServer.start();
    auto advertising = BLE.getAdvertising();
    advertising.setName(deviceName);
    advertising.setScanResponse(true);
    advertising.setAppearance(BLE_APPEARANCE_HID_JOYSTICK);
    advertising.start();
}

uint16_t readInputs(uint32_t now) {
    uint16_t raw = 0;
    for (uint8_t i = 0; i < Player2; ++i) {
        if (digitalRead(pins[i]) == LOW) raw |= 1u << i;
    }
    return contacts.update(raw, now);
}

struct ButtonArea {
    int x, y, radius;

    bool contains(int px, int py) const {
        const int dx = px - x, dy = py - y;
        return dx * dx + dy * dy <= radius * radius;
    }
};

struct ControlsLayout {
    int width, height;

    int monitorTop() const { return height * 22 / 100; }
    int monitorHeight() const { return height * 44 / 100; }
    int stickX() const { return width * 23 / 100; }
    int stickY() const { return monitorTop() + monitorHeight() / 2; }
    int stickRadius() const { return monitorHeight() / 2 - 6; }

    ButtonArea button(int index) const {
        const int left = width * 45 / 100;
        const int columnWidth = (width - left) / 3;
        const int rowHeight = monitorHeight() / 2;
        const bool system = index >= 3;
        const int diameterLimit = min(columnWidth, rowHeight);
        // The cabinet's three action centers rise from G to P and settle at K.
        constexpr int actionCenterHeight[] = {152, 134, 142};
        const int heightPercent = system ? 38 : actionCenterHeight[index];
        return {left + (index % 3) * columnWidth + columnWidth / 2,
                monitorTop() + rowHeight * heightPercent / 100,
                diameterLimit * (system ? 31 : 46) / 100};
    }
};

void touchSettings(int x, int y, const ControlsLayout &layout, uint32_t now) {
    const int h = layout.height;
    if (y >= h * 73 / 100 && y < h * 92 / 100) {
        if (x < layout.width / 2) {
            if (macro.isRecording()) macro.finish(now);
            else macro.record(now);
        } else {
            if (macro.isPlaying()) macro.cancel();
            else macro.play(now);
        }
    }
}

uint16_t touchInputs(const ControlsLayout &layout, uint32_t now) {
    static int stickId = -1;
    bool stickPresent = false;
    uint16_t inputs = 0;
    const int radius = layout.stickRadius();
    for (uint8_t i = 0; i < M5.Touch.getCount(); ++i) {
        const auto &finger = M5.Touch.getDetail(i);
        if (!finger.isPressed()) continue;
        const int dx = finger.base_x - layout.stickX();
        const int dy = finger.base_y - layout.stickY();
        if (stickId < 0 && dx * dx + dy * dy <= radius * radius) stickId = finger.id;
        if (stickId == finger.id) {
            stickPresent = true;
            inputs |= virtualDirections(finger.x - layout.stickX(),
                                        finger.y - layout.stickY(), radius / 4);
            continue;
        }
        for (uint8_t button = Guard; button < Count; ++button) {
            const ButtonArea area = layout.button(button - Guard);
            if (area.contains(finger.base_x, finger.base_y) && area.contains(finger.x, finger.y)) {
                inputs |= 1u << button;
            }
        }
        if (finger.wasPressed() && finger.x >= 0 && finger.x < layout.width) {
            touchSettings(finger.x, finger.y, layout, now);
        }
    }
    if (!stickPresent) stickId = -1;
    return inputs;
}

void tile(int x, int y, int width, int height, const char *text, bool active) {
    auto &screen = M5.Display;
    screen.fillRoundRect(x + 4, y + 4, width - 8, height - 8, 8,
                         active ? 0x4efa : 0x10c6);
    screen.drawRoundRect(x + 4, y + 4, width - 8, height - 8, 8,
                         active ? 0xa7ff : 0x32cc);
    screen.setFont(&bodyFont);
    screen.setTextColor(active ? 0x0842 : 0xe75d, active ? 0x4efa : 0x10c6);
    screen.drawCenterString(text, x + width / 2, y + (height - screen.fontHeight()) / 2);
}

void drawButton(const ButtonArea &area, const char *label, bool active) {
    auto &screen = M5.Display;
    const uint16_t background = active ? 0x4efa : 0x10c6;
    screen.fillCircle(area.x, area.y, area.radius, background);
    screen.drawCircle(area.x, area.y, area.radius, active ? 0xa7ff : 0x32cc);
    screen.setFont(&bodyFont);
    screen.setTextColor(active ? 0x0842 : 0xe75d, background);
    screen.drawCenterString(label, area.x, area.y - screen.fontHeight() / 2);
}

void drawStick(const ControlsLayout &layout, StickPosition old, StickPosition next, bool first) {
    auto &screen = M5.Display;
    const int x = layout.stickX(), y = layout.stickY(), radius = layout.stickRadius();
    if (!first) {
        const int pad = radius / 3 + 2;
        const int left = min(old.x, next.x) - pad;
        const int top = min(old.y, next.y) - pad;
        screen.setClipRect(x + left, y + top, max(old.x, next.x) + pad - left + 1,
                           max(old.y, next.y) + pad - top + 1);
    }
    screen.startWrite();
    screen.fillCircle(x, y, radius, 0x10c6);
    screen.drawCircle(x, y, radius, 0x32cc);
    screen.drawCircle(x, y, radius * 3 / 4, 0x21a8);
    for (int dx = -1; dx <= 1; ++dx) {
        for (int dy = -1; dy <= 1; ++dy) {
            if (!dx && !dy) continue;
            const int offset = (dx && dy) ? radius * 3 / 5 : radius * 17 / 20;
            screen.fillCircle(x + dx * offset, y + dy * offset, 3, 0x7dd9);
        }
    }
    const int knobX = x + next.x, knobY = y + next.y;
    screen.fillCircle(knobX, knobY, radius / 3, (next.x || next.y) ? 0x4efa : 0x32cc);
    screen.drawCircle(knobX, knobY, radius / 3, 0xa7ff);
    screen.endWrite();
    if (!first) screen.clearClipRect();
}

void drawBluetoothIcon(int x, int y) {
    auto &screen = M5.Display;
    constexpr uint16_t color = 0x9fff;
    screen.drawFastVLine(x, y - 13, 27, color);
    screen.drawLine(x, y - 13, x + 8, y - 6, color);
    screen.drawLine(x + 8, y - 6, x - 8, y + 7, color);
    screen.drawLine(x - 8, y - 7, x + 8, y + 6, color);
    screen.drawLine(x + 8, y + 6, x, y + 13, color);
}

void draw(uint16_t inputs, bool usbReady, bool bleConnected, uint32_t changed, bool first) {
    auto &screen = M5.Display;
    const ControlsLayout layout{screen.width(), screen.height()};
    const int w = layout.width, h = layout.height;
    screen.startWrite();
    if (first) {
        screen.setFont(&headingFont);
        screen.setTextColor(0x9fff, 0x0842);
        screen.drawString("INTELLIGENT STICK", 18, 14);
        screen.setFont(&bodyFont);
        screen.setTextColor(0xe75d, 0x0842);
        screen.drawRightString("NULL CITY NC-04", w - 18, 17);
        screen.drawFastHLine(18, h * 12 / 100, w - 36, 0x32cc);
    }
    if (first || (changed >> 16)) {
        char status[70];
        snprintf(status, sizeof(status), "USB %s    BLE %s    MACRO %02u",
                 usbReady ? "ON" : "---", bleConnected ? "ON" : bleInput ? "ADV" : "ERR",
                 static_cast<unsigned>(macro.size()));
        screen.fillRect(18, h * 14 / 100, w - 36, h * 6 / 100, 0x0842);
        screen.setFont(&bodyFont);
        screen.setTextColor(0x7dd9, 0x0842);
        screen.drawString(status, 18, h * 14 / 100);
        if (bleConnected) drawBluetoothIcon(w - 34, h * 14 / 100 + screen.fontHeight() / 2);
    }

    for (uint8_t i = Guard; i < Count; ++i) {
        if (!first && !(changed & (1u << i))) continue;
        const ButtonArea area = layout.button(i - Guard);
        drawButton(area, buttonNames[i - Guard], inputs & (1u << i));
    }
    if (first || (changed & (1u << 18))) {
        tile(0, h * 73 / 100, w / 2, h * 19 / 100, macro.isRecording() ? "STOP REC" : "RECORD",
             macro.isRecording());
    }
    if (first || (changed & (1u << 19))) {
        tile(w / 2, h * 73 / 100, w / 2, h * 19 / 100, macro.isPlaying() ? "STOP PLAY" : "PLAY",
             macro.isPlaying());
    }
    screen.endWrite();
}
}  // namespace

void setup() {
    M5.begin(M5.config());
    M5.Display.setRotation(1);
    if (M5.Display.width() < M5.Display.height()) M5.Display.setRotation(0);
    bodyFont.loadFont(&bodyFontData);
    headingFont.loadFont(&headingFontData);
    M5.Display.fillScreen(0x0842);
    for (uint8_t pin : pins) pinMode(pin, INPUT_PULLUP);
    usb.begin();
    startBle();
}

void loop() {
    static Report lastUsb{}, lastBle{};
    static uint32_t lastBleReport = 0;
    static bool usbWasReady = false;
    static uint32_t lastDraw = 0, lastVisual = UINT32_MAX;
    const uint32_t now = millis();
    usb.handleDownloadRequest();
    M5.update();
    const ControlsLayout layout{M5.Display.width(), M5.Display.height()};
    const uint16_t inputs = touchInputs(layout, now) | readInputs(now);
    const uint16_t output = macro.update(inputs, now);
    const Report report = reportFor(output);

    const bool usbReady = usb.connected();
    if (usbReady && (!usbWasReady || report.differs(lastUsb))) {
        if (usb.send(report)) {
            lastUsb = report;
            usbWasReady = true;
        } else {
            usbWasReady = false;
        }
    } else if (!usbReady) {
        usbWasReady = false;
    }
    const bool bleConnected = bleInput && bleEncrypted.load();
    if (bleConnected && (report.differs(lastBle) || now - lastBleReport >= 250)) {
        if (bleInput.notify(reinterpret_cast<const uint8_t *>(&report), sizeof(report))) {
            bleInput.setValue(report);
            lastBle = report;
            lastBleReport = now;
        }
    }

    const uint32_t visual = output |
                            (usbReady ? 1u << 16 : 0) | (bleConnected ? 1u << 17 : 0) |
                            (macro.isRecording() ? 1u << 18 : 0) |
                            (macro.isPlaying() ? 1u << 19 : 0) |
                            (static_cast<uint32_t>(macro.size()) << 20);
    const uint32_t frameTime = micros();
    if (frameTime - lastDraw >= frameIntervalUs) {
        const uint32_t elapsedFrames = (frameTime - lastDraw) / frameIntervalUs;
        lastDraw += elapsedFrames * frameIntervalUs;
        const bool first = lastVisual == UINT32_MAX;
        const StickPosition old = stickMotion.screenPosition;
        const StickPosition next = stickMotion.move(report, layout.stickRadius() / 2);
        if (first || old.x != next.x || old.y != next.y) {
            drawStick(layout, old, next, first);
            stickMotion.screenPosition = next;
        }
        if (visual != lastVisual) {
            draw(output, usbReady, bleConnected, visual ^ lastVisual, first);
            lastVisual = visual;
        }
    }
    delay(1);
}
