const { REST, Routes, SlashCommandBuilder, ChannelType } = require('discord.js');
require('dotenv').config();

const commands = [
    new SlashCommandBuilder()
        .setName('attend')
        .setDescription('查看語音頻道的人員清單')
        .addChannelOption(option =>
            option
                .setName('channel')
                .setDescription('要查看的語音頻道（可選）')
                .addChannelTypes(ChannelType.GuildVoice)
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName('setchannel')
        .setDescription('設定預設監控的語音頻道')
        .addChannelOption(option =>
            option
                .setName('channel')
                .setDescription('要監控的語音頻道')
                .addChannelTypes(ChannelType.GuildVoice)
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('setnotify')
        .setDescription('設定通知訊息發送的文字頻道或討論串')
        .addChannelOption(option =>
            option
                .setName('channel')
                .setDescription('要發送通知的文字頻道（可選）')
                .addChannelTypes(ChannelType.GuildText, ChannelType.PublicThread, ChannelType.PrivateThread)
                .setRequired(false)
        )
        .addStringOption(option =>
            option
                .setName('thread_id')
                .setDescription('討論串 ID（右鍵討論串 → 複製連結 → 取最後一串數字）')
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName('status')
        .setDescription('查看機器人狀態和設定'),

    new SlashCommandBuilder()
        .setName('test')
        .setDescription('測試自動記錄功能')
        .addStringOption(option =>
            option
                .setName('action')
                .setDescription('要測試的功能')
                .setRequired(true)
                .addChoices(
                    { name: '記錄出席（寫入 Sheets）', value: 'record' },
                    { name: '記錄晚到（寫入 Sheets）', value: 'record_late' },
                    { name: '發送活動總結', value: 'summary' }
                )
        ),

    new SlashCommandBuilder()
        .setName('syncmembers')
        .setDescription('同步伺服器成員名單到 Google Sheets')
        .addStringOption(option =>
            option
                .setName('mode')
                .setDescription('同步模式')
                .setRequired(false)
                .addChoices(
                    { name: '新增（只加入新成員）', value: 'add' },
                    { name: '完整同步（更新所有成員）', value: 'full' }
                )
        ),
].map(command => command.toJSON());

async function registerCommands() {
    const token = process.env.DISCORD_TOKEN;
    const guildId = process.env.GUILD_ID;
    const clientId = process.env.CLIENT_ID;

    if (!token || !guildId || !clientId) {
        console.error('❌ 請設定 DISCORD_TOKEN, GUILD_ID 和 CLIENT_ID 環境變數');
        console.log('提示: CLIENT_ID 可在 Discord Developer Portal 的 Application 頁面找到');
        process.exit(1);
    }

    const rest = new REST().setToken(token);

    try {
        console.log('🔄 開始註冊斜線指令...');

        await rest.put(
            Routes.applicationGuildCommands(clientId, guildId),
            { body: commands }
        );

        console.log('✅ 斜線指令註冊成功！');
        console.log('已註冊的指令:');
        commands.forEach(cmd => {
            console.log(`  /${cmd.name} - ${cmd.description}`);
        });
    } catch (error) {
        console.error('❌ 註冊指令失敗:', error);
    }
}

registerCommands();
