import Foundation
import CryptoKit
import React
import zlib

@objc(TLSWebSocket)
class TLSWebSocket: RCTEventEmitter, URLSessionDelegate, URLSessionWebSocketDelegate {

  private let batGzipMagic = Data("BATGZIP1\0".utf8)
  private var webSocketTask: URLSessionWebSocketTask?
  private var session: URLSession?
  private var pinnedFingerprint: String?
  private var connectionId: String?
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

  @objc(connect:fingerprint:connectionId:)
  func connect(_ url: String, fingerprint: String?, connectionId: String?) {
    close(1000, reason: "reconnect")

    guard let wsURL = URL(string: url) else {
      emit("TLSWebSocket_onError", ["connectionId": connectionId ?? "", "message": "Invalid URL: \(url)"])
      return
    }

    pinnedFingerprint = fingerprint?.uppercased().replacingOccurrences(of: ":", with: "")
    self.connectionId = connectionId

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
        self?.emit("TLSWebSocket_onError", [
          "connectionId": self?.connectionId ?? "",
          "message": "Send failed: \(error.localizedDescription)"
        ])
      }
    }
  }

  @objc(sendGzip:)
  func sendGzip(_ message: String) {
    do {
      let compressed = try gzipEncode(Data(message.utf8))
      var payload = batGzipMagic
      payload.append(compressed)
      webSocketTask?.send(.data(payload)) { [weak self] error in
        if let error = error {
          self?.emit("TLSWebSocket_onError", [
            "connectionId": self?.connectionId ?? "",
            "message": "Gzip send failed: \(error.localizedDescription)"
          ])
        }
      }
    } catch {
      emit("TLSWebSocket_onError", [
        "connectionId": connectionId ?? "",
        "message": "Gzip encode failed: \(error.localizedDescription)"
      ])
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
    connectionId = nil
  }

  // MARK: - Message Loop

  private func listenForMessages() {
    webSocketTask?.receive { [weak self] result in
      guard let self = self else { return }
      switch result {
      case .success(let message):
        switch message {
        case .string(let text):
          self.emit("TLSWebSocket_onMessage", ["connectionId": self.connectionId ?? "", "data": text])
        case .data(let data):
          do {
            let text = try self.decodeBatGzipFrame(data)
            self.emit("TLSWebSocket_onMessage", ["connectionId": self.connectionId ?? "", "data": text])
          } catch {
            self.emit("TLSWebSocket_onError", [
              "connectionId": self.connectionId ?? "",
              "message": error.localizedDescription
            ])
          }
        @unknown default:
          break
        }
        self.listenForMessages()
      case .failure(let error):
        let nsError = error as NSError
        if nsError.code != 57 && nsError.code != 89 {
          self.emit("TLSWebSocket_onError", [
            "connectionId": self.connectionId ?? "",
            "message": error.localizedDescription
          ])
        }
      }
    }
  }

  private func decodeBatGzipFrame(_ payload: Data) throws -> String {
    guard payload.starts(with: batGzipMagic) else {
      throw NSError(domain: "BATMobile", code: 1, userInfo: [
        NSLocalizedDescriptionKey: "BAT gzip frame has unsupported envelope"
      ])
    }
    let compressed = payload.dropFirst(batGzipMagic.count)
    let decompressed = try gzipDecode(Data(compressed))
    guard let text = String(data: decompressed, encoding: .utf8) else {
      throw NSError(domain: "BATMobile", code: 2, userInfo: [
        NSLocalizedDescriptionKey: "BAT gzip frame is not valid UTF-8"
      ])
    }
    return text
  }

  private func gzipEncode(_ data: Data) throws -> Data {
    try withZlibStream(data, operation: "deflate") { stream in
      deflateInit2_(
        &stream,
        Z_DEFAULT_COMPRESSION,
        Z_DEFLATED,
        MAX_WBITS + 16,
        8,
        Z_DEFAULT_STRATEGY,
        ZLIB_VERSION,
        Int32(MemoryLayout<z_stream>.size)
      )
    } process: { stream, flush in
      deflate(&stream, flush)
    } end: { stream in
      deflateEnd(&stream)
    }
  }

  private func gzipDecode(_ data: Data) throws -> Data {
    try withZlibStream(data, operation: "inflate") { stream in
      inflateInit2_(&stream, MAX_WBITS + 16, ZLIB_VERSION, Int32(MemoryLayout<z_stream>.size))
    } process: { stream, flush in
      inflate(&stream, flush)
    } end: { stream in
      inflateEnd(&stream)
    }
  }

  private func withZlibStream(
    _ data: Data,
    operation: String,
    start: (inout z_stream) -> Int32,
    process: (inout z_stream, Int32) -> Int32,
    end: (inout z_stream) -> Int32
  ) throws -> Data {
    var stream = z_stream()
    guard start(&stream) == Z_OK else {
      throw NSError(domain: "BATMobile", code: 3, userInfo: [
        NSLocalizedDescriptionKey: "\(operation) init failed"
      ])
    }
    defer { _ = end(&stream) }

    return try data.withUnsafeBytes { inputBuffer in
      guard let input = inputBuffer.bindMemory(to: Bytef.self).baseAddress else {
        return Data()
      }
      stream.next_in = UnsafeMutablePointer<Bytef>(mutating: input)
      stream.avail_in = uInt(data.count)

      var output = Data()
      var buffer = [UInt8](repeating: 0, count: 16 * 1024)
      var status: Int32 = Z_OK

      repeat {
        status = buffer.withUnsafeMutableBytes { outputBuffer in
          stream.next_out = outputBuffer.bindMemory(to: Bytef.self).baseAddress
          stream.avail_out = uInt(buffer.count)
          return process(&stream, Z_FINISH)
        }
        let produced = buffer.count - Int(stream.avail_out)
        if produced > 0 {
          output.append(buffer, count: produced)
        }
      } while status == Z_OK

      guard status == Z_STREAM_END else {
        throw NSError(domain: "BATMobile", code: 4, userInfo: [
          NSLocalizedDescriptionKey: "\(operation) failed with status \(status)"
        ])
      }
      return output
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
      emit("TLSWebSocket_onError", [
        "connectionId": connectionId ?? "",
        "message": "TLS error: no server certificate"
      ])
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
        "connectionId": connectionId ?? "",
        "message": "TLS fingerprint mismatch. Expected: \(colonize(pinned)), Got: \(colonize(fingerprint))"
      ])
      completionHandler(.cancelAuthenticationChallenge, nil)
    }
  }

  // MARK: - URLSessionWebSocketDelegate

  func urlSession(_ session: URLSession,
                  webSocketTask: URLSessionWebSocketTask,
                  didOpenWithProtocol protocol: String?) {
    emit("TLSWebSocket_onOpen", ["connectionId": connectionId ?? ""])
  }

  func urlSession(_ session: URLSession,
                  webSocketTask: URLSessionWebSocketTask,
                  didCloseWith closeCode: URLSessionWebSocketTask.CloseCode,
                  reason: Data?) {
    let reasonStr = reason.flatMap { String(data: $0, encoding: .utf8) } ?? ""
    emit("TLSWebSocket_onClose", [
      "connectionId": connectionId ?? "",
      "code": closeCode.rawValue,
      "reason": reasonStr
    ])
  }

  // MARK: - SHA-256

  private func sha256(_ data: Data) -> [UInt8] {
    let digest = SHA256.hash(data: data)
    return Array(digest)
  }
}
