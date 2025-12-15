const cron = require('node-cron');
const config = require('../config/config');
const sheets = require('./sheets');

let client = null;
let sessionData = null;

function setClient(discordClient) {
    client = discordClient;
}

// 檢查現在是否在公會戰時間內
function isGvGTime() {
    const now = new Date();
    const day = now.getDay();
    const hour = now.getHours();
    const minute = now.getMinutes();

    const { days, startHour, startMinute, endHour, endMinute } = config.schedule;

    if (!days.includes(day)) return false;

    const currentTime = hour * 60 + minute;
    const startTime = startHour * 60 + startMinute;
    const endTime = endHour * 60 + endMinute;

    return currentTime >= startTime && currentTime <= endTime;
}

// 檢查是否為晚到時間（9:30 之後）
function isLateTime() {
    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();

    const { startHour, startMinute, lateThresholdMinutes } = config.schedule;
    const currentTime = hour * 60 + minute;
    const lateTime = startHour * 60 + startMinute + lateThresholdMinutes;

    return currentTime >= lateTime;
}

// 取得語音頻道成員
async function getVoiceChannelMembers() {
    if (!client) return [];

    const guild = await client.guilds.fetch(config.discord.guildId);
    const channel = await guild.channels.fetch(config.discord.defaultVoiceChannelId);

    if (!channel || !channel.members) return [];

    return Array.from(channel.members.values());
}

// 發送通知訊息
async function sendNotification(message, embed = null) {
    if (!client) return;

    const channelId = config.discord.notifyChannelId;
    console.log(`[通知] 嘗試發送到頻道 ID: ${channelId}`);

    try {
        let channel = null;

        // 方法 1: 直接從 client 獲取
        try {
            channel = await client.channels.fetch(channelId, { force: true });
        } catch (e) {
            console.log('[通知] 方法1失敗，嘗試方法2...');
        }

        // 方法 2: 從 guild 獲取（包含討論串）
        if (!channel) {
            try {
                const guild = await client.guilds.fetch(config.discord.guildId);
                // 先嘗試一般頻道
                channel = guild.channels.cache.get(channelId);

                // 如果找不到，嘗試獲取所有活躍討論串
                if (!channel) {
                    const activeThreads = await guild.channels.fetchActiveThreads();
                    channel = activeThreads.threads.get(channelId);
                }
            } catch (e) {
                console.log('[通知] 方法2失敗:', e.message);
            }
        }

        if (channel) {
            // 如果是封存的討論串，嘗試解封
            if (channel.archived) {
                console.log('[通知] 討論串已封存，嘗試解封...');
                await channel.setArchived(false);
            }

            if (embed) {
                await channel.send({ content: message, embeds: [embed] });
            } else {
                await channel.send(message);
            }
            console.log(`[通知] ✅ 已發送到 ${channel.name}`);
        } else {
            console.error('[通知] ❌ 找不到頻道/討論串');
            console.error('  - 確認 ID 是否正確');
            console.error('  - 確認 Bot 有該頻道的存取權限');
            console.error('  - 如果是討論串，確認沒有被封存');
        }
    } catch (error) {
        console.error('[通知] ❌ 發送失敗:', error.message);
    }
}

// 記錄出席
async function recordAttendance() {
    const members = await getVoiceChannelMembers();
    const isLate = isLateTime();

    if (members.length === 0) {
        console.log('[記錄] 語音頻道無人');
        return;
    }

    // 初始化當日 session
    if (!sessionData) {
        sessionData = {
            date: new Date().toLocaleDateString('zh-TW'),
            records: [],
            allMembers: new Set(),
        };
    }

    // 記錄這次的成員
    const memberNames = members.map(m => m.displayName || m.user?.username);
    memberNames.forEach(name => sessionData.allMembers.add(name));

    sessionData.records.push({
        time: new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }),
        members: memberNames,
        isLate,
    });

    // 寫入 Google Sheets
    try {
        await sheets.recordAttendance(members, isLate);
        console.log(`[記錄] ${memberNames.length} 人 (${isLate ? '晚到' : '準時'})`);

        // 發送 Discord 通知
        const now = new Date();
        const timeStr = now.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });

        await sendNotification(
            `📋 **出席記錄** (${timeStr})\n` +
            `${isLate ? '⚠️ 晚到記錄' : '✅ 準時記錄'}\n` +
            `人數: ${memberNames.length} 人\n` +
            `成員: ${memberNames.join(', ')}`
        );
    } catch (error) {
        console.error('[記錄失敗]', error);
    }
}

// 發送活動總結
async function sendSummary() {
    try {
        const stats = await sheets.getTodayStats();

        if (!stats) {
            await sendNotification('📊 **活動結束** - 今日無記錄');
            return;
        }

        const { EmbedBuilder } = require('discord.js');

        const embed = new EmbedBuilder()
            .setTitle('📊 公會戰出席總結')
            .setColor(0x00AE86)
            .setDescription(`日期: ${stats.date}`)
            .addFields(
                {
                    name: `✅ 準時出席 (${stats.onTime.length} 人)`,
                    value: stats.onTime.length > 0 ? stats.onTime.join(', ') : '無',
                    inline: false,
                },
                {
                    name: `⚠️ 晚到 (${stats.late.length} 人)`,
                    value: stats.late.length > 0 ? stats.late.join(', ') : '無',
                    inline: false,
                },
                {
                    name: `❌ 缺席 (${stats.absent.length} 人)`,
                    value: stats.absent.length > 0 ? stats.absent.join(', ') : '無',
                    inline: false,
                }
            )
            .setTimestamp();

        await sendNotification('🏰 **公會戰結束！**', embed);

        // 重置 session
        sessionData = null;
    } catch (error) {
        console.error('[總結失敗]', error);
    }
}

// 設定排程
function setupSchedule() {
    const { days, startHour, startMinute, endHour, endMinute, intervalMinutes } = config.schedule;

    // 將 days 陣列轉換為 cron 格式
    const daysCron = days.join(',');

    // 計算所有記錄時間點
    const startTotal = startHour * 60 + startMinute;
    const endTotal = endHour * 60 + endMinute;

    const recordTimes = [];
    for (let t = startTotal; t <= endTotal; t += intervalMinutes) {
        recordTimes.push({
            hour: Math.floor(t / 60),
            minute: t % 60,
            isLast: t + intervalMinutes > endTotal
        });
    }

    // 設定每個記錄時間點的 cron job
    recordTimes.forEach(({ hour, minute, isLast }) => {
        cron.schedule(`${minute} ${hour} * * ${daysCron}`, () => {
            console.log(`[排程] 記錄時間: ${hour}:${String(minute).padStart(2, '0')}${isLast ? ' (最後一次)' : ''}`);
            recordAttendance().then(() => {
                if (isLast) {
                    // 最後一次記錄後發送總結
                    setTimeout(sendSummary, 5000);
                }
            });
        });
    });

    console.log('[排程] 已設定公會戰記錄排程');
    console.log(`  - 時間: 每週 ${days.map(d => ['日', '一', '二', '三', '四', '五', '六'][d]).join('、')} ${startHour}:${String(startMinute).padStart(2, '0')}-${endHour}:${String(endMinute).padStart(2, '0')}`);
    console.log(`  - 間隔: 每 ${intervalMinutes} 分鐘`);
    console.log(`  - 記錄時間點: ${recordTimes.map(t => `${t.hour}:${String(t.minute).padStart(2, '0')}`).join(', ')}`);
}

// 取得下次記錄時間
function getNextRecordTime() {
    const now = new Date();
    const { days, startHour, startMinute, endHour, intervalMinutes } = config.schedule;

    // 找出下一個公會戰日
    let nextDate = new Date(now);
    let found = false;

    for (let i = 0; i < 7; i++) {
        const checkDate = new Date(now);
        checkDate.setDate(now.getDate() + i);

        if (days.includes(checkDate.getDay())) {
            // 如果是今天，檢查時間是否已過
            if (i === 0) {
                const endTime = new Date(now);
                endTime.setHours(endHour, 0, 0, 0);

                if (now > endTime) {
                    continue; // 今天已結束，找下一天
                }
            }

            nextDate = checkDate;
            found = true;
            break;
        }
    }

    if (!found) {
        return null;
    }

    // 設定開始時間
    nextDate.setHours(startHour, startMinute, 0, 0);

    // 如果是今天且已經開始，找下一個記錄點
    if (now > nextDate) {
        const currentMinute = now.getMinutes();
        const currentHour = now.getHours();

        if (currentHour < endHour || (currentHour === endHour && currentMinute === 0)) {
            // 計算下一個記錄點
            const nextMinute = Math.ceil(currentMinute / intervalMinutes) * intervalMinutes;
            if (nextMinute < 60) {
                nextDate.setMinutes(nextMinute);
                nextDate.setHours(currentHour);
            } else {
                nextDate.setMinutes(0);
                nextDate.setHours(currentHour + 1);
            }
        }
    }

    return nextDate;
}

module.exports = {
    setClient,
    setupSchedule,
    isGvGTime,
    isLateTime,
    recordAttendance,
    sendSummary,
    getVoiceChannelMembers,
    getNextRecordTime,
};
