const fs = require('node:fs/promises');
const path = require('node:path');
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
} = require('discord.js');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'rolepicker.json');

const VALID_STYLES = ['Primary', 'Secondary', 'Success', 'Danger'];
const STYLE_MAP = {
    Primary: ButtonStyle.Primary,
    Secondary: ButtonStyle.Secondary,
    Success: ButtonStyle.Success,
    Danger: ButtonStyle.Danger,
};

const MAX_ROLES = 25;

const CUSTOM_ID_PREFIX = 'rolepicker:';

async function ensureFile() {
    await fs.mkdir(DATA_DIR, { recursive: true });
    try {
        await fs.access(DATA_FILE);
    } catch {
        await fs.writeFile(
            DATA_FILE,
            JSON.stringify({ roles: [], message: null }, null, 2),
            'utf8'
        );
    }
}

async function loadConfig() {
    await ensureFile();
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.roles)) parsed.roles = [];
    if (parsed.message === undefined) parsed.message = null;
    return parsed;
}

async function saveConfig(cfg) {
    await ensureFile();
    await fs.writeFile(DATA_FILE, JSON.stringify(cfg, null, 2), 'utf8');
}

async function addRole({ roleId, label, emoji, style }) {
    const cfg = await loadConfig();
    if (cfg.roles.length >= MAX_ROLES) {
        throw new Error(`會員組數量已達上限 ${MAX_ROLES} 個`);
    }
    if (cfg.roles.some(r => r.roleId === roleId)) {
        throw new Error('此身分組已經在會員組清單中');
    }
    const normalizedStyle = VALID_STYLES.includes(style) ? style : 'Secondary';
    cfg.roles.push({
        roleId,
        label: label.slice(0, 80),
        emoji: emoji || null,
        style: normalizedStyle,
    });
    await saveConfig(cfg);
    return cfg;
}

async function removeRole(roleId) {
    const cfg = await loadConfig();
    const before = cfg.roles.length;
    cfg.roles = cfg.roles.filter(r => r.roleId !== roleId);
    if (cfg.roles.length === before) {
        throw new Error('清單中找不到此身分組');
    }
    await saveConfig(cfg);
    return cfg;
}

async function listRoles() {
    const cfg = await loadConfig();
    return cfg.roles;
}

function buildMessagePayload(cfg) {
    const embed = new EmbedBuilder()
        .setTitle('🎭 會員組選擇')
        .setColor(0x5865F2)
        .setDescription(
            cfg.roles.length === 0
                ? '目前還沒有設定任何會員組。'
                : '點擊下方按鈕選擇你的會員組。\n再點一次相同按鈕可取消。\n一次只能屬於一個會員組。'
        );

    const rows = [];
    if (cfg.roles.length > 0) {
        for (let i = 0; i < cfg.roles.length; i += 5) {
            const row = new ActionRowBuilder();
            for (const r of cfg.roles.slice(i, i + 5)) {
                const btn = new ButtonBuilder()
                    .setCustomId(`${CUSTOM_ID_PREFIX}${r.roleId}`)
                    .setLabel(r.label)
                    .setStyle(STYLE_MAP[r.style] || ButtonStyle.Secondary);
                if (r.emoji) {
                    try { btn.setEmoji(r.emoji); } catch { /* ignore invalid emoji */ }
                }
                row.addComponents(btn);
            }
            rows.push(row);
        }
    }

    return { embeds: [embed], components: rows };
}

async function postOrUpdateMessage(channel) {
    const cfg = await loadConfig();
    if (cfg.roles.length > MAX_ROLES) {
        throw new Error(`會員組數量超過 ${MAX_ROLES} 個上限`);
    }
    const payload = buildMessagePayload(cfg);

    if (cfg.message && cfg.message.channelId === channel.id && cfg.message.messageId) {
        try {
            const existing = await channel.messages.fetch(cfg.message.messageId);
            await existing.edit(payload);
            return { mode: 'updated', messageId: existing.id };
        } catch {
            // fall through: message missing or not editable, send new
        }
    }

    const sent = await channel.send(payload);
    cfg.message = { channelId: channel.id, messageId: sent.id };
    await saveConfig(cfg);
    return { mode: 'created', messageId: sent.id };
}

async function refreshMessage(client) {
    const cfg = await loadConfig();
    if (!cfg.message || !cfg.message.channelId || !cfg.message.messageId) return;
    try {
        const channel = await client.channels.fetch(cfg.message.channelId);
        const msg = await channel.messages.fetch(cfg.message.messageId);
        await msg.edit(buildMessagePayload(cfg));
    } catch (err) {
        console.error('刷新會員組選擇訊息失敗:', err.message);
    }
}

async function handleButtonClick(interaction) {
    if (!interaction.customId.startsWith(CUSTOM_ID_PREFIX)) return false;
    const targetRoleId = interaction.customId.slice(CUSTOM_ID_PREFIX.length);

    const cfg = await loadConfig();
    const managed = new Set(cfg.roles.map(r => r.roleId));
    if (!managed.has(targetRoleId)) {
        await interaction.reply({ content: '❌ 此會員組已不在清單中', ephemeral: true });
        return true;
    }

    const member = await interaction.guild.members.fetch(interaction.user.id);
    const targetRole = await interaction.guild.roles.fetch(targetRoleId).catch(() => null);
    if (!targetRole) {
        await interaction.reply({ content: '❌ 找不到對應的 Discord 身分組，請聯絡管理員', ephemeral: true });
        return true;
    }

    const me = interaction.guild.members.me;
    if (!me.permissions.has('ManageRoles')) {
        await interaction.reply({ content: '❌ 機器人缺少「管理身分組」權限', ephemeral: true });
        return true;
    }
    if (me.roles.highest.comparePositionTo(targetRole) <= 0) {
        await interaction.reply({
            content: `❌ 機器人的身分組必須高於「${targetRole.name}」才能指派此身分組`,
            ephemeral: true,
        });
        return true;
    }

    const alreadyHas = member.roles.cache.has(targetRoleId);

    try {
        if (alreadyHas) {
            await member.roles.remove(targetRoleId, '會員組選擇器：取消');
            await interaction.reply({ content: `✅ 已取消「${targetRole.name}」`, ephemeral: true });
        } else {
            const toRemove = [...member.roles.cache.keys()].filter(
                id => id !== targetRoleId && managed.has(id)
            );
            if (toRemove.length > 0) {
                await member.roles.remove(toRemove, '會員組選擇器：互斥移除');
            }
            await member.roles.add(targetRoleId, '會員組選擇器：加入');
            await interaction.reply({ content: `✅ 已加入「${targetRole.name}」`, ephemeral: true });
        }
    } catch (err) {
        console.error('指派身分組失敗:', err);
        await interaction.reply({
            content: `❌ 指派身分組失敗：${err.message}`,
            ephemeral: true,
        });
    }
    return true;
}

module.exports = {
    CUSTOM_ID_PREFIX,
    VALID_STYLES,
    MAX_ROLES,
    loadConfig,
    addRole,
    removeRole,
    listRoles,
    buildMessagePayload,
    postOrUpdateMessage,
    refreshMessage,
    handleButtonClick,
};
