require('dotenv').config();

module.exports = {
    discord: {
        token: process.env.DISCORD_TOKEN,
        guildId: process.env.GUILD_ID,
        defaultVoiceChannelId: process.env.DEFAULT_VOICE_CHANNEL_ID,
        notifyChannelId: process.env.NOTIFY_CHANNEL_ID,
    },
    google: {
        sheetId: process.env.GOOGLE_SHEET_ID,
        credentialsPath: './credentials.json',
    },
    schedule: {
        // 公會戰時間：每週三、日 21:00-22:00 (9:00 PM - 10:00 PM)
        days: [0, 3], // 0 = 週日, 3 = 週三
        startHour: 21,
        startMinute: 0,
        endHour: 22,
        endMinute: 0,
        intervalMinutes: 15, // 每 10 分鐘記錄一次
        lateThresholdMinutes: 30, // 超過 30 分鐘算遲到 (9:30 之後)
    },
};
