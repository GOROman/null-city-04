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
Presets presets;
bool facingRight = true;
bool rapidHeld = false;
bool tuningPkg = false;
InputLog inputLog;
constexpr unsigned logEntriesPerPage = 7;
unsigned logOffset = 0;
bool logNeedsDraw = true;

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

    int controlsWidth() const { return logLeft() - 12; }
    int monitorTop() const { return height * 22 / 100; }
    int monitorHeight() const { return height * 44 / 100; }
    int logLeft() const { return width - logWidth() - 18; }
    int logWidth() const { return (width - width * 67 / 100 - 30) * 2 / 3; }
    int logTop() const { return monitorTop(); }
    int logHeaderHeight() const { return height * 6 / 100; }
    int logFooterTop() const { return height * 91 / 100; }
    int logFooterHeight() const { return height * 7 / 100; }
    int logActionWidth() const { return logWidth() / 3; }
    int tuneRowTop(bool afterGuard) const { return logTop() + height * (afterGuard ? 26 : 13) / 100; }
    int tuneRowHeight() const { return height * 9 / 100; }
    int tuneButtonWidth() const { return logWidth() * 30 / 100; }
    int presetTop() const { return height * 70 / 100; }
    int presetHeight() const { return height * 27 / 100; }
    int presetAt(int x, int y) const {
        if (x < 0 || x >= controlsWidth() || y < presetTop() || y >= presetTop() + presetHeight()) return -1;
        return x * 5 / controlsWidth();
    }
    int stickX() const { return controlsWidth() * 22 / 100; }
    int stickY() const { return monitorTop() + monitorHeight() / 2; }
    int stickRadius() const { return monitorHeight() / 2 - 6; }

    ButtonArea button(int index) const {
        const int left = controlsWidth() * 44 / 100;
        const int columnWidth = (controlsWidth() - left) / 3;
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
    if (tuningPkg && x >= layout.logLeft()) {
        const int column = x - layout.logLeft();
        if (column >= layout.logWidth()) return;
        for (bool after : {false, true}) {
            const int row = layout.tuneRowTop(after);
            if (y >= row && y < row + layout.tuneRowHeight()) {
                const int buttonWidth = layout.tuneButtonWidth();
                if (column < buttonWidth) presets.adjustRapidWait(after, -5);
                else if (column >= layout.logWidth() - buttonWidth) presets.adjustRapidWait(after, 5);
                logNeedsDraw = true;
                return;
            }
        }
        if (y >= layout.logFooterTop() && y < layout.logFooterTop() + layout.logFooterHeight()) {
            presets.resetRapidWaits();
            logNeedsDraw = true;
        }
        return;
    }
    if (y >= layout.logFooterTop() && y < layout.logFooterTop() + layout.logFooterHeight() &&
        x >= layout.logLeft() && x < layout.logLeft() + 3 * layout.logActionWidth()) {
        const int action = (x - layout.logLeft()) / layout.logActionWidth();
        if (action == 0 && logOffset + logEntriesPerPage < inputLog.size()) {
            logOffset += logEntriesPerPage;
        } else if (action == 1) {
            logOffset = logOffset > logEntriesPerPage ? logOffset - logEntriesPerPage : 0;
        } else if (action == 2) {
            inputLog.clear();
            logOffset = 0;
        }
        logNeedsDraw = true;
    } else if (const int preset = layout.presetAt(x, y); preset >= 0) {
        if (preset < 2) {
            presets.start(preset == 0 ? Presets::Knee : Presets::AkiraSpecial, facingRight, now);
        } else if (preset == 3) {
            facingRight = !facingRight;
        } else if (preset == 4) {
            tuningPkg = !tuningPkg;
            logNeedsDraw = true;
        }
    }
}

uint16_t touchInputs(const ControlsLayout &layout, uint32_t now) {
    static int stickId = -1;
    bool stickPresent = false;
    rapidHeld = false;
    uint16_t inputs = 0;
    const int radius = layout.stickRadius();
    for (uint8_t i = 0; i < M5.Touch.getCount(); ++i) {
        const auto &finger = M5.Touch.getDetail(i);
        if (!finger.isPressed()) continue;
        const int preset = layout.presetAt(finger.base_x, finger.base_y);
        if (preset >= 0) {
            if (preset == 2 && layout.presetAt(finger.x, finger.y) == preset) rapidHeld = true;
            if (finger.wasPressed()) touchSettings(finger.base_x, finger.base_y, layout, now);
            continue;
        }
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

void drawLogArrow(int x, int y, const Report &report) {
    auto &screen = M5.Display;
    const int dx = report.x / 127, dy = report.y / 127;
    if (!dx && !dy) return;
    const bool diagonal = dx && dy;
    const int reach = diagonal ? 13 : 18;
    const int shaft = diagonal ? 4 : 6;
    const int wing = diagonal ? 8 : 11;
    const int tailX = x - dx * reach, tailY = y - dy * reach;
    const int tailLeftX = tailX - dy * shaft, tailLeftY = tailY + dx * shaft;
    const int tailRightX = tailX + dy * shaft, tailRightY = tailY - dx * shaft;
    const int rootLeftX = x - dy * shaft, rootLeftY = y + dx * shaft;
    const int rootRightX = x + dy * shaft, rootRightY = y - dx * shaft;
    constexpr uint16_t color = 0x9fff;
    screen.fillTriangle(tailLeftX, tailLeftY, tailRightX, tailRightY, rootLeftX, rootLeftY, color);
    screen.fillTriangle(tailRightX, tailRightY, rootLeftX, rootLeftY, rootRightX, rootRightY, color);
    screen.fillTriangle(x + dx * reach, y + dy * reach,
                        x - dy * wing, y + dx * wing,
                        x + dy * wing, y - dx * wing, color);
}

void drawLogButtons(int x, int y, const InputLog::Entry &entry) {
    auto &screen = M5.Display;
    const uint8_t pressed = entry.pressedButtons();
    for (unsigned button = 0; button < Count - Guard; ++button) {
        const uint8_t mask = 1u << button;
        if (!(pressed & mask)) continue;
        screen.fillCircle(x, y, 13, 0x4efa);
        screen.drawCircle(x, y, 13, 0xa7ff);
        screen.setTextSize(button == Coin - Guard ? .36f : .55f);
        screen.setTextColor(0x0842, 0x4efa);
        screen.drawCenterString(buttonNames[button], x, y - screen.fontHeight() / 2);
        x += 29;
    }
}

void drawPkgTuning(const ControlsLayout &layout) {
    auto &screen = M5.Display;
    const int x = layout.logLeft(), top = layout.logTop(), width = layout.logWidth();
    screen.startWrite();
    screen.fillRect(x, top, width, layout.logFooterTop() + layout.logFooterHeight() - top, 0x0842);
    screen.setFont(&bodyFont);
    screen.setTextColor(0x7dd9, 0x0842);
    screen.drawString("PKG TIMING", x + 2, top);
    screen.setTextSize(.72f);
    for (bool after : {false, true}) {
        const int row = layout.tuneRowTop(after), rowHeight = layout.tuneRowHeight();
        const int buttonWidth = layout.tuneButtonWidth();
        screen.setTextColor(0x7dd9, 0x0842);
        screen.drawString(after ? "G TO NEXT P" : "K TO G", x + 2, row - screen.fontHeight());
        tile(x, row, buttonWidth, rowHeight, "LESS", false);
        tile(x + width - buttonWidth, row, buttonWidth, rowHeight, "MORE", false);
        char duration[16];
        snprintf(duration, sizeof(duration), "%u MS", static_cast<unsigned>(presets.rapidWaitMs(after)));
        screen.setTextColor(0xe75d, 0x0842);
        screen.drawCenterString(duration, x + width / 2, row + (rowHeight - screen.fontHeight()) / 2);
    }
    tile(x, layout.logFooterTop(), width, layout.logFooterHeight(), "RESET 116 33", false);
    screen.setTextSize(1);
    screen.endWrite();
}

void drawInputLog(const ControlsLayout &layout) {
    auto &screen = M5.Display;
    const int x = layout.logLeft();
    const int width = layout.logWidth();
    const int top = layout.logTop();
    const int rowsTop = top + layout.logHeaderHeight();
    const int rowHeight = (layout.logFooterTop() - rowsTop - 4) / logEntriesPerPage;
    screen.startWrite();
    screen.drawFastVLine(x - 9, top, layout.logFooterTop() + layout.logFooterHeight() - top, 0x32cc);
    screen.fillRect(x, top, width, layout.logHeaderHeight(), 0x0842);
    screen.setFont(&bodyFont);
    screen.setTextColor(0x7dd9, 0x0842);
    screen.setTextSize(.85f);
    screen.drawString("INPUT LOG", x + 2, top);
    screen.setTextSize(.55f);
    if (logOffset) {
        char range[28];
        snprintf(range, sizeof(range), "%u-%u OF %u", logOffset + 1,
                 min<unsigned>(logOffset + logEntriesPerPage, inputLog.size()),
                 static_cast<unsigned>(inputLog.size()));
        screen.drawRightString(range, x + width - 5, top + layout.logHeaderHeight() / 2);
    } else {
        screen.drawRightString("LIVE", x + width - 5, top + 6);
    }

    for (unsigned i = 0; i < logEntriesPerPage; ++i) {
        const int rowTop = rowsTop + i * rowHeight;
        const int centerY = rowTop + rowHeight * 65 / 100;
        const auto *entry = inputLog.recent(logOffset + logEntriesPerPage - 1 - i);
        screen.fillRect(x, rowTop, width, rowHeight, 0x0842);
        screen.fillRoundRect(x, rowTop, width, rowHeight - 4, 5, 0x10c6);
        if (!entry) {
            if (!inputLog.size() && i == logEntriesPerPage - 1) {
                screen.setTextSize(.55f);
                screen.setTextColor(0x7dd9, 0x10c6);
                screen.drawString("WAITING FOR INPUT", x + 12, centerY - screen.fontHeight() / 2);
            }
            continue;
        }
        drawLogArrow(x + 22, centerY, entry->after);
        drawLogButtons(x + 54, centerY, *entry);
        char timestamp[24];
        snprintf(timestamp, sizeof(timestamp), "%lu MS", static_cast<unsigned long>(entry->timeMs));
        screen.setTextSize(.55f);
        screen.setTextColor(0x7dd9, 0x10c6);
        screen.drawRightString(timestamp, x + width - 6, rowTop + 3);
    }

    screen.setTextSize(.7f);
    const int actionWidth = layout.logActionWidth(), footer = layout.logFooterTop();
    const int footerHeight = layout.logFooterHeight();
    tile(x, footer, actionWidth, footerHeight, "OLDER", logOffset + logEntriesPerPage < inputLog.size());
    tile(x + actionWidth, footer, actionWidth, footerHeight, "NEWER", logOffset != 0);
    tile(x + 2 * actionWidth, footer, actionWidth, footerHeight, "CLEAR", inputLog.size() != 0);
    screen.setTextSize(1);
    screen.endWrite();
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
    if (first || (changed & (3u << 16))) {
        char status[70];
        snprintf(status, sizeof(status), "USB %s    BLE %s",
                 usbReady ? "ON" : "---", bleConnected ? "ON" : bleInput ? "ADV" : "ERR");
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
    if (first || (changed & (15u << 27))) {
        const int tileWidth = layout.controlsWidth() / 5;
        screen.setTextSize(.8f);
        tile(0, layout.presetTop(), tileWidth, layout.presetHeight(), "DOPPO", false);
        tile(tileWidth, layout.presetTop(), tileWidth, layout.presetHeight(), "AKIRA SPECIAL", false);
        tile(2 * tileWidth, layout.presetTop(), tileWidth, layout.presetHeight(), "1000 PUNCH", rapidHeld);
        tile(3 * tileWidth, layout.presetTop(), tileWidth, layout.presetHeight(),
             facingRight ? "FACE RIGHT" : "FACE LEFT", false);
        tile(4 * tileWidth, layout.presetTop(), tileWidth, layout.presetHeight(), "PKG TUNE", tuningPkg);
        screen.setTextSize(1);
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
    static bool usbWasReady = false, lastTuningView = false;
    static uint32_t lastDraw = 0, lastVisual = UINT32_MAX, lastLogDraw = 0;
    const uint32_t now = millis();
    usb.handleDownloadRequest();
    M5.update();
    const ControlsLayout layout{M5.Display.width(), M5.Display.height()};
    const uint16_t inputs = touchInputs(layout, now) | readInputs(now);
    const uint16_t rapidInput = presets.rapidSequence(rapidHeld, now);
    if (rapidHeld) presets.cancel();
    uint16_t output = presets.update(inputs, now);
    if (rapidHeld) {
        constexpr uint16_t attackButtons = inputBit(Punch) | inputBit(Kick) | inputBit(Guard);
        output = (output & ~attackButtons) | rapidInput;
    }
    const Report report = reportFor(output);
    if (inputLog.observe(report, now)) {
        if (logOffset) {
            logOffset = min<unsigned>(logOffset + 1, inputLog.size() - 1);
        }
        if (!tuningPkg) logNeedsDraw = true;
    }

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
                            (facingRight ? 1u << 27 : 0) | (rapidHeld ? 1u << 28 : 0) |
                            (tuningPkg ? 1u << 29 : 0);
    const uint32_t frameTime = micros();
    if (!presets.active() && frameTime - lastDraw >= frameIntervalUs) {
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
        // Prefer idle frames without starving the log during continuous motion.
        const uint32_t logAge = now - lastLogDraw;
        const bool stickIdle = old.x == next.x && old.y == next.y;
        if (logNeedsDraw && (first || (logAge >= 50 && stickIdle) || logAge >= 150)) {
            if (tuningPkg) {
                drawPkgTuning(layout);
            } else {
                if (lastTuningView) {
                    M5.Display.fillRect(layout.logLeft(), layout.logTop(), layout.logWidth(),
                                        layout.logFooterTop() + layout.logFooterHeight() - layout.logTop(), 0x0842);
                }
                drawInputLog(layout);
            }
            lastTuningView = tuningPkg;
            logNeedsDraw = false;
            lastLogDraw = now;
        }
    }
    delay(1);
}
