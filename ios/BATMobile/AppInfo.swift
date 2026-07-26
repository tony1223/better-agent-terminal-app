import Foundation
import React

/// The version of the binary that is actually installed.
///
/// Not read from package.json: CI stamps MARKETING_VERSION from the release
/// tag and the build number from the run number, so package.json never sees
/// either. This reads what the running bundle declares, which is the only
/// answer that stays true for a build nobody can reproduce locally.
///
/// Constants rather than a method — a settings row should not have to await
/// anything to render.
@objc(AppInfo)
class AppInfo: NSObject {

  @objc
  static func requiresMainQueueSetup() -> Bool {
    return false
  }

  @objc
  func constantsToExport() -> [AnyHashable: Any]! {
    let info = Bundle.main.infoDictionary
    return [
      "version": info?["CFBundleShortVersionString"] as? String ?? "",
      "build": info?["CFBundleVersion"] as? String ?? "",
    ]
  }
}
