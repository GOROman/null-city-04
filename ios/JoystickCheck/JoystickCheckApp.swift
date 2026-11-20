import GameController
import SwiftUI

@main
struct JoystickCheckApp: App {
    var body: some Scene {
        WindowGroup { ControllerView() }
    }
}

struct PadReading: Equatable {
    var x: Float
    var y: Float

    var direction: String {
        let horizontal = x > 0.25 ? 1 : x < -0.25 ? -1 : 0
        let vertical = y > 0.25 ? 1 : y < -0.25 ? -1 : 0
        let arrows = ["↙", "↓", "↘", "←", "•", "→", "↖", "↑", "↗"]
        return arrows[(vertical + 1) * 3 + horizontal + 1]
    }
}

@MainActor
final class ControllerMonitor: ObservableObject {
    @Published private(set) var controllers: [GCController] = []
    @Published private(set) var selected: GCController?
    @Published private(set) var buttons: [String: Float] = [:]
    @Published private(set) var axes: [String: Float] = [:]
    @Published private(set) var pads: [String: PadReading] = [:]
    @Published private(set) var entries: [Entry] = []

    struct Entry: Identifiable {
        let id = UUID()
        let time: Date
        let label: String
    }

    func refresh() {
        controllers = GCController.controllers()
        if let selected, controllers.contains(where: { $0 === selected }) { return }
        select(controllers.first(where: { $0.vendorName?.contains("NULL CITY") == true }) ?? controllers.first)
    }

    func select(_ controller: GCController?) {
        selected?.physicalInputProfile.valueDidChangeHandler = nil
        selected = controller
        entries.removeAll()
        sample(record: false)
        guard let controller else { return }
        controller.handlerQueue = .main
        controller.physicalInputProfile.valueDidChangeHandler = { [weak self, weak controller] _, _ in
            MainActor.assumeIsolated {
                guard let self, let controller, self.selected === controller else { return }
                self.sample(record: true)
            }
        }
    }

    func clearLog() { entries.removeAll() }

    private func sample(record: Bool) {
        let profile = selected?.physicalInputProfile
        let newButtons = profile?.buttons.mapValues(\.value) ?? [:]
        let newAxes = profile?.axes.mapValues(\.value) ?? [:]
        let newPads = profile?.dpads.mapValues { PadReading(x: $0.xAxis.value, y: $0.yAxis.value) } ?? [:]
        if record {
            let pressed = newButtons.keys.sorted().filter { newButtons[$0, default: 0] > 0.5 && buttons[$0, default: 0] <= 0.5 }
            let moved = newPads.keys.sorted().compactMap { name -> String? in
                guard let pad = newPads[name], pad.direction != "•", pads[name]?.direction != pad.direction else { return nil }
                return "\(name) \(pad.direction)"
            }
            let changedAxes = newAxes.keys.sorted().filter {
                abs(newAxes[$0, default: 0]) > 0.25
                && abs(axes[$0, default: 0] - newAxes[$0, default: 0]) > 0.25
            }.map { "\($0) \(newAxes[$0, default: 0].formatted(.number.precision(.fractionLength(2))))" }
            let labels = pressed + moved + (moved.isEmpty ? changedAxes : [])
            if !labels.isEmpty {
                entries.insert(Entry(time: .now, label: labels.joined(separator: " + ")), at: 0)
                if entries.count > 64 { entries.removeLast() }
            }
        }
        buttons = newButtons
        axes = newAxes
        pads = newPads
    }
}

struct ControllerView: View {
    @StateObject private var monitor = ControllerMonitor()
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        NavigationStack {
            List {
                Section("iOS Game Controller") {
                    if monitor.controllers.isEmpty {
                        Label("認識済みコントローラなし", systemImage: "gamecontroller")
                        Text("設定のBluetoothで「NULL CITY NC-04」をペアリングし、このアプリに戻ってください。")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(monitor.controllers, id: \.self) { controller in
                            Button {
                                monitor.select(controller)
                            } label: {
                                HStack {
                                    VStack(alignment: .leading) {
                                        Text(controller.vendorName ?? "名称なし")
                                        Text(controller.productCategory)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    if controller === monitor.selected {
                                        Image(systemName: "checkmark.circle.fill").accessibilityLabel("選択中")
                                    }
                                }
                            }
                        }
                    }
                }
                if monitor.selected != nil {
                    Section("方向と軸") {
                        if monitor.pads.isEmpty && monitor.axes.isEmpty { Text("iOSから公開された方向入力なし") }
                        ForEach(monitor.pads.keys.sorted(), id: \.self) { name in
                            if let pad = monitor.pads[name] {
                                LabeledContent(name, value: "\(pad.direction)   X \(number(pad.x))  Y \(number(pad.y))")
                                    .monospacedDigit()
                            }
                        }
                        ForEach(monitor.axes.keys.sorted(), id: \.self) { name in
                            LabeledContent(name, value: number(monitor.axes[name, default: 0])).monospacedDigit()
                        }
                    }
                    Section("ボタン") {
                        if monitor.buttons.isEmpty { Text("iOSから公開されたボタンなし") }
                        ForEach(monitor.buttons.keys.sorted(), id: \.self) { name in
                            let value = monitor.buttons[name, default: 0]
                            LabeledContent(name) {
                                Label(number(value), systemImage: value > 0.5 ? "circle.fill" : "circle")
                                    .monospacedDigit()
                            }
                        }
                    }
                    Section {
                        if monitor.entries.isEmpty { Text("入力待ち").foregroundStyle(.secondary) }
                        ForEach(monitor.entries) { entry in
                            LabeledContent(entry.label) { Text(entry.time, style: .time).monospacedDigit() }
                        }
                    } header: {
                        HStack {
                            Text("入力ログ")
                            Spacer()
                            Button("消去", action: monitor.clearLog).disabled(monitor.entries.isEmpty)
                        }
                    }
                }
            }
            .navigationTitle("NC-04 Joy Check")
            .toolbar { Button("再確認", systemImage: "arrow.clockwise", action: monitor.refresh) }
        }
        .onAppear(perform: monitor.refresh)
        .onReceive(NotificationCenter.default.publisher(for: .GCControllerDidConnect)) { _ in monitor.refresh() }
        .onReceive(NotificationCenter.default.publisher(for: .GCControllerDidDisconnect)) { _ in monitor.refresh() }
        .onChange(of: scenePhase) { _, phase in if phase == .active { monitor.refresh() } }
    }

    private func number(_ value: Float) -> String {
        value.formatted(.number.precision(.fractionLength(2)))
    }
}
