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

## 發布

推送到 main 後，GitHub Actions 會安裝依賴、執行 lint 與測試、建立並驗證靜態輸出，最後發布 dist/client。

Pages 使用 /PIT/ 專案子路徑，不占用 ianhung221.github.io 根網站，也不影響同帳號的其他專案。

## 操作方式

完整遊戲規則與按鍵說明請見 [GAME_MANUAL.md](./GAME_MANUAL.md)。

## 第三方資產

車輛模型與授權資料請見 [THIRD_PARTY_ASSETS.md](./THIRD_PARTY_ASSETS.md) 與 public/assets/LICENSES.md。
