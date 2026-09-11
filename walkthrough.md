# PIT Unit V2 Walkthrough

## 發布結果

- 第二版已發布到既有私人網站：https://pit-unit-pursuit.ianhung221.chatgpt.site
- 保留原 project、網址與 owner-only 存取設定，沒有改成公開網站。
- 正式首頁已確認顯示 BUILD 0.2 與畫面品質選項。
- 正式 police.glb 資產回應 200，檔案大小 195,336 bytes。

## 完成內容

### 專業 PIT 訓練流程

- PIT 不再因任何碰撞立即成功；必須先取得 authorized 授權。
- 授權會評估速度、天候抓地力、能見度、道路風險、交通密度、障礙物與後援數量。
- 接觸分成 scrape、effective、excessive 與 unsafe。
- 接觸品質會計算嫌犯車本地接觸點、相對速度、有效質量、衝量、力臂、偏航力矩與路面抓地力。
- 固定人工旋轉力已降低，補償量改由計算出的偏航力矩限制後決定。
- 有效接觸後仍須觀察嫌犯車損、是否可繼續行駛，以及後援是否完成包圍。
- 任務結果支援 contained、disabled、stopped-mobile、escaped-containment、unsafe-pit 與 failed。

### 車損與嫌犯 AI

- 車損改為引擎、冷卻、轉向、四輪抓地力、定位與車身等獨立元件。
- 碰撞區域與強度會實際影響加速、極速、轉向與抓地力。
- 嫌犯被 PIT 後可能失能、暫停後再次逃逸，或突破尚未完成的包圍。
- 保留第一版的煞停、倒車、轉正與重新加速脫困流程，並讓車損影響逃逸能力。

### 多警車與無線電

- 加入 02 號巡邏車與 03 號警用 SUV 兩台 AI 後援。
- 玩家預設維持 primary；後援可擔任 secondary、tertiary、containment-front、containment-rear。
- 玩家車況過差或選擇「接替主追」時，02 號會實際移到嫌犯後方接替。
- 有效 PIT 後，兩台後援分別封鎖車頭與車尾；未完成包圍時嫌犯仍可能逃逸。
- Q 可開啟按鈕式無線電圓盤，也可直接點擊畫面上的「無線電指令」。
- 指令包含請求 PIT、準備 PIT、第二單位靠近、封鎖車頭、接替主追與終止追逐。
- 結束畫面新增 PIT 嘗試、有效接觸、未授權次數、嫌犯車況與事件紀錄。

### 視角與後方資訊

- 駕駛視角已移到左側駕駛座，加入通用儀表板、A 柱與方向盤。
- 保留後方追蹤視角。
- 原本的自動跟車已改為直升機視角，會同時框住玩家、嫌犯及兩台後援。
- 駕駛視角具中央與左右後視鏡；按住 R 可快速回頭，放開即恢復。
- 後視鏡使用低解析 render target，避免以完整畫質額外渲染三次。

### 程序地圖與設定

- 任務設定頁的城市、鄉間與高速公路會實際切換左側預覽。
- 新增任務地圖代碼；相同 seed 會重現相同道路排列。
- 道路由固定模組依限制排列，可跨越城市、鄉間與高速公路三個區域。
- 玩家、嫌犯與後援共用道路導航索引。
- 重新挑戰會保留相同 seed；返回設定才離開任務。
- 新增高、中、低畫質。低畫質關閉即時陰影與側鏡。

### 免費合法資產

- 採用 Kenney Car Kit 3.1 的 police、race、suv、sedan-sports 四個 GLB。
- 官方授權為 Creative Commons Zero 1.0。
- 原始授權保存在 public/assets/kenney-car-kit/LICENSE.txt。
- 完整清單保存在 public/assets/LICENSES.md 與 THIRD_PARTY_ASSETS.md。
- GLB 載入失敗時會回退到低多邊形方塊車，不會讓整局無法啟動。

## 效能調整

- 程序道路總長仍保留 72 個可重現區塊，但同時只掛載玩家附近最多 15 個區塊，活躍道路量最多減少約 79%。
- 後視鏡依畫質每 2、3 或 5 幀更新一次；低畫質只保留中央鏡。
- Canvas 像素比依畫質限制為 1.0、1.25 或 1.45。
- 高頻車輛、AI、車損與導航仍在固定物理迴圈及 refs 中處理；React 只以每 0.1 秒更新 HUD。
- 正式建置仍提示 Three.js 主遊戲 chunk 大於 500 kB；這是警告而非建置失敗，後續可再拆分 3D 載入程式。

## 驗證結果

- npm run lint：通過。
- 第一版與第二版規則測試：19 項全部通過。
- 建置後 HTML 測試：1 項通過。
- npm run build：通過。
- 本地首頁：HTTP 200。
- 本地 police.glb：HTTP 200。
- 正式部署：Sites version 4，狀態 succeeded。
- 正式首頁：HTTP 200，確認 BUILD 0.2 與畫面品質。
- 正式 police.glb：HTTP 200，195,336 bytes。
- 本地伺服器已在驗證後關閉。

## 尚未完成的驗證

- Codex 內建互動瀏覽器在多次乾淨重試後，仍因 Windows sandbox helper 初始化錯誤立即關閉。
- 因此沒有宣稱已完成鍵盤駕駛、切換鏡頭、後視鏡方向、PIT 實撞與 AI 包圍的瀏覽器實玩驗證。
- HTTP、lint、build 與自動化測試都不能取代這項人工操作；建議下一步由玩家在正式網址依下方清單實玩。

## 建議實玩清單

1. 以同一 seed 分別選城市、鄉間與高速公路，確認預覽與道路起始區域。
2. 用方向鍵駕駛，確認左右轉向維持第一版正確方向。
3. 按 C 切換後方追蹤、駕駛與直升機視角；駕駛視角按住 R 檢查後方。
4. 按 Q 請求 PIT 授權；比較晴天直路與雨雪高風險區段的回覆。
5. 嘗試未授權碰撞、一般擦撞、後側四分之一有效接觸與過高閉合速度。
6. 有效 PIT 後觀察嫌犯失能、重新逃逸及 02／03 號包圍。
7. 按「相同地圖再試一次」，確認 seed 與設定保留。
8. 分別使用高、中、低畫質檢查順暢度與鏡面差異。

## 後續版本範圍

- 一般民車、公車、火車與交通事件。
- 真正可選分岔的城市路網與完整自由探索大地圖。
- 更多道路、建築、植被、音效、車內細節與逼真材質。
- 更完整的碰撞接觸持續時間、輪胎模型、懸吊與車體變形。

---

# V2 第一輪修正 Walkthrough（2026-09-10）

## 完成內容

- 車模方向與配色：為巡邏車、攔截跑車、警用 SUV 與嫌犯車建立一致的視覺座標校正；GLB 車頭、警燈／車牌與物理碰撞盒的前進方向一致。
- 官方材質補全：補入 Kenney Car Kit 原始的 Textures/colormap.png，恢復車身與警車塗裝；資產授權維持 CC0。
- 駕駛視角：鏡頭直接固定在車輛本地駕駛座座標，不再因加速或減速相對車體前後滑動；駕駛模式會隱藏外部自車模型，避免穿模遮擋。
- 快速後看：駕駛視角按住 R 會直接查看後方，放開後回到前方。
- 後視鏡：中央及左右鏡面相機重新定位；鏡面渲染時暫時排除車內模型，避免白色後座或車身遮住道路。
- 直升機視角：加入可測試的構圖演算法。90 公尺內框住主要追逐車輛；嫌犯拉開後切換成玩家優先，不會再只拍到空道路。

## 驗證結果

- 第一輪修改檔案 ESLint：通過。
- npm test：正式建置成功，24 項測試全部通過。
- 瀏覽器互動：成功進入遊戲並產生 7 張驗證截圖；完成後方追蹤、駕駛視角、加速、R 後看、放開復原及直升機近／遠距離測試。
- 目視結果：車頭與行駛方向一致、配色已恢復；駕駛鏡頭加速時未離開車內；R 後看可見後援；後視鏡可見道路與車輛。
- 直升機近距離：約 87 公尺時可見追逐車輛與後援；遠距離約 291 公尺時仍持續顯示玩家警車。
- 瀏覽器狀態：Canvas 全程存在，最後 HUD 正確顯示「直升機視角」，最終驗證執行期錯誤為 0。
- 本機開發伺服器與隔離 Edge QA 工作階段均已關閉。

## 驗證工具說明

- Codex 內建電腦操作工具再次嘗試後，仍在 Windows sandbox helper 初始化階段退出，未真正載入遊戲。
- 本輪改用獨立的無頭 Edge 除錯工作階段完成相同的按鍵操作與截圖，因此已取得瀏覽器實際執行證據；這個問題不需要玩家調整電腦設定。

## 已知但未納入本輪

- 開發模式會重複輸出 Three.js Clock 與陰影類型的棄用警告；目前不影響遊戲畫面或控制，已記錄為 C-004，建議後續獨立處理。
- 第一輪沒有修改道路接縫、後援 AI、PIT 規則、雪景或漸進式油門／巡航定速；這些維持後續輪次處理。
- 已於 2026-09-11 發布為 Sites 正式版本 5，沿用原網址與私人存取權限：https://pit-unit-pursuit.ianhung221.chatgpt.site

---

# GitHub Pages 永久發布遷移 Walkthrough（2026-09-11）

## 完成內容

- 建立玩家長期持有的公開儲存庫：https://github.com/ianhung221/PIT
- 將目前 D:\Ian\PIT 設為該儲存庫的本機工作目錄；main 已追蹤 origin/main，完整保留既有 Git 歷史。
- 建立 GitHub Pages 靜態輸出流程，正式網址為：https://ianhung221.github.io/PIT/
- 新增 GitHub Actions 自動部署；後續推送 main 會自動執行 lint、測試、靜態建置、輸出驗證及 Pages 發布。
- 將客戶端任務設定畫面與靜態伺服器路由分離，避開 Vinext 靜態預渲染限制；沒有更動畫面或玩法。
- 集中處理 /PIT/ 公開路徑，修正 metadata、favicon、Open Graph、四個 GLB、manifest 與 service worker。
- manifest 與 service worker 的 scope 限定在 /PIT/，不會控制同帳號其他 GitHub Pages 專案。
- 保留原 OpenAI Sites 網址與 .openai/hosting.json，舊站仍可作為備援。
- 更新 README、deployment_targets.md、task.md，說明線上網址、發布方式及多專案連接埠。

## 相容性與效能

- GitHub Pages 版本完全由靜態檔案提供，不需要長期執行 Node／Vinext 伺服器，因此不受 Codex 或學校帳號生命週期影響。
- 本機開發仍使用原本 Vinext 流程；只有 Pages 專用建置會加入 /PIT/ 路徑。
- 遊戲物理、AI、PIT 判定、相機、HUD、模型與資料結構未改動，因此本次不宣稱遊戲 FPS 提升。
- 建置仍會提示主要 3D chunk 大於 500 kB；它不影響本次正確性，之後可另案處理載入效能。

## 驗證結果

- 公開內容安全掃描：未發現 GitHub token、私鑰、API key 或其他憑證。
- npm run lint：通過。
- npm test：正式建置成功，24／24 項測試通過。
- npm run build:pages：成功輸出純靜態首頁，驗證 index.html、PWA 檔案、favicon、Open Graph 圖片及四個 GLB。
- 本機 /PIT/ 預覽：首頁、manifest、service worker、favicon、所有 JS／CSS、四個 GLB、Rapier 與 colormap 均回傳 200。
- 本機無頭 Edge：成功進入 3D 遊戲；視角由「後方追蹤」切至「駕駛視角」；按住 Q 正常顯示無線電圓盤；未捕捉到執行期例外或載入失敗。
- GitHub Actions：https://github.com/ianhung221/PIT/actions/runs/34612913017 已成功完成 build 與 deploy。
- 正式網址 HTTP：首頁、manifest、service worker、favicon 與警車 GLB 均回傳 200。
- 正式網址無頭 Edge：成功進入遊戲、切換視角並開啟無線電圓盤。
- 本機驗證伺服器已關閉。

## 工具狀態與已知事項

- Codex 內建瀏覽器仍因 Windows sandbox helper 初始化錯誤無法啟動；依恢復流程重設後結果相同。
- 本次改用 Microsoft Edge headless 與 DevTools Protocol 完成正式網站互動驗證，因此不是只做 HTTP 檢查。
- Vinext 在 Windows 完成 Pages 預渲染後偶爾於關閉程序時觸發 libuv assertion；建置腳本會先清空舊 dist，且只在 Windows 允許進入嚴格的全新產物驗證。GitHub Linux workflow 仍要求建置正常成功，不會忽略錯誤。
