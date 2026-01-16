# 591 租屋爬蟲系統

自動爬取 591 租屋網符合條件的物件，透過 LINE Bot 每日通知，並儲存到 Google Sheets。

## ✨ 功能特色

- 🏠 **自動爬取** - 每日 11:00 自動搜尋符合條件的租屋物件
- 📱 **LINE 通知** - 透過 LINE Bot 推播新發現的物件
- 📊 **Google Sheets** - 自動儲存所有物件，方便管理
- 🎛️ **即時調整** - 透過 LINE 對話調整搜尋條件
- ⭐ **標記功能** - 點擊「有興趣」自動加入待看清單

## 🚀 快速開始

### 1. 安裝依賴

```bash
npm install
npx playwright install chromium
```

### 2. 設定環境變數

編輯 `.env` 檔案：

```env
# LINE Bot 設定（已設定）
LINE_CHANNEL_SECRET=your_secret
LINE_CHANNEL_ACCESS_TOKEN=your_token
LINE_USER_ID=你的用戶ID  # 需要手動取得

# Google Sheets 設定
GOOGLE_SHEETS_ID=your_sheets_id
GOOGLE_SERVICE_ACCOUNT_KEY={"type":"service_account",...}  # 可選：Service Account 金鑰

# 搜尋設定
CRON_SCHEDULE=0 11 * * *
SEARCH_REGIONS=1,3
MIN_RENT=8000
MAX_RENT=12000
```

### 3. 取得 LINE User ID

1. 啟動伺服器：`npm start`
2. 設定 LINE Webhook URL（見下方）
3. 用 LINE 發送任意訊息給 Bot
4. 查看 console 輸出的 User ID
5. 將 ID 加入 `.env` 的 `LINE_USER_ID`

### 4. 設定 LINE Webhook

在 LINE Developers Console 設定 Webhook URL：
```
https://你的網域/webhook
```

## 📱 LINE Bot 指令

| 指令 | 說明 |
|------|------|
| `指令` / `help` | 查看所有可用指令 |
| `狀態` | 查看目前搜尋設定 |
| `搜尋` / `找房` | 立即執行搜尋 |
| `租金 8000-15000` | 調整租金範圍 |
| `地區 台北` | 只搜尋台北市 |
| `地區 新北` | 只搜尋新北市 |
| `地區 全部` | 搜尋台北市+新北市 |

## 🌐 API 端點

| 端點 | 說明 |
|------|------|
| `GET /` | 健康檢查，顯示系統狀態 |
| `GET /crawl` | 手動觸發爬蟲 |
| `POST /webhook` | LINE Webhook |

## 📁 專案結構

```
591-rental-bot/
├── server.js      # 主伺服器（Express + 排程）
├── scraper.js     # Playwright 爬蟲
├── linebot.js     # LINE Bot 處理
├── sheets.js      # Google Sheets 整合
├── package.json
├── .env           # 環境變數
└── .gitignore
```

## 🔧 本地開發

```bash
# 測試爬蟲
npm run test-scraper

# 測試 LINE 通知
npm run test-line

# 啟動伺服器
npm start
```

## ☁️ 部署到 Railway

1. Fork 這個專案到你的 GitHub
2. 在 [Railway](https://railway.app) 建立新專案
3. 連接 GitHub 專案
4. 設定環境變數
5. 部署完成後，將 Railway 提供的 URL 設定為 LINE Webhook

## ⚠️ 注意事項

- 591 網站有反爬機制，爬取頻率不宜過高
- 建議每天只爬取 1-2 次
- 若遇到頻繁被阻擋，可增加隨機延遲

## 📄 授權

MIT License

---

## 📝 開發日誌

### 2026-01-16 更新

#### ✅ 已完成
1. **UptimeRobot Keep-Alive 監控**
   - 已設定每 5 分鐘 ping `/health` 端點
   - 監控名稱：`591-rental-bot`
   - 防止 Render 免費方案休眠

2. **LINE Loading 動畫功能**
   - 加入 `showLoadingAnimation()` 函數
   - 當用戶輸入「搜尋」或「找房」時顯示 40 秒 Loading 動畫
   - 使用 LINE Messaging API 的 chatLoading 功能

#### 🔧 待解決問題
- **LINE API 401 錯誤**：Render 上的 `LINE_CHANNEL_ACCESS_TOKEN` 可能被截斷
  - 本地 `.env` Token 長度：172 字元
  - Render 環境變數需要重新設定完整 Token
  - 錯誤訊息：`Authentication failed. Confirm that the access token in the authorization header is valid.`

#### 🔑 環境變數檢查清單
| 變數名稱 | 預期長度 | 狀態 |
|---------|---------|------|
| LINE_CHANNEL_SECRET | 32 字元 | ✅ |
| LINE_CHANNEL_ACCESS_TOKEN | ~172 字元 | ⚠️ 需確認 |
| LINE_USER_ID | ~33 字元 | ✅ |
| GOOGLE_SHEETS_ID | ~44 字元 | ✅ |

#### 📋 下一步
1. 重新在 Render 設定完整的 `LINE_CHANNEL_ACCESS_TOKEN`
2. 確認部署成功後測試 Loading 動畫
3. 確認 LINE Bot 正常接收和回覆訊息
