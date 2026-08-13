import AppKit
import CoreServices
import Foundation

private let bundleIdentifier = "com.luanzeba.chrome-router"
private let chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
private let defaultUserDataDir = NSString(string: "~/.cache/pi-chrome-profile").expandingTildeInPath
private let debugPort = 9222

private struct Rule: Codable, Equatable {
    var host: String
    var pathPrefix: String?
    var profile: String
}

private struct DebugTarget: Decodable {
    let id: String
    let url: String
}

private struct RouterConfig: Codable {
    var profiles: [String: String]
    var rules: [Rule]

    static let defaults = RouterConfig(
        profiles: ["Home": "", "Work": ""],
        rules: [
            Rule(host: "github.com", pathPrefix: "/github", profile: "Work"),
            Rule(host: "app.datadoghq.com", pathPrefix: nil, profile: "Work"),
            Rule(host: "beta.team", pathPrefix: nil, profile: "Work"),
            Rule(host: "x.com", pathPrefix: nil, profile: "Home"),
            Rule(host: "traveljoy.com", pathPrefix: nil, profile: "Home"),
        ]
    )
}

private final class Router {
    private let fileManager = FileManager.default
    let configURL: URL
    private(set) var config: RouterConfig

    init() {
        let configuredPath = ProcessInfo.processInfo.environment["CHROME_ROUTER_CONFIG"]
        let path = configuredPath?.isEmpty == false
            ? NSString(string: configuredPath!).expandingTildeInPath
            : NSString(string: "~/.config/chrome-router/config.json").expandingTildeInPath
        configURL = URL(fileURLWithPath: path)

        if let data = try? Data(contentsOf: configURL) {
            if let decoded = try? JSONDecoder().decode(RouterConfig.self, from: data) {
                config = decoded
            } else {
                config = .defaults
                fputs("chrome-router: Invalid config at \(configURL.path); using defaults without overwriting it.\n", stderr)
            }
        } else {
            config = .defaults
            try? save()
        }
    }

    func route(_ url: URL, prompt: Bool = false) {
        if prompt {
            guard let profile = chooseProfile(for: url) else { return }
            remember(url, profile: profile)
            open(url, profile: profile)
            return
        }
        open(url, profile: matchingRule(for: url)?.profile)
    }

    func open(_ url: URL? = nil, profile: String? = nil) {
        guard fileManager.isExecutableFile(atPath: chromePath) else {
            showError("Google Chrome was not found at \(chromePath).")
            return
        }

        if url == nil {
            if let profile, profile.lowercased() != "last" {
                focusProfile(profile)
            } else {
                launchChrome(url: nil, profile: nil)
            }
            return
        }

        launchChrome(url: url, profile: profile)
    }

    @discardableResult
    private func launchChrome(url: URL?, profile: String?) -> Bool {
        if !debugEndpointAvailable(), ordinaryChromeIsRunning() {
            showError("Google Chrome is already running without remote debugging. Quit that Chrome instance, then try again.")
            return false
        }

        var arguments = [
            "--remote-debugging-port=\(debugPort)",
            "--remote-allow-origins=*",
            "--user-data-dir=\(defaultUserDataDir)",
            "--disable-search-engine-choice-screen",
            "--no-first-run",
        ]
        if let profile, profile.lowercased() != "last" {
            arguments.append("--profile-directory=\(resolveProfileDirectory(profile))")
        }
        if let url { arguments.append(url.absoluteString) }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: chromePath)
        process.arguments = arguments
        process.standardInput = FileHandle.nullDevice
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        do {
            try process.run()
            return true
        } catch {
            showError("Could not open Chrome: \(error.localizedDescription)")
            return false
        }
    }

    private func ordinaryChromeIsRunning() -> Bool {
        let process = Process()
        let output = Pipe()
        process.executableURL = URL(fileURLWithPath: "/bin/ps")
        process.arguments = ["-axo", "command="]
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice

        do {
            try process.run()
            let data = output.fileHandleForReading.readDataToEndOfFile()
            process.waitUntilExit()
            guard let commands = String(data: data, encoding: .utf8) else { return false }
            return commands.split(separator: "\n").contains { rawCommand in
                let command = rawCommand.trimmingCharacters(in: .whitespaces)
                return command.hasPrefix(chromePath) && !command.contains("--remote-debugging-port=\(debugPort)")
            }
        } catch {
            return false
        }
    }

    private func focusProfile(_ profile: String) {
        let profileName = canonicalProfile(profile)
        if debugEndpointAvailable(),
           let windowID = windowState()[profileName],
           activateWindow(windowID) {
            return
        }

        let marker = "http://127.0.0.1:9/chrome-router-focus/\(UUID().uuidString)"
        guard launchChrome(url: URL(string: marker), profile: profileName) else { return }

        guard waitForDebugTarget(matching: marker) else {
            fputs("chrome-router: Chrome did not expose the profile window on :\(debugPort).\n", stderr)
            closeDebugTarget(matching: marker)
            return
        }

        let script = """
        tell application "Google Chrome"
          repeat 40 times
            repeat with w in windows
              try
                set candidate to first tab of w whose URL is "\(marker)"
                set tabTotal to count tabs of w
                set windowID to id of w as text
                set index of w to 1
                activate
                if tabTotal > 1 then
                  close candidate
                else
                  set URL of candidate to "chrome://newtab/"
                end if
                return windowID
              end try
            end repeat
            delay 0.05
          end repeat
          return ""
        end tell
        """

        var error: NSDictionary?
        if let result = NSAppleScript(source: script)?.executeAndReturnError(&error).stringValue,
           let windowID = Int(result) {
            var state = windowState()
            state[profileName] = windowID
            saveWindowState(state)
            return
        }

        if let error {
            fputs("chrome-router: Could not inspect Chrome windows: \(error)\n", stderr)
        }
        closeDebugTarget(matching: marker)
    }

    private func debugTargets() -> [DebugTarget] {
        guard let listURL = URL(string: "http://127.0.0.1:\(debugPort)/json/list"),
              let data = try? Data(contentsOf: listURL) else { return [] }
        return (try? JSONDecoder().decode([DebugTarget].self, from: data)) ?? []
    }

    private func debugEndpointAvailable() -> Bool {
        guard let versionURL = URL(string: "http://127.0.0.1:\(debugPort)/json/version") else { return false }
        return (try? Data(contentsOf: versionURL)) != nil
    }

    private func waitForDebugTarget(matching url: String) -> Bool {
        for _ in 0..<100 {
            if debugTargets().contains(where: { $0.url == url }) { return true }
            Thread.sleep(forTimeInterval: 0.05)
        }
        return false
    }

    private func closeDebugTarget(matching url: String) {
        for _ in 0..<40 {
            if let target = debugTargets().first(where: { $0.url == url }),
               let closeURL = URL(string: "http://127.0.0.1:\(debugPort)/json/close/\(target.id)") {
                _ = try? Data(contentsOf: closeURL)
                return
            }
            Thread.sleep(forTimeInterval: 0.05)
        }
    }

    private func activateWindow(_ windowID: Int) -> Bool {
        let script = """
        tell application "Google Chrome"
          try
            set targetWindow to first window whose id is \(windowID)
            set index of targetWindow to 1
            activate
            return "found"
          on error
            return "missing"
          end try
        end tell
        """
        var error: NSDictionary?
        return NSAppleScript(source: script)?.executeAndReturnError(&error).stringValue == "found"
    }

    private func windowState() -> [String: Int] {
        let url = windowStateURL()
        guard let data = try? Data(contentsOf: url) else { return [:] }
        return (try? JSONDecoder().decode([String: Int].self, from: data)) ?? [:]
    }

    private func saveWindowState(_ state: [String: Int]) {
        let url = windowStateURL()
        try? fileManager.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        if let data = try? JSONEncoder().encode(state) {
            try? data.write(to: url, options: .atomic)
        }
    }

    private func windowStateURL() -> URL {
        URL(fileURLWithPath: NSString(string: "~/.cache/chrome-router/windows.json").expandingTildeInPath)
    }

    @discardableResult
    func remember(_ url: URL, profile: String) -> Rule {
        if let index = matchingRuleIndex(for: url) {
            config.rules[index].profile = canonicalProfile(profile)
            try? save()
            return config.rules[index]
        }

        let rule = Rule(host: normalizedHost(url.host ?? ""), pathPrefix: nil, profile: canonicalProfile(profile))
        config.rules.append(rule)
        try? save()
        return rule
    }

    func forget(_ url: URL) -> Rule? {
        guard let index = matchingRuleIndex(for: url) else { return nil }
        let rule = config.rules.remove(at: index)
        try? save()
        return rule
    }

    func matchingRule(for url: URL) -> Rule? {
        guard let index = matchingRuleIndex(for: url) else { return nil }
        return config.rules[index]
    }

    func setProfile(_ name: String, directory: String) {
        let existing = config.profiles.keys.first { $0.caseInsensitiveCompare(name) == .orderedSame }
        config.profiles[existing ?? name] = directory
        try? save()
    }

    func profileNames() -> [String] {
        let preferred = ["Work", "Home"].filter { name in
            config.profiles.keys.contains { $0.caseInsensitiveCompare(name) == .orderedSame }
        }
        let rest = config.profiles.keys
            .filter { name in !preferred.contains { $0.caseInsensitiveCompare(name) == .orderedSame } }
            .sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
        return preferred + rest
    }

    func resolveProfileDirectory(_ requestedProfile: String) -> String {
        let canonical = canonicalProfile(requestedProfile)
        let configuredDirectory = config.profiles.first { $0.key.caseInsensitiveCompare(canonical) == .orderedSame }?.value ?? ""
        let state = localState()
        let infoCache = state?["profile"] as? [String: Any]
        let entries = infoCache?["info_cache"] as? [String: Any] ?? [:]

        if !configuredDirectory.isEmpty {
            return configuredDirectory
        }

        for (directory, rawEntry) in entries {
            guard let entry = rawEntry as? [String: Any], let name = entry["name"] as? String else { continue }
            if name.caseInsensitiveCompare(canonical) == .orderedSame {
                return directory
            }
        }

        if let profile = state?["profile"] as? [String: Any],
           let lastUsed = profile["last_used"] as? String,
           !lastUsed.isEmpty {
            return lastUsed
        }
        return "Default"
    }

    func profileWasResolvedByName(_ profile: String) -> Bool {
        let canonical = canonicalProfile(profile)
        let state = localState()
        let profileState = state?["profile"] as? [String: Any]
        let entries = profileState?["info_cache"] as? [String: Any] ?? [:]
        let configuredDirectory = config.profiles.first { $0.key.caseInsensitiveCompare(canonical) == .orderedSame }?.value ?? ""
        if !configuredDirectory.isEmpty { return true }
        return entries.values.contains { rawEntry in
            guard let entry = rawEntry as? [String: Any], let name = entry["name"] as? String else { return false }
            return name.caseInsensitiveCompare(canonical) == .orderedSame
        }
    }

    func chooseProfile(for url: URL) -> String? {
        NSApp.setActivationPolicy(.accessory)
        NSApp.activate(ignoringOtherApps: true)

        let alert = NSAlert()
        alert.messageText = "Open with which Chrome profile?"
        alert.informativeText = url.host ?? url.absoluteString
        let profiles = profileNames()
        profiles.forEach { alert.addButton(withTitle: $0) }
        alert.addButton(withTitle: "Cancel")

        let response = alert.runModal()
        let index = response.rawValue - NSApplication.ModalResponse.alertFirstButtonReturn.rawValue
        guard index >= 0, index < profiles.count else { return nil }
        return profiles[index]
    }

    func promptForURL() -> URL? {
        if let value = NSPasteboard.general.string(forType: .string), let url = parseURL(value) {
            return url
        }

        NSApp.setActivationPolicy(.accessory)
        NSApp.activate(ignoringOtherApps: true)
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 420, height: 24))
        field.placeholderString = "https://example.com"
        let alert = NSAlert()
        alert.messageText = "Add a URL rule"
        alert.informativeText = "Paste the URL to remember."
        alert.accessoryView = field
        alert.addButton(withTitle: "Continue")
        alert.addButton(withTitle: "Cancel")
        guard alert.runModal() == .alertFirstButtonReturn else { return nil }
        return parseURL(field.stringValue)
    }

    func printRules() {
        if config.rules.isEmpty {
            print("No saved rules.")
            return
        }
        for rule in config.rules.sorted(by: ruleSort) {
            let path = rule.pathPrefix ?? "/*"
            print("\(rule.profile)\t\(rule.host)\(path)")
        }
    }

    private func canonicalProfile(_ name: String) -> String {
        config.profiles.keys.first { $0.caseInsensitiveCompare(name) == .orderedSame } ?? name
    }

    private func matchingRuleIndex(for url: URL) -> Int? {
        config.rules.indices
            .filter { ruleMatches(config.rules[$0], url: url) }
            .max { lhs, rhs in ruleSpecificity(config.rules[lhs]) < ruleSpecificity(config.rules[rhs]) }
    }

    private func ruleMatches(_ rule: Rule, url: URL) -> Bool {
        let host = normalizedHost(url.host ?? "")
        let expectedHost = normalizedHost(rule.host)
        guard host == expectedHost || host.hasSuffix(".\(expectedHost)") else { return false }
        guard let prefix = rule.pathPrefix, !prefix.isEmpty, prefix != "/" else { return true }
        let normalizedPrefix = prefix.hasPrefix("/") ? prefix : "/\(prefix)"
        return url.path == normalizedPrefix || url.path.hasPrefix("\(normalizedPrefix)/")
    }

    private func ruleSpecificity(_ rule: Rule) -> Int {
        rule.host.count + (rule.pathPrefix?.count ?? 0) * 1000
    }

    private func ruleSort(_ lhs: Rule, _ rhs: Rule) -> Bool {
        if lhs.profile != rhs.profile { return lhs.profile < rhs.profile }
        if lhs.host != rhs.host { return lhs.host < rhs.host }
        return (lhs.pathPrefix ?? "") < (rhs.pathPrefix ?? "")
    }

    private func normalizedHost(_ host: String) -> String {
        let lower = host.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "."))
        return lower.hasPrefix("www.") ? String(lower.dropFirst(4)) : lower
    }

    private func localState() -> [String: Any]? {
        let url = URL(fileURLWithPath: defaultUserDataDir).appendingPathComponent("Local State")
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    }

    private func save() throws {
        try fileManager.createDirectory(at: configURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(config)
        try data.write(to: configURL, options: .atomic)
    }

    private func showError(_ message: String) {
        fputs("chrome-router: \(message)\n", stderr)
        if NSApp.activationPolicy() != .prohibited {
            let alert = NSAlert()
            alert.alertStyle = .critical
            alert.messageText = "Chrome Router"
            alert.informativeText = message
            alert.runModal()
        }
    }
}

private func parseURL(_ value: String) -> URL? {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty, !trimmed.contains(where: { $0.isWhitespace }) else { return nil }
    let withScheme = trimmed.contains("://") ? trimmed : "https://\(trimmed)"
    guard let url = URL(string: withScheme), let scheme = url.scheme?.lowercased(), ["http", "https"].contains(scheme), url.host != nil else {
        return nil
    }
    return url
}

private func hyperIsPressed(_ flags: NSEvent.ModifierFlags? = nil) -> Bool {
    let required: NSEvent.ModifierFlags = [.command, .control, .option, .shift]
    let currentFlags = NSEvent.ModifierFlags(rawValue: UInt(CGEventSource.flagsState(.combinedSessionState).rawValue))
    let combined = (flags ?? NSEvent.modifierFlags).union(currentFlags)
    return combined.intersection(required) == required
}

private func setAsDefaultBrowser() -> Bool {
    let http = LSSetDefaultHandlerForURLScheme("http" as CFString, bundleIdentifier as CFString)
    let https = LSSetDefaultHandlerForURLScheme("https" as CFString, bundleIdentifier as CFString)
    if http == noErr, https == noErr {
        print("Chrome Router is now the default URL handler.")
        return true
    }
    fputs("chrome-router: Could not set the default handler (http=\(http), https=\(https)).\n", stderr)
    return false
}

private func isDefaultBrowser() -> Bool {
    for scheme in ["http", "https"] {
        guard let url = URL(string: "\(scheme)://example.invalid"),
              let appURL = NSWorkspace.shared.urlForApplication(toOpen: url),
              Bundle(url: appURL)?.bundleIdentifier == bundleIdentifier else {
            return false
        }
    }
    return true
}

private func requestDefaultBrowserChange() -> Bool {
    let appPath = NSString(string: "~/Applications/Chrome Router.app").expandingTildeInPath
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
    process.arguments = ["-na", appPath, "--args", "request-default"]
    do {
        try process.run()
        process.waitUntilExit()
        return process.terminationStatus == 0
    } catch {
        fputs("chrome-router: Could not launch Chrome Router.app: \(error.localizedDescription)\n", stderr)
        return false
    }
}

private func usage() {
    print("""
    Usage: chrome-router <command> [arguments]

      open [Home|Work|last] [URL]   Focus a profile or open a URL there
      choose [URL]                  Pick a profile and remember it (uses clipboard if omitted)
      remember <profile> [URL]      Save the URL's domain for a profile
      forget [URL]                  Remove the matching rule
      route <URL>                   Route using saved rules, otherwise last-used profile
      rules                         List saved rules
      profiles                      Show profile resolution
      profile <name> <directory>     Map a name to a Chrome profile directory
      config                        Print the config path
      default                       Make Chrome Router the macOS URL handler
      status                        Show default-handler and profile status
      self-test                     Run routing checks
    """)
}

private func runCLI(_ arguments: [String]) -> Int32 {
    let router = Router()
    guard let command = arguments.first else { usage(); return 0 }

    switch command {
    case "open":
        let profile = arguments.count > 1 ? arguments[1] : "last"
        let url = arguments.count > 2 ? parseURL(arguments[2]) : nil
        router.open(url, profile: profile)
    case "choose", "add":
        let url = arguments.count > 1 ? parseURL(arguments[1]) : router.promptForURL()
        guard let url else { return 1 }
        router.route(url, prompt: true)
    case "remember":
        guard arguments.count > 1 else { usage(); return 1 }
        let url = arguments.count > 2 ? parseURL(arguments[2]) : router.promptForURL()
        guard let url else { return 1 }
        let rule = router.remember(url, profile: arguments[1])
        print("Remembered \(rule.host)\(rule.pathPrefix ?? "/*") → \(rule.profile)")
    case "forget":
        let url = arguments.count > 1 ? parseURL(arguments[1]) : router.promptForURL()
        guard let url else { return 1 }
        if let rule = router.forget(url) {
            print("Forgot \(rule.host)\(rule.pathPrefix ?? "/*")")
        } else {
            print("No matching rule.")
        }
    case "route":
        guard arguments.count > 1, let url = parseURL(arguments[1]) else { usage(); return 1 }
        router.route(url)
    case "rules":
        router.printRules()
    case "profiles":
        for profile in router.profileNames() {
            let directory = router.resolveProfileDirectory(profile)
            let suffix = router.profileWasResolvedByName(profile) ? "" : " (fallback: profile name not found)"
            print("\(profile) → \(directory)\(suffix)")
        }
    case "profile":
        guard arguments.count > 2 else { usage(); return 1 }
        router.setProfile(arguments[1], directory: arguments[2])
        print("\(arguments[1]) → \(arguments[2])")
    case "config":
        print(router.configURL.path)
    case "default":
        return requestDefaultBrowserChange() ? 0 : 1
    case "request-default":
        return setAsDefaultBrowser() ? 0 : 1
    case "is-default":
        return isDefaultBrowser() ? 0 : 1
    case "status":
        print("Default URL handler: \(isDefaultBrowser() ? "yes" : "no")")
        print("Config: \(router.configURL.path)")
        for profile in router.profileNames() {
            let directory = router.resolveProfileDirectory(profile)
            let suffix = router.profileWasResolvedByName(profile) ? "" : " (fallback: profile name not found)"
            print("\(profile) → \(directory)\(suffix)")
        }
    case "self-test":
        let temporaryConfig = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("chrome-router-self-test-\(UUID().uuidString).json")
        let data = try? JSONEncoder().encode(RouterConfig.defaults)
        try? data?.write(to: temporaryConfig)
        setenv("CHROME_ROUTER_CONFIG", temporaryConfig.path, 1)
        let testRouter = Router()
        defer { try? FileManager.default.removeItem(at: temporaryConfig) }
        guard testRouter.matchingRule(for: URL(string: "https://github.com/github/test")!)?.profile == "Work",
              testRouter.matchingRule(for: URL(string: "https://app.beta.team/test")!)?.profile == "Work",
              testRouter.matchingRule(for: URL(string: "https://www.traveljoy.com/test")!)?.profile == "Home",
              testRouter.matchingRule(for: URL(string: "https://example.com")!) == nil,
              parseURL("not a URL") == nil else {
            fputs("chrome-router: self-test failed\n", stderr)
            return 1
        }
        print("Chrome Router self-test passed.")
    case "help", "--help", "-h":
        usage()
    default:
        if let url = parseURL(command) {
            router.route(url)
        } else {
            usage()
            return 1
        }
    }
    return 0
}

private final class AppDelegate: NSObject, NSApplicationDelegate {
    private let router = Router()
    private var lastHyperClick = Date.distantPast
    private var clickMonitor: Any?

    func applicationWillFinishLaunching(_ notification: Notification) {
        NSAppleEventManager.shared().setEventHandler(
            self,
            andSelector: #selector(handleURL(_:reply:)),
            forEventClass: AEEventClass(kInternetEventClass),
            andEventID: AEEventID(kAEGetURL)
        )
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        clickMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] event in
            if hyperIsPressed(event.modifierFlags) {
                self?.lastHyperClick = Date()
            }
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        if let clickMonitor { NSEvent.removeMonitor(clickMonitor) }
    }

    @objc private func handleURL(_ event: NSAppleEventDescriptor, reply: NSAppleEventDescriptor) {
        guard let value = event.paramDescriptor(forKeyword: AEKeyword(keyDirectObject))?.stringValue,
              let url = parseURL(value) else { return }
        let followedHyperClick = Date().timeIntervalSince(lastHyperClick) < 1.5
        router.route(url, prompt: followedHyperClick || hyperIsPressed())
    }
}

let arguments = Array(CommandLine.arguments.dropFirst())
if !arguments.isEmpty {
    exit(runCLI(arguments))
}

let app = NSApplication.shared
private let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
