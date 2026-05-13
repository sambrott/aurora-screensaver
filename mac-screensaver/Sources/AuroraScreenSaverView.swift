import AppKit
import OSLog
import ScreenSaver
import WebKit

private let saverLog = OSLog(
    subsystem: "com.github.sambrott.AuroraScreenSaver",
    category: "web"
)

// file:// ES modules remain unreliable inside ScreenSaver WKWebViews; ship assets over a synthetic origin.
private final class AuroraLocalSchemeHandler: NSObject, WKURLSchemeHandler {

    /// Must match URLs passed to WKWebView.load(_:).
    static let scheme = "aurora-local"

    private let webRoot: URL

    init(webRoot: URL) {
        self.webRoot = webRoot.standardizedFileURL
        super.init()
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let requested = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(Self.err(code: NSURLErrorBadURL, "Missing URL"))
            return
        }
        do {
            let fileURL = try Self.resolve(requested, under: webRoot)
            guard FileManager.default.fileExists(atPath: fileURL.path),
                  FileManager.default.isReadableFile(atPath: fileURL.path),
                  Self.isProbablyFile(at: fileURL) else {
                os_log("%{public}@", log: saverLog, type: .fault, "aurora-local: missing \(fileURL.path)")
                urlSchemeTask.didFailWithError(Self.err(code: NSFileNoSuchFileError, requested.path))
                return
            }

            let data = try Data(contentsOf: fileURL, options: .mappedIfSafe)
            let mime = Self.mime(for: fileURL.pathExtension.lowercased())

            guard let resp = HTTPURLResponse(
                url: requested,
                statusCode: 200,
                httpVersion: "HTTP/1.1",
                headerFields: Self.headers(mimeType: mime)
            ) else {
                urlSchemeTask.didFailWithError(Self.err(code: NSURLErrorUnknown, "Bad response"))
                return
            }

            urlSchemeTask.didReceive(resp)
            urlSchemeTask.didReceive(data)
            urlSchemeTask.didFinish()
        } catch {
            os_log("%{public}@", log: saverLog, type: .error, String(describing: error))
            urlSchemeTask.didFailWithError(error)
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}

    private static func resolve(_ requested: URL, under webRoot: URL) throws -> URL {
        guard requested.scheme?.lowercased() == AuroraLocalSchemeHandler.scheme else {
            throw err(code: NSURLErrorUnsupportedURL, "Wrong scheme")
        }
        let decoded = (requested.path.removingPercentEncoding ?? requested.path)
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))

        let segments = decoded.split(separator: "/", omittingEmptySubsequences: true)

        var stack: [Substring] = []
        for part in segments {
            if part == "." { continue }
            if part == ".." {
                guard !stack.isEmpty else {
                    throw err(code: NSFileReadInvalidFileNameError, "path traversal beyond root")
                }
                stack.removeLast()
            } else {
                stack.append(part)
            }
        }

        let relative = stack.joined(separator: "/")
        let finalRelative = relative.isEmpty ? "index.html" : relative

        let resolved = webRoot.appendingPathComponent(finalRelative, isDirectory: false).standardizedFileURL

        let rootPath = webRoot.standardizedFileURL.path
        let outPath = resolved.path
        let allowedPrefix = rootPath.hasSuffix("/") ? rootPath : rootPath + "/"

        guard outPath == rootPath || outPath.hasPrefix(allowedPrefix) else {
            throw err(code: NSFileReadInvalidFileNameError, "Outside bundle Web root")
        }
        return resolved
    }

    private static func isProbablyFile(at url: URL) -> Bool {
        var isDirectory: ObjCBool = false
        FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory)
        return !isDirectory.boolValue
    }

    /// MIME + permissive CORS—module/link still perform fetch-style checks WebKit validates.
    private static func headers(mimeType: String) -> [String: String] {
        [
            "Content-Type": mimeType,
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET",
            "Access-Control-Allow-Headers": "*",
            "Cross-Origin-Resource-Policy": "cross-origin",
        ]
    }

    private static func mime(for ext: String) -> String {
        switch ext {
        case "html", "htm": return "text/html; charset=utf-8"
        case "js", "mjs": return "application/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json", "map": return "application/json; charset=utf-8"
        case "svg": return "image/svg+xml; charset=utf-8"
        case "woff2": return "font/woff2"
        case "woff": return "font/woff"
        case "webp": return "image/webp"
        case "png": return "image/png"
        case "wasm": return "application/wasm"
        default:
            return "application/octet-stream"
        }
    }

    private static func err(code: Int, _ message: String) -> NSError {
        NSError(domain: "AuroraScreenSaver", code: code, userInfo: [NSLocalizedDescriptionKey: message])
    }
}

private final class AuroraSaverNavigationDelegate: NSObject, WKNavigationDelegate {
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        os_log("WebKit web content process terminated", log: saverLog, type: .fault)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        os_log("%{public}@", log: saverLog, type: .error, String(describing: error))
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        os_log("%{public}@", log: saverLog, type: .error, String(describing: error))
    }
}

@objc(AuroraScreenSaverView)
public final class AuroraScreenSaverView: ScreenSaverView {

    /// Keep-alive for the scheme handler lifetime (beyond what the docs guarantee).
    private var schemeBinder: NSObject?
    private let navigationLogger = AuroraSaverNavigationDelegate()
    private var webView: WKWebView?
    private var isPreviewMode = false

    public override init?(frame frameRect: NSRect, isPreview: Bool) {
        super.init(frame: frameRect, isPreview: isPreview)
        self.isPreviewMode = isPreview
        wantsLayer = true
        layer?.backgroundColor = NSColor.black.cgColor
        animationTimeInterval = 1.0 / 60.0
    }

    public required init?(coder: NSCoder) { super.init(coder: coder) }

    public override func startAnimation() {
        super.startAnimation()
        ensureFullSize()
        installWebViewIfNeeded()
        webView?.frame = webViewTargetFrame()
    }

    private func ensureFullSize() {
        if bounds.width > 1, bounds.height > 1 { return }
        let target = NSScreen.main?.frame.size ?? NSSize(width: 1920, height: 1080)
        setFrameSize(target)
    }

    private func webViewTargetFrame() -> NSRect {
        if isPreviewMode, bounds.width > 1, bounds.height > 1 {
            return bounds
        }
        let screenSize = window?.screen?.frame.size
            ?? NSScreen.main?.frame.size
            ?? .zero
        if screenSize.width > 1, screenSize.height > 1 {
            if bounds.width > 1, bounds.height > 1 {
                return NSRect(
                    x: 0, y: 0,
                    width: min(bounds.width, screenSize.width),
                    height: min(bounds.height, screenSize.height)
                )
            }
            return NSRect(origin: .zero, size: screenSize)
        }
        return bounds
    }

    private func visibilityOverrideScripts() -> [WKUserScript] {
        let js = """
        try {
          Object.defineProperty(Document.prototype, 'hidden', {
            configurable: true, get: function() { return false; }
          });
          Object.defineProperty(Document.prototype, 'visibilityState', {
            configurable: true, get: function() { return 'visible'; }
          });
        } catch (e) {}
        """
        return [
            WKUserScript(
                source: js,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: false,
            ),
        ]
    }

    private func installWebViewIfNeeded() {
        guard webView == nil else { return }

        guard let resources = Bundle(for: AuroraScreenSaverView.self).resourceURL else {
            os_log("%{public}@", log: saverLog, type: .fault, "Missing Bundle resourceURL")
            return
        }

        let webRoot = resources.appendingPathComponent("Web", isDirectory: true)
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: webRoot.path, isDirectory: &isDirectory),
              isDirectory.boolValue else {
            os_log("%{public}@", log: saverLog, type: .fault, "Missing Web/")
            return
        }

        let indexOnDisk = webRoot.appendingPathComponent("index.html", isDirectory: false)
        guard FileManager.default.fileExists(atPath: indexOnDisk.path) else {
            os_log("%{public}@", log: saverLog, type: .fault, "Missing index.html")
            return
        }

        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        if #available(macOS 13.4, *) {
            config.limitsNavigationsToAppBoundDomains = false
        }

        let handler = AuroraLocalSchemeHandler(webRoot: webRoot)
        schemeBinder = handler
        config.setURLSchemeHandler(handler, forURLScheme: AuroraLocalSchemeHandler.scheme)

        visibilityOverrideScripts().forEach { config.userContentController.addUserScript($0) }

        let wv = WKWebView(frame: webViewTargetFrame(), configuration: config)
        wv.navigationDelegate = navigationLogger
        if #available(macOS 13.0, *) {
            wv.underPageBackgroundColor = NSColor(red: 0, green: 0, blue: 0, alpha: 1)
        }
        if #available(macOS 13.3, *) {
            wv.isInspectable = true
        }

        addSubview(wv)
        webView = wv

        guard let start = URL(string: "\(AuroraLocalSchemeHandler.scheme)://localhost/index.html") else {
            os_log("%{public}@", log: saverLog, type: .fault, "Bad start URL")
            return
        }
        wv.load(URLRequest(url: start))
    }

    public override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        webView?.frame = webViewTargetFrame()
    }

    public override func layout() {
        super.layout()
        webView?.frame = webViewTargetFrame()
    }

    public override func setFrameSize(_ newSize: NSSize) {
        super.setFrameSize(newSize)
        webView?.frame = webViewTargetFrame()
    }

    public override func resizeSubviews(withOldSize oldSize: NSSize) {
        super.resizeSubviews(withOldSize: oldSize)
        webView?.frame = webViewTargetFrame()
    }

    public override func stopAnimation() {
        webView?.stopLoading()
        webView?.navigationDelegate = nil
        webView?.removeFromSuperview()
        webView = nil
        schemeBinder = nil
        super.stopAnimation()
    }
}
