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
    // 舊資料沒有 exclusive 欄位時，預設為互斥（維持原本會員組行為）
    for (const r of parsed.roles) {
        if (r.exclusive === undefined) r.exclusive = true;
    }
    // 每個範圍（all / exclusive / standalone）各記一則訊息，彼此獨立
    if (!parsed.messages || typeof parsed.messages !== 'object') parsed.messages = {};
    // 舊版單一 message 視為「全部」那則
    if (parsed.message && !parsed.messages.all) parsed.messages.all = parsed.message;
    return parsed;
}

async function saveConfig(cfg) {
    await ensureFile();
    await fs.writeFile(DATA_FILE, JSON.stringify(cfg, null, 2), 'utf8');
}

async function addRole({ roleId, label, emoji, style, exclusive = true }) {
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
        exclusive: exclusive !== false,
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

const SCOPES = ['all', 'exclusive', 'standalone'];

// 依範圍取出要顯示的身分組（互斥排前、可並存排後）
function rolesForScope(cfg, scope) {
    const exclusive = cfg.roles.filter(r => r.exclusive !== false);
    const standalone = cfg.roles.filter(r => r.exclusive === false);
    if (scope === 'exclusive') return exclusive;
    if (scope === 'standalone') return standalone;
    return [...exclusive, ...standalone];
}

function buildMessagePayload(cfg, scope = 'all') {
    const ordered = rolesForScope(cfg, scope);
    const hasExclusive = ordered.some(r => r.exclusive !== false);
    const hasIndependent = ordered.some(r => r.exclusive === false);

    const descLines = [];
    if (hasExclusive) {
        descLines.push('🔸 **會員組**：一次只能屬於一個，點擊會切換。');
    }
    if (hasIndependent) {
        descLines.push('🔹 **可並存身分組**（如每日任務）：可自由加入，不影響其他身分組。');
    }
    descLines.push('點擊按鈕加入，再點一次相同按鈕即可取消。');

    const title = scope === 'exclusive'
        ? '🎭 會員組選擇'
        : scope === 'standalone'
            ? '⚔️ 每日任務 / 可並存身分組'
            : '🎭 身分組選擇';

    const embed = new EmbedBuilder()
        .setTitle(title)
        .setColor(0x5865F2)
        .setDescription(
            ordered.length === 0
                ? '目前還沒有設定任何身分組。'
                : descLines.join('\n')
        );

    const rows = [];
    if (ordered.length > 0) {
        for (let i = 0; i < ordered.length; i += 5) {
            const row = new ActionRowBuilder();
            for (const r of ordered.slice(i, i + 5)) {
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

async function postOrUpdateMessage(channel, scope = 'all') {
    if (!SCOPES.includes(scope)) scope = 'all';
    const cfg = await loadConfig();
    if (cfg.roles.length > MAX_ROLES) {
        throw new Error(`會員組數量超過 ${MAX_ROLES} 個上限`);
    }
    if (rolesForScope(cfg, scope).length === 0) {
        const label = scope === 'standalone' ? '可並存（每日任務）身分組' : scope === 'exclusive' ? '會員組' : '身分組';
        throw new Error(`目前沒有${label}可以發佈，請先用 /rolepicker-add 新增`);
    }
    const payload = buildMessagePayload(cfg, scope);

    const slot = cfg.messages[scope];
    if (slot && slot.channelId === channel.id && slot.messageId) {
        try {
            const existing = await channel.messages.fetch(slot.messageId);
            await existing.edit(payload);
            return { mode: 'updated', messageId: existing.id };
        } catch {
            // fall through: message missing or not editable, send new
        }
    }

    const sent = await channel.send(payload);
    cfg.messages[scope] = { channelId: channel.id, messageId: sent.id };
    if (scope === 'all') cfg.message = cfg.messages.all; // 保留舊欄位相容
    await saveConfig(cfg);
    return { mode: 'created', messageId: sent.id };
}

async function refreshMessage(client) {
    const cfg = await loadConfig();
    for (const scope of SCOPES) {
        const slot = cfg.messages[scope];
        if (!slot || !slot.channelId || !slot.messageId) continue;
        try {
            const channel = await client.channels.fetch(slot.channelId);
            const msg = await channel.messages.fetch(slot.messageId);
            await msg.edit(buildMessagePayload(cfg, scope));
        } catch (err) {
            console.error(`刷新身分組選擇訊息（${scope}）失敗:`, err.message);
        }
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
    const exclusiveIds = new Set(
        cfg.roles.filter(r => r.exclusive !== false).map(r => r.roleId)
    );
    const targetExclusive = exclusiveIds.has(targetRoleId);

    try {
        if (alreadyHas) {
            await member.roles.remove(targetRoleId, '身分組選擇器：取消');
            await interaction.reply({ content: `✅ 已取消「${targetRole.name}」`, ephemeral: true });
        } else {
            // 只有互斥身分組才會移除其他互斥身分組；可並存身分組（每日任務）直接加入
            if (targetExclusive) {
                const toRemove = [...member.roles.cache.keys()].filter(
                    id => id !== targetRoleId && exclusiveIds.has(id)
                );
                if (toRemove.length > 0) {
                    await member.roles.remove(toRemove, '身分組選擇器：互斥移除');
                }
            }
            await member.roles.add(targetRoleId, '身分組選擇器：加入');
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
    SCOPES,
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
