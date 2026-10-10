# PIT Unit — Tactical Pursuit Simulator

PIT Unit 是以 PIT 戰術訓練為核心的 3D 警車追逐模擬遊戲。玩家駕駛主追單位，追捕 AI 嫌犯，並與後援警車協同完成攔截。

## 線上遊玩

- 主要網站：[GitHub Pages](https://ianhung221.github.io/PIT/)
- 備援舊版：[OpenAI Sites](https://pit-unit-pursuit.ianhung221.chatgpt.site)

## 本機開發

需求：Node.js 22.13.0 以上。

    npm install
    npm run dev

若另一個專案已使用 3000，改用其他連接埠：

    npm run dev -- --port 3001

兩個專案位於不同資料夾、使用不同連接埠及不同 GitHub 儲存庫，不會互相覆蓋。

## 驗證

    npm run lint
    npm test
    npm run build:pages

本機已用 /PIT/ 子路徑測試靜態輸出。Windows 上若要執行完整無頭 Edge smoke test，先啟動可從 /PIT/ 存取 dist/client 的靜態伺服器，再執行：

    npm run verify:browser

第五批亦提供可重現的 PIT 情境（PowerShell，先啟動 `node scripts/serve-pages.mjs`）：

    $env:PIT_TEST_WORLD='true'
    $env:PIT_TEST_PIT_SUPPORT='true'
    $env:PIT_TEST_SCENE='highway'
    $env:PIT_TEST_WEATHER='clear'
    $env:PIT_TEST_QUALITY='medium'
    $env:PIT_TEST_VEHICLE='suv'
    $env:PIT_TEST_AUTO='true'
    node scripts/browser-smoke.mjs

接觸以初始車位與實際按鍵建立，由 Rapier 自然判定，不注入 `pitQualified`。`PIT_TEST_CONTACT=center`／`unauthorized` 分別驗證錯誤部位及未授權；`PIT_TEST_ESCAPE=true` 觀察再次逃逸。`PIT_TEST_HOLD=true`／`PIT_TEST_DISABLED=true` 在自然合格 PIT 後隔離停車幾何或引擎失能分支，不代表 AI 自動完成或單次碰撞必然造成失能。一次只開一種測試，切換前清除不需要的環境變數；用 `PIT_TEST_URL` 可測正式站。

## 發布

推送到 main 後，GitHub Actions 會安裝依賴、執行 lint 與測試、建立並驗證靜態輸出，最後發布 dist/client。

Pages 使用 /PIT/ 專案子路徑，不占用 ianhung221.github.io 根網站，也不影響同帳號的其他專案。

## 操作方式

完整遊戲規則與按鍵說明請見 [GAME_MANUAL.md](./GAME_MANUAL.md)。

## 第三方資產

車輛模型與授權資料請見 [THIRD_PARTY_ASSETS.md](./THIRD_PARTY_ASSETS.md) 與 public/assets/LICENSES.md。
