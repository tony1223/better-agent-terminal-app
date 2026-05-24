import Foundation
import CryptoKit
import Network
import React
import zlib

@objc(TLSWebSocket)
class TLSWebSocket: RCTEventEmitter {

  private let batGzipMagic = Data("BATGZIP1\0".utf8)
  private let queue = DispatchQueue(label: "bat.mobile.tls.websocket")
  private var connection: NWConnection?
  private var pinnedFingerprint: String?
  private var connectionId: String?
  private var receiveBuffer = Data()
  private var fragmentOpcode: UInt8?
  private var fragmentPayload = Data()
  private var handshakeComplete = false
  private var isOpen = false
  private var hasListeners = false

  override init() {
    super.init()
  }

  @objc override static func requiresMainQueueSetup() -> Bool { false }

  override func supportedEvents() -> [String]! {
    ["TLSWebSocket_onOpen", "TLSWebSocket_onMessage", "TLSWebSocket_onClose", "TLSWebSocket_onError", "TLSWebSocket_onState"]
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

    guard let wsURL = URL(string: url),
          let host = wsURL.host else {
      emit("TLSWebSocket_onError", ["connectionId": connectionId ?? "", "message": "Invalid URL: \(url)"])
      return
    }

    let isTLS = wsURL.scheme?.lowercased() == "wss"
    let portValue = wsURL.port ?? (isTLS ? 443 : 80)
    guard let port = NWEndpoint.Port(rawValue: UInt16(portValue)) else {
      emit("TLSWebSocket_onError", ["connectionId": connectionId ?? "", "message": "Invalid port: \(portValue)"])
      return
    }

    pinnedFingerprint = fingerprint?.uppercased().replacingOccurrences(of: ":", with: "")
    self.connectionId = connectionId
    receiveBuffer.removeAll(keepingCapacity: true)
    fragmentOpcode = nil
    fragmentPayload.removeAll(keepingCapacity: true)
    handshakeComplete = false
    isOpen = false

    emitState("created", "raw host=\(host) port=\(portValue) tls=\(isTLS) pin=\(!(pinnedFingerprint?.isEmpty ?? true))")

    let parameters = makeParameters(isTLS: isTLS, host: host)
    let nwConnection = NWConnection(host: NWEndpoint.Host(host), port: port, using: parameters)
    connection = nwConnection

    nwConnection.stateUpdateHandler = { [weak self] state in
      guard let self = self else { return }
      switch state {
      case .setup:
        self.emitState("setup")
      case .preparing:
        self.emitState("preparing")
      case .waiting(let error):
        self.emitState("waiting", error.localizedDescription)
      case .ready:
        self.emitState("tcp-ready", "sending websocket upgrade")
        self.receiveRaw()
        self.sendWebSocketUpgrade(host: host, port: portValue, path: self.webSocketPath(wsURL))
      case .failed(let error):
        self.failConnection("TLS connection failed: \(error.localizedDescription)")
      case .cancelled:
        self.isOpen = false
        self.emitState("cancelled")
      @unknown default:
        self.emitState("unknown-state")
      }
    }

    nwConnection.start(queue: queue)

    let startedConnectionId = connectionId
    queue.asyncAfter(deadline: .now() + 15) { [weak self] in
      guard let self = self,
            self.connectionId == startedConnectionId,
            !self.isOpen else { return }
      self.failConnection("Native TLS connection timeout")
      self.close(1000, reason: "native timeout")
    }
  }

  @objc(send:)
  func send(_ message: String) {
    sendWebSocketFrame(opcode: 0x1, payload: Data(message.utf8), errorPrefix: "Send failed")
  }

  @objc(sendGzip:)
  func sendGzip(_ message: String) {
    do {
      let compressed = try gzipEncode(Data(message.utf8))
      var payload = batGzipMagic
      payload.append(compressed)
      sendWebSocketFrame(opcode: 0x2, payload: payload, errorPrefix: "Gzip send failed")
    } catch {
      emit("TLSWebSocket_onError", [
        "connectionId": connectionId ?? "",
        "message": "Gzip encode failed: \(error.localizedDescription)"
      ])
    }
  }

  @objc(close:reason:)
  func close(_ code: Int, reason: String?) {
    emitState("close", reason ?? "")
    if let data = reason?.data(using: .utf8), connection != nil {
      sendWebSocketFrame(opcode: 0x8, payload: data, errorPrefix: "Close failed")
    }
    connection?.cancel()
    connection = nil
    receiveBuffer.removeAll(keepingCapacity: true)
    fragmentOpcode = nil
    fragmentPayload.removeAll(keepingCapacity: true)
    handshakeComplete = false
    isOpen = false
    connectionId = nil
  }

  // MARK: - TLS and raw socket

  private func makeParameters(isTLS: Bool, host: String) -> NWParameters {
    if isTLS {
      let tlsOptions = NWProtocolTLS.Options()
      configureTLS(tlsOptions, host: host)
      return NWParameters(tls: tlsOptions)
    }
    return NWParameters.tcp
  }

  private func configureTLS(_ tlsOptions: NWProtocolTLS.Options, host: String) {
    let securityOptions = tlsOptions.securityProtocolOptions
    sec_protocol_options_set_min_tls_protocol_version(securityOptions, .TLSv12)
    sec_protocol_options_set_verify_block(securityOptions, { [weak self] _, secTrust, complete in
      guard let self = self else {
        complete(false)
        return
      }
      let trust = sec_trust_copy_ref(secTrust).takeRetainedValue()
      complete(self.verifyPinnedTrust(trust, host: host))
    }, queue)
  }

  private func verifyPinnedTrust(_ serverTrust: SecTrust, host: String) -> Bool {
    guard let pinned = pinnedFingerprint, !pinned.isEmpty else {
      emitState("tls-verify", "no pin provided for host=\(host)")
      return true
    }

    guard let leafCert = leafCertificate(from: serverTrust) else {
      emit("TLSWebSocket_onError", [
        "connectionId": connectionId ?? "",
        "message": "TLS error: no server certificate"
      ])
      return false
    }

    let certData = SecCertificateCopyData(leafCert) as Data
    let fingerprint = sha256(certData).map { String(format: "%02X", $0) }.joined()
    emitState("fingerprint", "got=\(colonize(fingerprint)) expected=\(colonize(pinned))")

    guard fingerprint == pinned else {
      emit("TLSWebSocket_onError", [
        "connectionId": connectionId ?? "",
        "message": "TLS fingerprint mismatch. Expected: \(colonize(pinned)), Got: \(colonize(fingerprint))"
      ])
      return false
    }

    emitState("tls-verify", "fingerprint accepted for host=\(host)")
    return true
  }

  private func leafCertificate(from serverTrust: SecTrust) -> SecCertificate? {
    if #available(iOS 15.0, *) {
      if let chain = SecTrustCopyCertificateChain(serverTrust) as? [SecCertificate] {
        return chain.first
      }
    }
    return SecTrustGetCertificateAtIndex(serverTrust, 0)
  }

  private func receiveRaw() {
    connection?.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, isComplete, error in
      guard let self = self else { return }

      if let error = error {
        self.failConnection("Receive failed: \(error.localizedDescription)")
        return
      }

      if let data = data, !data.isEmpty {
        self.receiveBuffer.append(data)
        if self.handshakeComplete {
          self.parseFrames()
        } else {
          self.parseWebSocketUpgrade()
        }
      }

      if isComplete {
        self.emit("TLSWebSocket_onClose", [
          "connectionId": self.connectionId ?? "",
          "code": 1000,
          "reason": "remote closed"
        ])
        return
      }

      self.receiveRaw()
    }
  }

  private func sendWebSocketUpgrade(host: String, port: Int, path: String) {
    let key = makeWebSocketKey()
    let request = [
      "GET \(path) HTTP/1.1",
      "Host: \(host):\(port)",
      "Upgrade: websocket",
      "Connection: Upgrade",
      "Sec-WebSocket-Key: \(key)",
      "Sec-WebSocket-Version: 13",
      "",
      ""
    ].joined(separator: "\r\n")

    emitState("ws-upgrade", "path=\(path)")
    connection?.send(content: Data(request.utf8), completion: .contentProcessed { [weak self] error in
      if let error = error {
        self?.failConnection("WebSocket upgrade send failed: \(error.localizedDescription)")
      }
    })
  }

  private func parseWebSocketUpgrade() {
    let delimiter = Data("\r\n\r\n".utf8)
    guard let range = receiveBuffer.range(of: delimiter) else { return }

    let headerData = receiveBuffer[..<range.upperBound]
    let remaining = receiveBuffer[range.upperBound...]
    receiveBuffer = Data(remaining)

    guard let headers = String(data: headerData, encoding: .utf8) else {
      failConnection("WebSocket upgrade response is not UTF-8")
      return
    }

    let statusLine = headers.split(separator: "\r\n", maxSplits: 1, omittingEmptySubsequences: false).first ?? ""
    emitState("ws-upgrade-response", String(statusLine))

    guard statusLine.contains("101") else {
      failConnection("WebSocket upgrade failed: \(statusLine)")
      return
    }

    handshakeComplete = true
    isOpen = true
    emitState("open", "raw websocket ready")
    emit("TLSWebSocket_onOpen", ["connectionId": connectionId ?? ""])
    parseFrames()
  }

  // MARK: - WebSocket frames

  private func sendWebSocketFrame(opcode: UInt8, payload: Data, errorPrefix: String) {
    guard connection != nil else { return }
    let frame = makeClientFrame(opcode: opcode, payload: payload)
    connection?.send(content: frame, completion: .contentProcessed { [weak self] error in
      if let error = error {
        self?.failConnection("\(errorPrefix): \(error.localizedDescription)")
      }
    })
  }

  private func makeClientFrame(opcode: UInt8, payload: Data) -> Data {
    var frame = Data()
    frame.append(0x80 | (opcode & 0x0f))

    let length = payload.count
    if length < 126 {
      frame.append(0x80 | UInt8(length))
    } else if length <= UInt16.max {
      frame.append(0x80 | 126)
      frame.append(UInt8((length >> 8) & 0xff))
      frame.append(UInt8(length & 0xff))
    } else {
      frame.append(0x80 | 127)
      let length64 = UInt64(length)
      for shift in stride(from: 56, through: 0, by: -8) {
        frame.append(UInt8((length64 >> UInt64(shift)) & 0xff))
      }
    }

    var mask = [UInt8](repeating: 0, count: 4)
    _ = SecRandomCopyBytes(kSecRandomDefault, mask.count, &mask)
    frame.append(contentsOf: mask)

    let payloadBytes = [UInt8](payload)
    for (index, byte) in payloadBytes.enumerated() {
      frame.append(byte ^ mask[index % 4])
    }

    return frame
  }

  private func parseFrames() {
    while true {
      let bytes = [UInt8](receiveBuffer)
      guard bytes.count >= 2 else { return }

      let firstByte = bytes[0]
      let secondByte = bytes[1]
      let fin = (firstByte & 0x80) != 0
      let opcode = firstByte & 0x0f
      let isMasked = (secondByte & 0x80) != 0
      var payloadLength = UInt64(secondByte & 0x7f)
      var offset = 2

      if payloadLength == 126 {
        guard bytes.count >= 4 else { return }
        payloadLength = (UInt64(bytes[2]) << 8) | UInt64(bytes[3])
        offset = 4
      } else if payloadLength == 127 {
        guard bytes.count >= 10 else { return }
        payloadLength = 0
        for index in 2..<10 {
          payloadLength = (payloadLength << 8) | UInt64(bytes[index])
        }
        offset = 10
      }

      guard payloadLength <= UInt64(Int.max) else {
        failConnection("WebSocket frame too large")
        return
      }

      var mask: [UInt8]?
      if isMasked {
        guard bytes.count >= offset + 4 else { return }
        mask = Array(bytes[offset..<(offset + 4)])
        offset += 4
      }

      let frameLength = offset + Int(payloadLength)
      guard bytes.count >= frameLength else { return }

      var payload = Array(bytes[offset..<frameLength])
      if let mask = mask {
        for index in payload.indices {
          payload[index] ^= mask[index % 4]
        }
      }

      receiveBuffer.removeFirst(frameLength)
      handleFrame(fin: fin, opcode: opcode, payload: Data(payload))
    }
  }

  private func handleFrame(fin: Bool, opcode: UInt8, payload: Data) {
    switch opcode {
    case 0x0:
      guard let originalOpcode = fragmentOpcode else {
        emitState("frame-ignored", "unexpected continuation bytes=\(payload.count)")
        return
      }
      fragmentPayload.append(payload)
      if fin {
        let assembledOpcode = originalOpcode
        let assembledPayload = fragmentPayload
        fragmentOpcode = nil
        fragmentPayload.removeAll(keepingCapacity: true)
        handleDataFrame(opcode: assembledOpcode, payload: assembledPayload)
      }
    case 0x1:
      handlePossiblyFragmentedDataFrame(fin: fin, opcode: opcode, payload: payload)
    case 0x2:
      handlePossiblyFragmentedDataFrame(fin: fin, opcode: opcode, payload: payload)
    case 0x8:
      isOpen = false
      let reason = String(data: payload, encoding: .utf8) ?? "remote close"
      emitState("closed", reason)
      emit("TLSWebSocket_onClose", [
        "connectionId": connectionId ?? "",
        "code": 1000,
        "reason": reason
      ])
      connection?.cancel()
    case 0x9:
      sendWebSocketFrame(opcode: 0xA, payload: payload, errorPrefix: "Pong failed")
    case 0xA:
      break
    default:
      emitState("frame-ignored", "opcode=\(opcode) bytes=\(payload.count)")
    }
  }

  private func handlePossiblyFragmentedDataFrame(fin: Bool, opcode: UInt8, payload: Data) {
    if fin {
      handleDataFrame(opcode: opcode, payload: payload)
      return
    }

    fragmentOpcode = opcode
    fragmentPayload = payload
    emitState("frame-fragment", "start opcode=\(opcode) bytes=\(payload.count)")
  }

  private func handleDataFrame(opcode: UInt8, payload: Data) {
    switch opcode {
    case 0x1:
      if let text = String(data: payload, encoding: .utf8) {
        emit("TLSWebSocket_onMessage", ["connectionId": connectionId ?? "", "data": text])
      }
    case 0x2:
      do {
        let text = try decodeBatGzipFrame(payload)
        emit("TLSWebSocket_onMessage", ["connectionId": connectionId ?? "", "data": text])
      } catch {
        emit("TLSWebSocket_onError", [
          "connectionId": connectionId ?? "",
          "message": error.localizedDescription
        ])
      }
    default:
      emitState("frame-ignored", "data opcode=\(opcode) bytes=\(payload.count)")
    }
  }

  // MARK: - Helpers

  private func webSocketPath(_ url: URL) -> String {
    var path = url.path.isEmpty ? "/" : url.path
    if let query = url.query, !query.isEmpty {
      path += "?\(query)"
    }
    return path
  }

  private func makeWebSocketKey() -> String {
    var bytes = [UInt8](repeating: 0, count: 16)
    _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
    return Data(bytes).base64EncodedString()
  }

  private func failConnection(_ message: String) {
    isOpen = false
    emitState("error", message)
    emit("TLSWebSocket_onError", [
      "connectionId": connectionId ?? "",
      "message": message
    ])
    emit("TLSWebSocket_onClose", [
      "connectionId": connectionId ?? "",
      "code": 1006,
      "reason": message
    ])
  }

  // MARK: - BAT gzip envelope

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
    var stream = z_stream()
    guard inflateInit2_(&stream, MAX_WBITS + 16, ZLIB_VERSION, Int32(MemoryLayout<z_stream>.size)) == Z_OK else {
      throw NSError(domain: "BATMobile", code: 3, userInfo: [
        NSLocalizedDescriptionKey: "inflate init failed"
      ])
    }
    defer { inflateEnd(&stream) }

    return try data.withUnsafeBytes { inputBuffer in
      guard let input = inputBuffer.bindMemory(to: Bytef.self).baseAddress else {
        return Data()
      }

      stream.next_in = UnsafeMutablePointer<Bytef>(mutating: input)
      stream.avail_in = uInt(data.count)

      var output = Data()
      var buffer = [UInt8](repeating: 0, count: 16 * 1024)
      let bufferSize = buffer.count

      while true {
        let status = buffer.withUnsafeMutableBytes { outputBuffer -> Int32 in
          stream.next_out = outputBuffer.bindMemory(to: Bytef.self).baseAddress
          stream.avail_out = uInt(bufferSize)
          return inflate(&stream, Z_NO_FLUSH)
        }

        let produced = bufferSize - Int(stream.avail_out)
        if produced > 0 {
          output.append(contentsOf: buffer.prefix(produced))
        }

        if status == Z_STREAM_END {
          return output
        }

        guard status == Z_OK else {
          throw NSError(domain: "BATMobile", code: 4, userInfo: [
            NSLocalizedDescriptionKey: "inflate failed with status \(status)"
          ])
        }

        if produced == 0 && stream.avail_in == 0 {
          throw NSError(domain: "BATMobile", code: 4, userInfo: [
            NSLocalizedDescriptionKey: "inflate truncated gzip stream"
          ])
        }
      }
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
      let bufferSize = buffer.count
      var status: Int32 = Z_OK

      repeat {
        status = buffer.withUnsafeMutableBytes { outputBuffer in
          stream.next_out = outputBuffer.bindMemory(to: Bytef.self).baseAddress
          stream.avail_out = uInt(bufferSize)
          return process(&stream, Z_FINISH)
        }
        let produced = bufferSize - Int(stream.avail_out)
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

  // MARK: - Logging / SHA-256

  private func emitState(_ state: String, _ message: String = "") {
    NSLog("[BAT TLS] state=%@ %@", state, message)
    emit("TLSWebSocket_onState", [
      "connectionId": connectionId ?? "",
      "state": state,
      "message": message
    ])
  }

  private func colonize(_ hex: String) -> String {
    stride(from: 0, to: hex.count, by: 2).map {
      let start = hex.index(hex.startIndex, offsetBy: $0)
      let end = hex.index(start, offsetBy: min(2, hex.distance(from: start, to: hex.endIndex)))
      return String(hex[start..<end])
    }.joined(separator: ":")
  }

  private func sha256(_ data: Data) -> [UInt8] {
    let digest = SHA256.hash(data: data)
    return Array(digest)
  }
}
