const { Client, GatewayIntentBits, EmbedBuilder, ChannelType } = require('discord.js');
const config = require('../config/config');
const scheduler = require('./scheduler');
const rolepicker = require('./rolepicker');

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

// 處理 /syncmembers 指令
async function handleSyncMembers(interaction) {
    await interaction.deferReply();

    try {
        const mode = interaction.options.getString('mode') || 'add';
        const guild = interaction.guild;

        // 抓取所有成員
        await guild.members.fetch();

        // 定義要抓取的角色
        const roleNames = ['【會長', '【副會長】', '【幹部】', '【會員】'];

        // 收集成員資料
        const members = [];
        const processedIds = new Set();

        for (const roleName of roleNames) {
            const role = guild.roles.cache.find(r => r.name === roleName);
            if (!role) continue;

            for (const [memberId, member] of role.members) {
                // 跳過已處理的成員
                if (processedIds.has(memberId)) continue;
                // 跳過機器人
                if (member.user.bot) continue;

                processedIds.add(memberId);
                members.push({
                    name: member.displayName || member.user.username,
                });
            }
        }

        if (members.length === 0) {
            await interaction.editReply('❌ 找不到任何符合角色的成員（會長/副會長/幹部/會員）');
            return;
        }

        // 同步到 Google Sheets
        const sheets = require('./sheets');
        const stats = await sheets.syncMembers(members, mode);

        // 建立回覆訊息
        const embed = new EmbedBuilder()
            .setTitle('📋 成員同步完成')
            .setColor(0x00FF00)
            .addFields(
                {
                    name: '📊 統計',
                    value: [
                        `伺服器成員: ${members.length} 人`,
                        `新增: ${stats.added.length} 人`,
                        `回歸: ${stats.returned.length} 人`,
                        `離開: ${stats.left.length} 人`,
                        `未變更: ${stats.unchanged} 人`,
                    ].join('\n'),
                    inline: false,
                }
            )
            .setTimestamp();

        // 如果有新增的成員，列出名單
        if (stats.added.length > 0 && stats.added.length <= 20) {
            embed.addFields({
                name: '✅ 新增成員',
                value: stats.added.join(', '),
                inline: false,
            });
        }

        // 如果有回歸的成員，列出名單
        if (stats.returned.length > 0 && stats.returned.length <= 20) {
            embed.addFields({
                name: '🔄 回歸成員',
                value: stats.returned.join(', '),
                inline: false,
            });
        }

        // 如果有離開的成員，列出名單
        if (stats.left.length > 0 && stats.left.length <= 20) {
            embed.addFields({
                name: '👋 已離開',
                value: stats.left.join(', '),
                inline: false,
            });
        }

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error('同步成員失敗:', error);
        await interaction.editReply(`❌ 同步失敗: ${error.message}`);
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

// 處理 /line 指令
async function handleLine(interaction) {
    if (!config.line.groupUrl) {
        await interaction.reply({ content: '❌ 尚未設定 LINE 群組連結', ephemeral: true });
        return;
    }
    await interaction.reply({ content: config.line.groupUrl });
}

// 處理 /rolepicker-add 指令
async function handleRolePickerAdd(interaction) {
    const role = interaction.options.getRole('role', true);
    const label = interaction.options.getString('label', true);
    const emoji = interaction.options.getString('emoji');
    const style = interaction.options.getString('style');
    const standalone = interaction.options.getBoolean('standalone') ?? false;

    try {
        await rolepicker.addRole({ roleId: role.id, label, emoji, style, exclusive: !standalone });
        const typeText = standalone ? '可並存身分組（可自由加入退出、不互斥）' : '會員組（互斥）';
        await interaction.reply({
            content: `✅ 已將 **${role.name}** 加入清單，類型：${typeText}（按鈕文字：${label}）。可執行 \`/rolepicker-post\` 更新訊息。`,
            ephemeral: true,
        });
    } catch (err) {
        await interaction.reply({ content: `❌ ${err.message}`, ephemeral: true });
    }
}

// 處理 /rolepicker-remove 指令
async function handleRolePickerRemove(interaction) {
    const role = interaction.options.getRole('role', true);
    try {
        await rolepicker.removeRole(role.id);
        await interaction.reply({
            content: `✅ 已從清單移除 **${role.name}**。可執行 \`/rolepicker-post\` 更新訊息。`,
            ephemeral: true,
        });
    } catch (err) {
        await interaction.reply({ content: `❌ ${err.message}`, ephemeral: true });
    }
}

// 處理 /rolepicker-list 指令
async function handleRolePickerList(interaction) {
    const roles = await rolepicker.listRoles();
    if (roles.length === 0) {
        await interaction.reply({ content: '📭 目前沒有設定任何會員組', ephemeral: true });
        return;
    }
    const lines = roles.map((r, i) => {
        const guildRole = interaction.guild.roles.cache.get(r.roleId);
        const name = guildRole ? guildRole.name : `(已刪除的身分組 ${r.roleId})`;
        const emoji = r.emoji ? `${r.emoji} ` : '';
        const typeTag = r.exclusive === false ? '🔹可並存' : '🔸互斥';
        return `${i + 1}. ${emoji}**${r.label}** → ${name} [${r.style}] ${typeTag}`;
    });
    const embed = new EmbedBuilder()
        .setTitle('🎭 會員組清單')
        .setColor(0x5865F2)
        .setDescription(lines.join('\n'));
    await interaction.reply({ embeds: [embed], ephemeral: true });
}

// 處理 /rolepicker-post 指令
async function handleRolePickerPost(interaction) {
    const channel = interaction.channel;
    if (!channel || channel.type !== ChannelType.GuildText) {
        await interaction.reply({ content: '❌ 只能在文字頻道發佈會員組選擇訊息', ephemeral: true });
        return;
    }
    try {
        const result = await rolepicker.postOrUpdateMessage(channel);
        await interaction.reply({
            content: result.mode === 'updated'
                ? '✅ 已更新原有的會員組選擇訊息'
                : '✅ 已發佈新的會員組選擇訊息',
            ephemeral: true,
        });
    } catch (err) {
        await interaction.reply({ content: `❌ ${err.message}`, ephemeral: true });
    }
}

// 監聽指令
client.on('interactionCreate', async (interaction) => {
    if (interaction.isButton()) {
        if (interaction.customId.startsWith(rolepicker.CUSTOM_ID_PREFIX)) {
            try {
                await rolepicker.handleButtonClick(interaction);
            } catch (error) {
                console.error('按鈕處理錯誤:', error);
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: '❌ 處理按鈕時發生錯誤', ephemeral: true }).catch(() => {});
                }
            }
        }
        return;
    }

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
            case 'syncmembers':
                await handleSyncMembers(interaction);
                break;
            case 'line':
                await handleLine(interaction);
                break;
            case 'rolepicker-add':
                await handleRolePickerAdd(interaction);
                break;
            case 'rolepicker-remove':
                await handleRolePickerRemove(interaction);
                break;
            case 'rolepicker-list':
                await handleRolePickerList(interaction);
                break;
            case 'rolepicker-post':
                await handleRolePickerPost(interaction);
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
