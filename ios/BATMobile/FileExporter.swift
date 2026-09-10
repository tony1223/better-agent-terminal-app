import Foundation
import React
import UIKit

@objc(FileExporter)
class FileExporter: NSObject, UIDocumentPickerDelegate {
  private var pendingResolve: RCTPromiseResolveBlock?
  private var temporaryDirectory: URL?

  @objc
  static func requiresMainQueueSetup() -> Bool {
    return true
  }

  @objc(saveBase64:fileName:resolver:rejecter:)
  func saveBase64(
    _ dataBase64: String,
    fileName: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      guard self.pendingResolve == nil else {
        reject("E_FILE_EXPORT_BUSY", "Another file export is already open", nil)
        return
      }
      guard let data = Data(base64Encoded: dataBase64) else {
        reject("E_FILE_EXPORT_DATA", "Invalid base64 file data", nil)
        return
      }
      guard let presenter = self.topViewController() else {
        reject("E_FILE_EXPORT_VIEW", "No view controller is available to save the file", nil)
        return
      }

      let safeName = URL(fileURLWithPath: fileName).lastPathComponent.isEmpty
        ? "download"
        : URL(fileURLWithPath: fileName).lastPathComponent
      let directory = FileManager.default.temporaryDirectory
        .appendingPathComponent("bat-file-export-\(UUID().uuidString)", isDirectory: true)
      let fileURL = directory.appendingPathComponent(safeName)

      do {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try data.write(to: fileURL, options: .atomic)
      } catch {
        try? FileManager.default.removeItem(at: directory)
        reject("E_FILE_EXPORT_WRITE", error.localizedDescription, error)
        return
      }

      self.pendingResolve = resolve
      self.temporaryDirectory = directory

      let picker = UIDocumentPickerViewController(forExporting: [fileURL], asCopy: true)
      picker.delegate = self
      presenter.present(picker, animated: true)
    }
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    finish(with: urls.first?.absoluteString)
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    finish(with: nil)
  }

  private func finish(with uri: String?) {
    pendingResolve?(uri)
    pendingResolve = nil
    if let directory = temporaryDirectory {
      try? FileManager.default.removeItem(at: directory)
    }
    temporaryDirectory = nil
  }

  private func topViewController() -> UIViewController? {
    let root = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap(\.windows)
      .first(where: { $0.isKeyWindow })?
      .rootViewController
    var current = root
    while let presented = current?.presentedViewController {
      current = presented
    }
    return current
  }
}
