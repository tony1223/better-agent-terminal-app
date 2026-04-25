import Foundation
import CryptoKit
import React

@objc(TLSWebSocket)
class TLSWebSocket: RCTEventEmitter, URLSessionDelegate, URLSessionWebSocketDelegate {

  private var webSocketTask: URLSessionWebSocketTask?
  private var session: URLSession?
  private var pinnedFingerprint: String?
  private var hasListeners = false

  override init() {
    super.init()
  }

  @objc override static func requiresMainQueueSetup() -> Bool { false }

  override func supportedEvents() -> [String]! {
    ["TLSWebSocket_onOpen", "TLSWebSocket_onMessage", "TLSWebSocket_onClose", "TLSWebSocket_onError"]
  }

  override func startObserving() { hasListeners = true }
  override func stopObserving() { hasListeners = false }

  private func emit(_ name: String, _ body: [String: Any]) {
    guard hasListeners else { return }
    sendEvent(withName: name, body: body)
  }

  // MARK: - Public API

  @objc(connect:fingerprint:)
  func connect(_ url: String, fingerprint: String?) {
    close(1000, reason: "reconnect")

    guard let wsURL = URL(string: url) else {
      emit("TLSWebSocket_onError", ["message": "Invalid URL: \(url)"])
      return
    }

    pinnedFingerprint = fingerprint?.uppercased().replacingOccurrences(of: ":", with: "")

    let config = URLSessionConfiguration.default
    config.timeoutIntervalForRequest = 15
    session = URLSession(configuration: config, delegate: self, delegateQueue: OperationQueue())

    webSocketTask = session?.webSocketTask(with: wsURL)
    webSocketTask?.resume()
    listenForMessages()
  }

  @objc(send:)
  func send(_ message: String) {
    webSocketTask?.send(.string(message)) { [weak self] error in
      if let error = error {
        self?.emit("TLSWebSocket_onError", ["message": "Send failed: \(error.localizedDescription)"])
      }
    }
  }

  @objc(close:reason:)
  func close(_ code: Int, reason: String?) {
    if let task = webSocketTask {
      task.cancel(with: URLSessionWebSocketTask.CloseCode(rawValue: code) ?? .normalClosure,
                  reason: reason?.data(using: .utf8))
    }
    webSocketTask = nil
    session?.invalidateAndCancel()
    session = nil
  }

  // MARK: - Message Loop

  private func listenForMessages() {
    webSocketTask?.receive { [weak self] result in
      guard let self = self else { return }
      switch result {
      case .success(let message):
        switch message {
        case .string(let text):
          self.emit("TLSWebSocket_onMessage", ["data": text])
        case .data(let data):
          if let text = String(data: data, encoding: .utf8) {
            self.emit("TLSWebSocket_onMessage", ["data": text])
          }
        @unknown default:
          break
        }
        self.listenForMessages()
      case .failure(let error):
        let nsError = error as NSError
        if nsError.code != 57 && nsError.code != 89 {
          self.emit("TLSWebSocket_onError", ["message": error.localizedDescription])
        }
      }
    }
  }

  // MARK: - URLSessionDelegate (TLS Certificate Validation)

  func urlSession(_ session: URLSession,
                  didReceive challenge: NSURLAuthenticationChallenge,
                  completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {

    guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
          let serverTrust = challenge.protectionSpace.serverTrust else {
      completionHandler(.performDefaultHandling, nil)
      return
    }

    // No fingerprint pinning → accept any cert (backward compat with plain ws://)
    guard let pinned = pinnedFingerprint, !pinned.isEmpty else {
      completionHandler(.useCredential, URLCredential(trust: serverTrust))
      return
    }

    // Extract leaf certificate
    var cert: SecCertificate?
    if #available(iOS 15.0, *) {
      if let chain = SecTrustCopyCertificateChain(serverTrust) as? [SecCertificate], let leaf = chain.first {
        cert = leaf
      }
    } else {
      cert = SecTrustGetCertificateAtIndex(serverTrust, 0)
    }

    guard let leafCert = cert else {
      emit("TLSWebSocket_onError", ["message": "TLS error: no server certificate"])
      completionHandler(.cancelAuthenticationChallenge, nil)
      return
    }

    // SHA-256 fingerprint of DER-encoded certificate
    let certData = SecCertificateCopyData(leafCert) as Data
    let hash = sha256(certData)
    let fingerprint = hash.map { String(format: "%02X", $0) }.joined()

    if fingerprint == pinned {
      completionHandler(.useCredential, URLCredential(trust: serverTrust))
    } else {
      let colonize: (String) -> String = { hex in
        stride(from: 0, to: hex.count, by: 2).map {
          let start = hex.index(hex.startIndex, offsetBy: $0)
          let end = hex.index(start, offsetBy: 2)
          return String(hex[start..<end])
        }.joined(separator: ":")
      }
      emit("TLSWebSocket_onError", [
        "message": "TLS fingerprint mismatch. Expected: \(colonize(pinned)), Got: \(colonize(fingerprint))"
      ])
      completionHandler(.cancelAuthenticationChallenge, nil)
    }
  }

  // MARK: - URLSessionWebSocketDelegate

  func urlSession(_ session: URLSession,
                  webSocketTask: URLSessionWebSocketTask,
                  didOpenWithProtocol protocol: String?) {
    emit("TLSWebSocket_onOpen", [:])
  }

  func urlSession(_ session: URLSession,
                  webSocketTask: URLSessionWebSocketTask,
                  didCloseWith closeCode: URLSessionWebSocketTask.CloseCode,
                  reason: Data?) {
    let reasonStr = reason.flatMap { String(data: $0, encoding: .utf8) } ?? ""
    emit("TLSWebSocket_onClose", ["code": closeCode.rawValue, "reason": reasonStr])
  }

  // MARK: - SHA-256

  private func sha256(_ data: Data) -> [UInt8] {
    let digest = SHA256.hash(data: data)
    return Array(digest)
  }
}
