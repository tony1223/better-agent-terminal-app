# CLAUDE.md - BAT Mobile Project Guidelines

## Related Projects

- **BAT Desktop (原始碼)**: `/Users/tonyqwang/clones/tonyq/better-agent-terminal/`
  - Tauri (Rust `src-tauri/`) + React renderer (`renderer/`) + Node sidecar (`node-sidecar/`) 桌面版 Better Agent Terminal
  - Remote Server 實作 (Rust): `src-tauri/src/remote_server.rs`
  - Remote 協定/frame 編解碼與 channel 對應 (Rust): `src-tauri/src/remote_core.rs`
  - Node sidecar agent handlers: `node-sidecar/src/handlers/`（例如 `claude-session.mjs`、`claude-history.mjs`）
  - 通知中心參考: `src-tauri/src/commands/notification.rs`、`renderer/src/stores/notification-store.ts`、`renderer/src/components/NotificationBell.tsx`
  - Renderer host API / 型別: `renderer/src/host-api.ts`
  - UI 元件參考: `renderer/src/components/`
  - Store 模式參考: `renderer/src/stores/`

## Project Overview

BAT Mobile 是 Better Agent Terminal 的 React Native 手機版（iOS + Android），透過 WebSocket 連線至 BAT Desktop 的 Remote Server，共享/控制已存在的 terminal 與 Claude agent session。

## Release（Android + iOS）

由 git tag 驅動發布，兩個 workflow 分別為 `.github/workflows/release-aab.yml`（Android AAB → Google Play）與 `.github/workflows/release-testflight.yml`（iOS → TestFlight）。

上正式版是另外四個手動 workflow，跟 tag 無關：`promote-play.yml`（Android）、`submit-appstore.yml`（iOS 送審）、`appstore-status.yml`（iOS 唯讀診斷）、`withdraw-appstore.yml`（iOS 撤回送審）。

Tag 格式（皆支援開頭可選的 `v`）：

- `1.0.1` / `v1.0.1`：同時發 Android 與 iOS（兩邊用同一版號）。
- `1.0.1-android` / `v1.0.1-android`：只發 Android。
- `1.0.1-ios` / `v1.0.1-ios`：只發 iOS。

兩平台版號可各自脫鉤獨立發版（例如 Android 已在 `1.0.8`、iOS 還在 `1.0.7`，就各推各的後綴 tag）。

- `versionName` / `MARKETING_VERSION` 取自 tag：去掉開頭的 `v`，並去掉結尾的 `-android` / `-ios`（例如 `v1.0.1-ios` → `1.0.1`）。
- Android `versionCode` 與 iOS build number 由 CI 的 `github.run_number` 自動遞增，不需手動指定。
- Android 發布步驟同時上傳到 Google Play 的 `internal` 與 `beta` 兩個 track。
- 正式 deploy 必須推遞增的 release tag，不要直接 `workflow_dispatch` 跑 `main`。手動跑 `main` 時若沒有帶 `versionName`，Android/iOS 會回落到專案預設 `1.0`。
- `workflow_dispatch` 只適合測試或救急；若真的手動執行，必須明確填 `versionName`（iOS）或 `versionCode` / `versionName`（Android）。

發版流程：先把 `main` push 上去（CI checkout 遠端 tag），再找最新 tag 並推下一個遞增版號。例如最新是 `1.0.29`，下一版就推 `1.0.30`：

```sh
# 兩邊一起發
git tag 1.0.30
git push origin 1.0.30

# 只發其中一邊
git tag 1.0.30-ios
git push origin 1.0.30-ios
```

### 測試版（預設做法，雙平台）

「發測試版」= 推一個**不帶平台後綴的遞增 tag**，兩邊都只到測試通道，**不 promote 到任何正式版**：

- Android → Google Play `internal` + `beta`
- iOS → TestFlight

推完 tag 就結束了。上正式版是下面兩個獨立的手動 workflow，不會自己發生，也不該順手做掉——
測試版的重點就是「先讓它待在測試通道」。

### 升上 Google Play 正式版（production）

tag 只會發到 `internal` / `beta`。要上正式版，跑 `.github/workflows/promote-play.yml`（`workflow_dispatch`）——
它把**已經上架的那包 AAB** 在 track 之間搬移，不重 build。

不要用重跑 release workflow 的方式上正式版：`versionCode` 取自 `github.run_number`，重跑會產生不同的
versionCode，等於把一包沒人測過的 artifact 推上去。

- `versionCode` 留白 = 拿來源 track 上最新的那包。
- `rolloutPercent` < 100 會是分階段發布（staged rollout），可以在 Play Console 隨時 halt；100% 沒辦法收回。
- 要把分階段發布推到 100%：`fromTrack` 和 `toTrack` 都選 `production`，`rolloutPercent` 選 100 再跑一次。
- `dryRun` 會印出將要送出的內容然後放棄該 edit，不會有任何實際變更。

### 送上 App Store 正式版（送審）

tag 只會到 TestFlight。要上架跑 `.github/workflows/submit-appstore.yml`（`workflow_dispatch`）——
它把**已經在 TestFlight 上的那包**接到 App Store 版本上送審，不重 build（理由同 Play：重 build 會換成
一包沒人測過的 artifact）。跑在 ubuntu，因為沒有編譯，只打 App Store Connect API。

- `versionName` 必填，例如 `1.0.35`。
- `buildNumber` 留白 = 用該版本上已有的 build。注意 **iOS build number 是每個 marketing version 從 1
  重新數的**，不是 `github.run_number`——`1.0.35` 的第一包 build number 就是 `1`。要釘特定一包時別填錯。
- `releaseNotes` 留白 = 完全不動商店文案。但新建的版本沒有「What's New」會被 review 打回，所以新版本要填。
- `locale` 是 release notes 的語系，預設 `en-US`。
- `submitForReview` 取消勾選 = 只把版本建好、接上 build，不送出。第一次跑或不確定時先用這個。
- `automaticRelease` 勾選 = Apple 過審後自動上架，不用再回 App Store Connect 按。
- workflow 綠燈只代表「已送審」，不代表上架。Apple 是人工審核，大約 24h。

**Pending Developer Release 會擋掉之後所有版本。** App Store Connect 同時只允許一個可編輯的版本，
一個已過審但沒按「發布」的版本會一直佔著那個位置，下一版連建都建不起來，`submit-appstore.yml`
會失敗在 `You cannot create a new version of the App in the current state`，而錯誤訊息不會告訴你是哪一版卡住。

這不是假想的：`1.0.30` 就這樣躺過一陣子，商店停在 `1.0.25`，`1.0.31`–`1.0.34` 全部只到 TestFlight
就沒下文。所以每次送審後要嘛讓它自動上架，要嘛記得回去把它處理掉。

**卡住的不只是「已過審沒發布」，還在審的也一樣佔位。** `WAITING_FOR_REVIEW` / `IN_REVIEW` 同樣
擋掉下一版。這種要跑 `.github/workflows/withdraw-appstore.yml`（`workflow_dispatch`）撤回，
撤完再送新版——`submit-appstore.yml` 是把在審那個版本**改名**而不是新建一個，所以撤回重送之後
版號會接到新的那版上。

- `versionName` 必須跟「實際在審的那一版」相符，不然 lane 會直接拒絕。在審的版號不一定是你以為的
  那個（deliver 會改名），所以先跑 `appstore-status.yml` 看清楚再填。
- 已經是 `PENDING_DEVELOPER_RELEASE` 的 lane 會拒絕撤回——那是已經過審在等你按發布，該去按而不是丟掉。
- Apple 是非同步處理，撤回後可能先停在 `CANCELING`，等一下再送下一版。

（`1.0.30` 那次已經解掉了。2026-07-26 的狀態：商店在 `1.0.30`，`1.0.37` `WAITING_FOR_REVIEW`
但身上掛的是 `1.0.35` 的 build，擋住了 `1.0.36`–`1.0.39`；已撤回並改送 `1.0.39`。
這一行會過期，要看現況跑 `appstore-status.yml`。）

要查目前狀態跑 `.github/workflows/appstore-status.yml`（唯讀，隨時可跑），它會列出每個 App Store
版本和它的 state，以及最近幾包 TestFlight build 的處理狀態。
