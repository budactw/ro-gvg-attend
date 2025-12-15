const { Client, GatewayIntentBits, EmbedBuilder, ChannelType } = require('discord.js');
const config = require('../config/config');
const scheduler = require('./scheduler');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
    ],
});

// 處理 /attend 指令
async function handleAttend(interaction) {
    const channel = interaction.options.getChannel('channel') ||
        await interaction.guild.channels.fetch(config.discord.defaultVoiceChannelId);

    if (!channel || channel.type !== ChannelType.GuildVoice) {
        await interaction.reply({ content: '❌ 請指定有效的語音頻道', ephemeral: true });
        return;
    }

    const members = Array.from(channel.members.values());

    if (members.length === 0) {
        await interaction.reply({ content: `📋 **${channel.name}** 目前沒有人`, ephemeral: true });
        return;
    }

    const memberList = members.map(m => m.displayName || m.user.username);

    const embed = new EmbedBuilder()
        .setTitle(`📋 ${channel.name} 人員清單`)
        .setColor(0x5865F2)
        .setDescription(`共 ${members.length} 人`)
        .addFields({
            name: '成員',
            value: memberList.join('\n'),
            inline: false,
        })
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });
}

// 處理 /setchannel 指令
async function handleSetChannel(interaction) {
    const channel = interaction.options.getChannel('channel');

    if (!channel || channel.type !== ChannelType.GuildVoice) {
        await interaction.reply({ content: '❌ 請指定有效的語音頻道', ephemeral: true });
        return;
    }

    // 更新設定（這裡簡化處理，實際可存到資料庫或檔案）
    config.discord.defaultVoiceChannelId = channel.id;

    await interaction.reply({
        content: `✅ 已設定預設語音頻道為: **${channel.name}**`,
        ephemeral: true,
    });
}

// 處理 /setnotify 指令
async function handleSetNotify(interaction) {
    const channel = interaction.options.getChannel('channel');
    const threadId = interaction.options.getString('thread_id');

    // 支援文字頻道和討論串
    const validTypes = [
        ChannelType.GuildText,
        ChannelType.PublicThread,
        ChannelType.PrivateThread,
    ];

    let targetChannel = null;
    let targetId = null;

    if (threadId) {
        // 使用者輸入了討論串 ID
        try {
            targetChannel = await interaction.guild.channels.fetch(threadId);
            targetId = threadId;
        } catch (error) {
            await interaction.reply({ content: '❌ 找不到該討論串，請確認 ID 是否正確', ephemeral: true });
            return;
        }
    } else if (channel) {
        targetChannel = channel;
        targetId = channel.id;
    } else {
        await interaction.reply({ content: '❌ 請指定頻道或輸入討論串 ID', ephemeral: true });
        return;
    }

    if (!targetChannel || !validTypes.includes(targetChannel.type)) {
        await interaction.reply({ content: '❌ 請指定有效的文字頻道或討論串', ephemeral: true });
        return;
    }

    config.discord.notifyChannelId = targetId;

    await interaction.reply({
        content: `✅ 已設定通知頻道為: **${targetChannel.name}**`,
        ephemeral: true,
    });
}

// 處理 /test 指令
async function handleTest(interaction) {
    const action = interaction.options.getString('action');

    await interaction.deferReply();

    try {
        switch (action) {
            case 'record':
            case 'record_late': {
                const isLate = action === 'record_late';
                const members = await scheduler.getVoiceChannelMembers();

                if (members.length === 0) {
                    await interaction.editReply('❌ 語音頻道目前沒有人');
                    return;
                }

                const sheets = require('./sheets');
                const result = await sheets.recordAttendance(members, isLate);
                const memberNames = members.map(m => m.displayName || m.user?.username);

                await interaction.editReply(
                    `✅ **測試記錄完成**\n` +
                    `📅 日期: ${result.date}\n` +
                    `📝 類型: ${isLate ? '晚到' : '準時'}\n` +
                    `👥 人數: ${memberNames.length} 人\n` +
                    `成員: ${memberNames.join(', ')}`
                );
                break;
            }

            case 'summary': {
                await scheduler.sendSummary();
                await interaction.editReply('✅ 已發送活動總結到通知頻道');
                break;
            }
        }
    } catch (error) {
        console.error('測試失敗:', error);
        await interaction.editReply(`❌ 測試失敗: ${error.message}`);
    }
}

// 處理 /status 指令
async function handleStatus(interaction) {
    const nextTime = scheduler.getNextRecordTime();
    const isActive = scheduler.isGvGTime();

    const voiceChannel = config.discord.defaultVoiceChannelId
        ? await interaction.guild.channels.fetch(config.discord.defaultVoiceChannelId).catch(() => null)
        : null;

    const notifyChannel = config.discord.notifyChannelId
        ? await interaction.guild.channels.fetch(config.discord.notifyChannelId).catch(() => null)
        : null;

    const embed = new EmbedBuilder()
        .setTitle('🤖 機器人狀態')
        .setColor(isActive ? 0x00FF00 : 0x5865F2)
        .addFields(
            {
                name: '⏰ 公會戰狀態',
                value: isActive ? '🟢 進行中' : '🔴 未開始',
                inline: true,
            },
            {
                name: '📅 下次記錄時間',
                value: nextTime ? nextTime.toLocaleString('zh-TW') : '無',
                inline: true,
            },
            {
                name: '🎤 監控語音頻道',
                value: voiceChannel ? voiceChannel.name : '未設定',
                inline: true,
            },
            {
                name: '📢 通知文字頻道',
                value: notifyChannel ? notifyChannel.name : '未設定',
                inline: true,
            }
        )
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });
}

// 監聽指令
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    try {
        switch (interaction.commandName) {
            case 'attend':
                await handleAttend(interaction);
                break;
            case 'setchannel':
                await handleSetChannel(interaction);
                break;
            case 'setnotify':
                await handleSetNotify(interaction);
                break;
            case 'status':
                await handleStatus(interaction);
                break;
            case 'test':
                await handleTest(interaction);
                break;
        }
    } catch (error) {
        console.error('指令執行錯誤:', error);
        const reply = { content: '❌ 執行指令時發生錯誤', ephemeral: true };
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(reply);
        } else {
            await interaction.reply(reply);
        }
    }
});

// Bot 就緒
client.once('clientReady', () => {
    console.log(`✅ 機器人已登入: ${client.user.tag}`);
    console.log(`📡 伺服器數量: ${client.guilds.cache.size}`);

    // 設定排程器的 client
    scheduler.setClient(client);

    // 啟動排程
    scheduler.setupSchedule();
});

module.exports = {
    client,
    login: () => client.login(config.discord.token),
};
