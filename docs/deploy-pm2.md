# PM2 部署指南

本文件說明如何使用 PM2 部署 ro-gvg-attend Discord Bot。

## 前置需求

- Node.js >= 18
- npm
- 已設定好的 `.env` 檔案
- 已設定好的 `credentials.json` (Google Service Account)

## 一、安裝 PM2

```bash
npm install -g pm2
```

## 二、首次部署

### 1. 複製專案到伺服器

```bash
git clone <your-repo-url> /home/forge/ro-gvg-attend
cd /home/forge/ro-gvg-attend
```

### 2. 安裝依賴

```bash
npm install --production
```

### 3. 設定環境變數

建立 `.env` 檔案：

```bash
cp .env.example .env
nano .env
```

填入以下內容：

```env
DISCORD_TOKEN=your_discord_token
CLIENT_ID=your_client_id
GUILD_ID=your_guild_id
DEFAULT_VOICE_CHANNEL_ID=your_voice_channel_id
NOTIFY_CHANNEL_ID=your_notify_channel_id
GOOGLE_SHEET_ID=your_sheet_id
```

### 4. 設定 Google 憑證

將 `credentials.json` 放到專案根目錄。

### 5. 註冊 Discord 斜線指令

```bash
npm run register
```

### 6. 建立日誌目錄

```bash
mkdir -p logs
```

### 7. 啟動 Bot

```bash
pm2 start ecosystem.config.js
```

### 8. 設定開機自動啟動

```bash
# 產生啟動腳本（依照指示執行顯示的 sudo 指令）
pm2 startup

# 儲存目前運行的應用列表
pm2 save
```

## 三、日誌輪替設定

### 安裝 pm2-logrotate

```bash
pm2 install pm2-logrotate
```

### 設定輪替參數

```bash
# 單個日誌檔案最大 10MB
pm2 set pm2-logrotate:max_size 10M

# 保留最近 7 個日誌檔案
pm2 set pm2-logrotate:retain 7

# 啟用壓縮舊日誌
pm2 set pm2-logrotate:compress true

# 每天凌晨輪替
pm2 set pm2-logrotate:rotateInterval '0 0 * * *'

# 輪替時加上日期後綴
pm2 set pm2-logrotate:dateFormat YYYY-MM-DD_HH-mm-ss
```

### 查看目前設定

```bash
pm2 conf pm2-logrotate
```

## 四、常用 PM2 指令

| 指令 | 說明 |
|------|------|
| `pm2 start ecosystem.config.js` | 啟動 Bot |
| `pm2 status` | 查看所有應用狀態 |
| `pm2 logs ro-gvg-bot` | 查看即時日誌 |
| `pm2 logs ro-gvg-bot --lines 100` | 查看最後 100 行日誌 |
| `pm2 monit` | 即時監控面板 |
| `pm2 restart ro-gvg-bot` | 重啟 Bot |
| `pm2 stop ro-gvg-bot` | 停止 Bot |
| `pm2 delete ro-gvg-bot` | 刪除 Bot |
| `pm2 save` | 儲存目前應用列表 |
| `pm2 resurrect` | 恢復已儲存的應用 |

## 五、更新部署

當有新版本需要部署時：

```bash
cd /home/forge/ro-gvg-attend
git pull origin main
npm install --production
pm2 restart ro-gvg-bot
```

### Forge Deploy Script 範例

如果使用 Laravel Forge，可設定以下部署腳本：

```bash
cd /home/forge/ro-gvg-attend
git pull origin main
npm install --production
pm2 restart ro-gvg-bot
```

## 六、故障排除

### 查看錯誤日誌

```bash
pm2 logs ro-gvg-bot --err --lines 50
```

### 查看詳細應用資訊

```bash
pm2 show ro-gvg-bot
```

### 重置日誌

```bash
pm2 flush ro-gvg-bot
```

### 完全重啟（清除快取）

```bash
pm2 delete ro-gvg-bot
pm2 start ecosystem.config.js
pm2 save
```

## 七、資源監控

### 即時監控

```bash
pm2 monit
```

### 查看記憶體/CPU 使用

```bash
pm2 status
```

預期資源使用：
- 記憶體：100-150MB
- CPU：< 1%（閒置時）

## 八、檔案結構

```
ro-gvg-attend/
├── src/
│   ├── index.js
│   ├── discord.js
│   ├── sheets.js
│   └── scheduler.js
├── logs/
│   ├── out.log
│   └── error.log
├── ecosystem.config.js    # PM2 設定檔
├── credentials.json       # Google 憑證（勿提交）
├── .env                   # 環境變數（勿提交）
└── package.json
```