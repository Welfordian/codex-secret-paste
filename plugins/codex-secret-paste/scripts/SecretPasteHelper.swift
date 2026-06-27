import AppKit
import CoreGraphics
import Foundation
import Security

private let serviceName = "codex-secret-paste"
private let codexBundleId = "com.openai.codex"
private let keyCodeV: Int64 = 9
private let defaultShortcut = "CMD+SHIFT+V"

private enum SecurePasteShortcut: String {
    case commandShiftV = "CMD+SHIFT+V"
    case controlShiftV = "CTRL+SHIFT+V"

    static let defaultValue: SecurePasteShortcut = .commandShiftV

    init(configValue: String?) {
        let normalized = normalizeShortcut(configValue)
        switch normalized {
        case SecurePasteShortcut.controlShiftV.rawValue:
            self = .controlShiftV
        default:
            self = .defaultValue
        }
    }

    func matches(_ flags: CGEventFlags) -> Bool {
        switch self {
        case .commandShiftV:
            return flags.contains(.maskCommand)
                && flags.contains(.maskShift)
                && !flags.contains(.maskControl)
                && !flags.contains(.maskAlternate)
        case .controlShiftV:
            return flags.contains(.maskControl)
                && flags.contains(.maskShift)
                && !flags.contains(.maskCommand)
                && !flags.contains(.maskAlternate)
        }
    }
}

private func normalizeShortcut(_ value: String?) -> String {
    guard let value else {
        return defaultShortcut
    }
    let separators = CharacterSet.alphanumerics.inverted
    let tokens = value
        .uppercased()
        .replacingOccurrences(of: "COMMAND", with: "CMD")
        .replacingOccurrences(of: "CONTROL", with: "CTRL")
        .components(separatedBy: separators)
        .filter { !$0.isEmpty }
    let tokenSet = Set(tokens)
    var ordered: [String] = []
    if tokenSet.contains("CMD") {
        ordered.append("CMD")
    }
    if tokenSet.contains("CTRL") {
        ordered.append("CTRL")
    }
    if tokenSet.contains("SHIFT") {
        ordered.append("SHIFT")
    }
    if tokenSet.contains("V") {
        ordered.append("V")
    }
    return ordered.joined(separator: "+")
}

private func stateRootURL() -> URL {
    FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".codex-secret-paste", isDirectory: true)
}

private func configFileURL() -> URL {
    stateRootURL().appendingPathComponent("config.json")
}

private func readConfiguredShortcut() -> SecurePasteShortcut {
    guard let data = try? Data(contentsOf: configFileURL()),
          let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        return .defaultValue
    }
    return SecurePasteShortcut(configValue: json["shortcut"] as? String)
}

private func validateHandle(_ handle: String) throws {
    let prefix = "secret-"
    let suffix = handle.dropFirst(prefix.count)
    let isValid = handle.hasPrefix(prefix)
        && suffix.count >= 6
        && suffix.count <= 80
        && suffix.allSatisfy { character in
            character.isASCII
                && (character.isLetter || character.isNumber || character == "_" || character == "-")
        }
    if !isValid {
        throw NSError(domain: "SecretPasteHelper", code: 2, userInfo: [NSLocalizedDescriptionKey: "Invalid secret handle."])
    }
}

private func storeSecretInKeychain(_ secret: String, handle: String) throws {
    try validateHandle(handle)
    guard let data = secret.data(using: .utf8) else {
        throw NSError(domain: "SecretPasteHelper", code: 1, userInfo: [NSLocalizedDescriptionKey: "Secret is not UTF-8 text."])
    }

    let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: serviceName,
        kSecAttrAccount as String: handle
    ]
    SecItemDelete(query as CFDictionary)

    var addQuery = query
    addQuery[kSecValueData as String] = data
    addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly

    let status = SecItemAdd(addQuery as CFDictionary, nil)
    if status != errSecSuccess {
        throw NSError(domain: NSOSStatusErrorDomain, code: Int(status), userInfo: [NSLocalizedDescriptionKey: "Keychain write failed with status \(status)."])
    }
}

private func readSecretFromKeychain(handle: String) throws -> String {
    try validateHandle(handle)
    let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: serviceName,
        kSecAttrAccount as String: handle,
        kSecReturnData as String: true,
        kSecMatchLimit as String: kSecMatchLimitOne
    ]

    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    if status != errSecSuccess {
        throw NSError(domain: NSOSStatusErrorDomain, code: Int(status), userInfo: [NSLocalizedDescriptionKey: "Keychain read failed with status \(status)."])
    }
    guard let data = item as? Data, let value = String(data: data, encoding: .utf8) else {
        throw NSError(domain: "SecretPasteHelper", code: 3, userInfo: [NSLocalizedDescriptionKey: "Secret is not UTF-8 text."])
    }
    return value
}

private func deleteSecretFromKeychain(handle: String) throws {
    try validateHandle(handle)
    let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: serviceName,
        kSecAttrAccount as String: handle
    ]
    let status = SecItemDelete(query as CFDictionary)
    if status != errSecSuccess && status != errSecItemNotFound {
        throw NSError(domain: NSOSStatusErrorDomain, code: Int(status), userInfo: [NSLocalizedDescriptionKey: "Keychain delete failed with status \(status)."])
    }
}

private func runCommandModeIfRequested() -> Bool {
    let args = CommandLine.arguments
    guard args.count >= 3 else {
        return false
    }

    do {
        switch args[1] {
        case "store-secret":
            let data = FileHandle.standardInput.readDataToEndOfFile()
            guard let value = String(data: data, encoding: .utf8) else {
                throw NSError(domain: "SecretPasteHelper", code: 4, userInfo: [NSLocalizedDescriptionKey: "Secret stdin is not UTF-8 text."])
            }
            try storeSecretInKeychain(value, handle: args[2])
            return true
        case "read-secret":
            let value = try readSecretFromKeychain(handle: args[2])
            FileHandle.standardOutput.write(Data(value.utf8))
            return true
        case "delete-secret":
            try deleteSecretFromKeychain(handle: args[2])
            return true
        default:
            return false
        }
    } catch {
        fputs("\(error.localizedDescription)\n", stderr)
        exit(1)
    }
}

private struct PasteboardItemSnapshot {
    let dataByType: [(NSPasteboard.PasteboardType, Data)]
}

private struct PasteboardSnapshot {
    let items: [PasteboardItemSnapshot]
    let fallbackString: String?

    init(_ pasteboard: NSPasteboard) {
        fallbackString = pasteboard.string(forType: .string)
        items = (pasteboard.pasteboardItems ?? []).map { item in
            let values = item.types.compactMap { type -> (NSPasteboard.PasteboardType, Data)? in
                guard let data = item.data(forType: type) else {
                    return nil
                }
                return (type, data)
            }
            return PasteboardItemSnapshot(dataByType: values)
        }.filter { !$0.dataByType.isEmpty }
    }

    func restore(to pasteboard: NSPasteboard) {
        pasteboard.clearContents()
        if !items.isEmpty {
            let restoredItems = items.map { snapshot in
                let item = NSPasteboardItem()
                for (type, data) in snapshot.dataByType {
                    item.setData(data, forType: type)
                }
                return item
            }
            pasteboard.writeObjects(restoredItems)
            return
        }
        if let fallbackString {
            pasteboard.setString(fallbackString, forType: .string)
        }
    }
}

final class SecretPasteHelper {
    private var eventTap: CFMachPort?
    private var runLoopSource: CFRunLoopSource?
    private var lastHandledAt = Date.distantPast
    private var shortcutCacheLoadedAt = Date.distantPast
    private var shortcutCache = SecurePasteShortcut.defaultValue

    func run() {
        while eventTap == nil {
            requestAccessibilityIfNeeded()
            installEventTap()
            if eventTap == nil {
                fputs("Codex Secret Paste helper is waiting for Accessibility permission.\n", stderr)
                Thread.sleep(forTimeInterval: 10)
            }
        }
        CFRunLoopRun()
    }

    private func requestAccessibilityIfNeeded() {
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        _ = AXIsProcessTrustedWithOptions(options)
    }

    private func installEventTap() {
        let mask = CGEventMask(1 << CGEventType.keyDown.rawValue)
        let callback: CGEventTapCallBack = { _, type, event, userInfo in
            guard let userInfo else {
                return Unmanaged.passUnretained(event)
            }
            let helper = Unmanaged<SecretPasteHelper>.fromOpaque(userInfo).takeUnretainedValue()
            return helper.handleEvent(type: type, event: event)
        }

        eventTap = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .defaultTap,
            eventsOfInterest: mask,
            callback: callback,
            userInfo: Unmanaged.passUnretained(self).toOpaque()
        )

        guard let eventTap else {
            return
        }

        runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, eventTap, 0)
        CFRunLoopAddSource(CFRunLoopGetCurrent(), runLoopSource, .commonModes)
        CGEvent.tapEnable(tap: eventTap, enable: true)
    }

    private func handleEvent(type: CGEventType, event: CGEvent) -> Unmanaged<CGEvent>? {
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            if let eventTap {
                CGEvent.tapEnable(tap: eventTap, enable: true)
            }
            return Unmanaged.passUnretained(event)
        }

        guard type == .keyDown else {
            return Unmanaged.passUnretained(event)
        }
        guard matchesConfiguredShortcut(event), frontmostAppIsCodex() else {
            return Unmanaged.passUnretained(event)
        }
        guard event.getIntegerValueField(.keyboardEventAutorepeat) == 0 else {
            return nil
        }

        let now = Date()
        guard now.timeIntervalSince(lastHandledAt) > 0.25 else {
            return nil
        }
        lastHandledAt = now

        securePaste()
        return nil
    }

    private func matchesConfiguredShortcut(_ event: CGEvent) -> Bool {
        let flags = event.flags
        let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
        guard keyCode == keyCodeV else {
            return false
        }
        return configuredShortcut().matches(flags)
    }

    private func configuredShortcut() -> SecurePasteShortcut {
        let now = Date()
        if now.timeIntervalSince(shortcutCacheLoadedAt) > 1 {
            shortcutCache = readConfiguredShortcut()
            shortcutCacheLoadedAt = now
        }
        return shortcutCache
    }

    private func frontmostAppIsCodex() -> Bool {
        NSWorkspace.shared.frontmostApplication?.bundleIdentifier == codexBundleId
    }

    private func securePaste() {
        let pasteboard = NSPasteboard.general
        guard let secret = pasteboard.string(forType: .string), !secret.isEmpty else {
            NSSound.beep()
            return
        }
        let originalPasteboard = PasteboardSnapshot(pasteboard)

        let handle = "secret-" + randomHex(byteCount: 8)
        let placeholder = "@secret(\(handle))"

        do {
            try storeSecretInKeychain(secret, handle: handle)
            try writeMetadata(handle: handle, placeholder: placeholder)
            pastePlaceholder(placeholder, restoring: originalPasteboard)
        } catch {
            fputs("Codex Secret Paste helper failed to store a secret handle: \(error.localizedDescription)\n", stderr)
            NSSound.beep()
        }
    }

    private func randomHex(byteCount: Int) -> String {
        var bytes = [UInt8](repeating: 0, count: byteCount)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        if status != errSecSuccess {
            return UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased().prefix(byteCount * 2).description
        }
        return bytes.map { String(format: "%02x", $0) }.joined()
    }

    private func writeMetadata(handle: String, placeholder: String) throws {
        let root = stateRootURL()
            .appendingPathComponent("secrets", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)

        let metadata: [String: Any] = [
            "handle": handle,
            "placeholder": placeholder,
            "createdAt": ISO8601DateFormatter().string(from: Date()),
            "source": "macos-helper",
            "helperPath": CommandLine.arguments[0]
        ]
        let data = try JSONSerialization.data(withJSONObject: metadata, options: [.prettyPrinted, .sortedKeys])
        let target = root.appendingPathComponent("\(handle).json")
        try data.write(to: target, options: [.atomic])
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: target.path)
    }

    private func sendCommandV() {
        guard let source = CGEventSource(stateID: .hidSystemState) else {
            return
        }
        let down = CGEvent(keyboardEventSource: source, virtualKey: CGKeyCode(keyCodeV), keyDown: true)
        let up = CGEvent(keyboardEventSource: source, virtualKey: CGKeyCode(keyCodeV), keyDown: false)
        down?.flags = .maskCommand
        up?.flags = .maskCommand
        down?.post(tap: .cghidEventTap)
        up?.post(tap: .cghidEventTap)
    }

    private func pastePlaceholder(_ placeholder: String, restoring originalPasteboard: PasteboardSnapshot) {
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(placeholder, forType: .string)
        let placeholderChangeCount = pasteboard.changeCount
        sendCommandV()

        let timer = Timer(timeInterval: 0.35, repeats: false) { _ in
            let stillPlaceholder = pasteboard.string(forType: .string) == placeholder
            if pasteboard.changeCount == placeholderChangeCount || stillPlaceholder {
                originalPasteboard.restore(to: pasteboard)
            }
        }
        RunLoop.main.add(timer, forMode: .common)
    }
}

if !runCommandModeIfRequested() {
    SecretPasteHelper().run()
}
