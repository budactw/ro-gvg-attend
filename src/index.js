require('dotenv').config();

const { client, login } = require('./discord');
const sheets = require('./sheets');
const config = require('../config/config');

async function main() {
    console.log('🚀 啟動公會戰出席記錄機器人...');

    // 驗證環境變數
    const requiredEnvVars = ['DISCORD_TOKEN', 'GUILD_ID', 'DEFAULT_VOICE_CHANNEL_ID', 'NOTIFY_CHANNEL_ID', 'GOOGLE_SHEET_ID'];
    const missingVars = requiredEnvVars.filter(v => !process.env[v]);

    if (missingVars.length > 0) {
        console.error('❌ 缺少必要的環境變數:');
        missingVars.forEach(v => console.error(`  - ${v}`));
        console.log('\n請複製 .env.example 為 .env 並填入相關設定');
        process.exit(1);
    }

    // 初始化 Google Sheets
    try {
        await sheets.initialize();
        console.log('✅ Google Sheets 連線成功');
    } catch (error) {
        console.error('❌ Google Sheets 連線失敗:', error.message);
        console.log('\n請確認:');
        console.log('  1. credentials.json 檔案存在');
        console.log('  2. Google Sheets API 已啟用');
        console.log('  3. Service Account 已分享到 Google Sheet');
        process.exit(1);
    }

    // 登入 Discord
    try {
        await login();
    } catch (error) {
        console.error('❌ Discord 登入失敗:', error.message);
        process.exit(1);
    }
}

// 處理程序終止
process.on('SIGINT', () => {
    console.log('\n👋 機器人關閉中...');
    client.destroy();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n👋 機器人關閉中...');
    client.destroy();
    process.exit(0);
});

main();
