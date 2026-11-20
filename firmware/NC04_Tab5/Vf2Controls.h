#pragma once
#include <stdint.h>

namespace vf2 {
enum Input : uint8_t { Up, Down, Left, Right, Guard, Punch, Kick, Coin, Start, Player2, Count };
constexpr uint8_t pins[] = {16, 18, 19, 5, 3, 4, 2, 7, 6};
constexpr uint16_t inputBit(Input input) { return 1u << input; }
constexpr uint8_t reportId = 1;

// Signed X/Y, six independent buttons and two padding bits.
constexpr uint8_t reportMap[] = {
    0x05, 0x01, 0x09, 0x04, 0xa1, 0x01, 0x85, reportId,
    0x09, 0x30, 0x09, 0x31, 0x15, 0x81, 0x25, 0x7f,
    0x75, 0x08, 0x95, 0x02, 0x81, 0x02,
    0x05, 0x09, 0x19, 0x01, 0x29, 0x06, 0x15, 0x00, 0x25, 0x01,
    0x75, 0x01, 0x95, 0x06, 0x81, 0x02, 0x95, 0x02, 0x81, 0x03, 0xc0,
};

struct Report {
    int8_t x;
    int8_t y;
    uint8_t buttons;

    bool differs(const Report &other) const {
        return x != other.x || y != other.y || buttons != other.buttons;
    }
};
static_assert(sizeof(Report) == 3, "HID report must be three bytes");

constexpr Report reportFor(uint16_t inputs) {
    return {
        static_cast<int8_t>(127 * (!!(inputs & inputBit(Right)) - !!(inputs & inputBit(Left)))),
        static_cast<int8_t>(127 * (!!(inputs & inputBit(Down)) - !!(inputs & inputBit(Up)))),
        static_cast<uint8_t>((inputs >> Guard) & 0x3f),
    };
}

constexpr uint16_t virtualDirections(int dx, int dy, int deadZone) {
    if (dx * dx + dy * dy <= deadZone * deadZone) return 0;
    const int x = dx < 0 ? -dx : dx;
    const int y = dy < 0 ? -dy : dy;
    // Sector boundaries are tan(22.5 degrees) away from each cardinal axis.
    const uint16_t horizontal = dx > 0 ? inputBit(Right) : inputBit(Left);
    const uint16_t vertical = dy > 0 ? inputBit(Down) : inputBit(Up);
    if (y * 1000 < x * 414) return horizontal;
    if (x * 1000 < y * 414) return vertical;
    return horizontal | vertical;
}

class Presets {
public:
    enum Move { Knee, AkiraSpecial };

    void start(Move move, bool facingRight, uint32_t now) {
        selected = move;
        right = facingRight;
        index = 0;
        since = now;
        playing = true;
    }

    void cancel() { playing = false; }
    bool active() const { return playing; }

    uint16_t update(uint16_t inputs, uint32_t now) {
        if (!playing) return inputs;
        const Step *sequence = selected == Knee ? knee : akiraSpecial;
        if (now - since >= sequence[index].duration) {
            since = now;
            if (!sequence[++index].duration) {
                playing = false;
                return inputs;
            }
        }
        uint16_t move = sequence[index].inputs;
        if (!right) {
            const auto left = inputBit(Left), rightBit = inputBit(Right);
            move = (move & ~(left | rightBit)) |
                   ((move & left) ? rightBit : 0) | ((move & rightBit) ? left : 0);
        }
        return move | (inputs & (inputBit(Coin) | inputBit(Start) | inputBit(Player2)));
    }

    uint16_t rapidWaitMs(bool afterGuard) const {
        return afterGuard ? afterGuardMs : beforeGuardMs;
    }

    void adjustRapidWait(bool afterGuard, int delta) {
        uint16_t &value = afterGuard ? afterGuardMs : beforeGuardMs;
        const int next = static_cast<int>(value) + delta;
        value = next < 0 ? 0 : next > 500 ? 500 : next;
    }

    void resetRapidWaits() {
        beforeGuardMs = 70;
        afterGuardMs = 80;
    }

    uint16_t rapidSequence(bool held, uint32_t now) {
        if (held && !rapidHeld) {
            rapidSince = now;
            rapidIndex = 0;
        }
        rapidHeld = held;
        if (!held) return 0;
        const Step sequence[] = {{p, 100}, {k, 35}, {0, beforeGuardMs}, {g, 18}, {0, afterGuardMs}};
        if (now - rapidSince >= sequence[rapidIndex].duration) {
            rapidSince = now;
            do {
                rapidIndex = (rapidIndex + 1) % (sizeof(sequence) / sizeof(sequence[0]));
            } while (!sequence[rapidIndex].duration);
        }
        return sequence[rapidIndex].inputs;
    }

private:
    struct Step { uint16_t inputs; uint16_t duration; };
    static constexpr auto g = inputBit(Guard), p = inputBit(Punch), k = inputBit(Kick);
    static constexpr Step knee[] = {{g | k, 17}, {k, 50}, {0, 34}, {0, 0}};
    // VF2 2.1 at 60 Hz: begin from neutral, press P+K around F0+7,
    // then add a fresh Down and press P around F0+22.
    static constexpr Step akiraSpecial[] = {
        {0, 34}, {g | p | k, 34}, {0, 34}, {inputBit(Left), 50},
        {inputBit(Down) | inputBit(Right) | p | k, 34}, {0, 182},
        {inputBit(Down), 34}, {inputBit(Left) | p, 34}, {0, 34}, {0, 0},
    };
    Move selected = Knee;
    bool playing = false, right = true, rapidHeld = false;
    uint16_t beforeGuardMs = 70, afterGuardMs = 80;
    uint8_t index = 0, rapidIndex = 0;
    uint32_t since = 0, rapidSince = 0;
};

class InputLog {
public:
    struct Entry {
        uint32_t timeMs;
        Report before;
        Report after;

        uint8_t pressedButtons() const { return after.buttons & ~before.buttons; }
        bool movedLever() const {
            return (after.x || after.y) && (after.x != before.x || after.y != before.y);
        }
    };
    static constexpr uint8_t capacity = 64;

    bool observe(const Report &report, uint32_t now) {
        if (!report.differs(previous)) return false;
        const Entry entry{now, previous, report};
        previous = report;
        if (!entry.pressedButtons() && !entry.movedLever()) return false;
        entries[next] = entry;
        next = (next + 1) % capacity;
        if (used < capacity) ++used;
        return true;
    }

    void clear() { used = 0; }
    uint8_t size() const { return used; }

    const Entry *recent(unsigned offset) const {
        if (offset >= used) return nullptr;
        return &entries[(next + capacity - 1 - offset) % capacity];
    }

private:
    Entry entries[capacity] = {};
    Report previous{};
    uint8_t next = 0, used = 0;
};

class Debouncer {
public:
    uint16_t update(uint16_t raw, uint32_t now) {
        uint16_t changed = raw ^ previous;
        for (uint8_t i = 0; i < Count; ++i) {
            const uint16_t mask = 1u << i;
            if (changed & mask) lastChange[i] = now;
            if (now - lastChange[i] >= 5) {
                stable = (stable & ~mask) | (raw & mask);
            }
        }
        previous = raw;
        return stable;
    }

private:
    uint16_t previous = 0;
    uint16_t stable = 0;
    uint32_t lastChange[Count] = {};
};

class Macro {
public:
    void record(uint32_t now) {
        recording = true;
        playing = false;
        length = 0;
        held = 0;
        since = now;
    }

    void finish(uint32_t now) {
        if (!recording) return;
        if (length || held) append(now);
        recording = false;
    }

    void play(uint32_t now) {
        if (recording || !length) return;
        playing = true;
        index = 0;
        since = now;
    }

    void cancel() { playing = false; }
    bool isRecording() const { return recording; }
    bool isPlaying() const { return playing; }
    uint8_t size() const { return length; }

    uint16_t update(uint16_t physical, uint32_t now) {
        // Coin, Start and 2P remain live and cannot be recorded or replayed.
        const uint16_t buttons = physical & ((1u << Coin) - 1);
        if (recording && buttons != held) {
            if (length || held) append(now);
            held = buttons;
            since = now;
        }
        if (!playing) return physical;
        if (now - since >= steps[index].duration) {
            since = now;
            if (++index == length) {
                playing = false;
                return physical;
            }
        }
        return steps[index].inputs | (physical & (inputBit(Coin) | inputBit(Start) | inputBit(Player2)));
    }

private:
    struct Step { uint16_t inputs; uint16_t duration; };
    Step steps[64] = {};
    uint8_t length = 0, index = 0;
    uint32_t since = 0;
    uint16_t held = 0;
    bool recording = false, playing = false;

    void append(uint32_t now) {
        const uint32_t elapsed = now - since;
        steps[length++] = {held, static_cast<uint16_t>(elapsed < 20 ? 20 :
                                                     elapsed > 5000 ? 5000 : elapsed)};
        if (length == sizeof(steps) / sizeof(steps[0])) recording = false;
    }
};
}  // namespace vf2
