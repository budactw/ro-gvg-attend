const { google } = require('googleapis');
const config = require('../config/config');

let sheets = null;
let auth = null;

async function initialize() {
    if (sheets) return sheets;

    auth = new google.auth.GoogleAuth({
        keyFile: config.google.credentialsPath,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    sheets = google.sheets({ version: 'v4', auth });
    return sheets;
}

// 取得所有資料
async function getSheetData() {
    await initialize();
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId: config.google.sheetId,
        range: 'A:ZZ',
    });
    return response.data.values || [];
}

// 格式化日期為 MM/DD
function formatDate(date) {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${month}/${day}`;
}

// 記錄出席
async function recordAttendance(members, isLate = false) {
    await initialize();

    const data = await getSheetData();
    const today = formatDate(new Date());

    // 找出日期欄位置（第一列是標題列）
    let headerRow = data[0] || ['成員'];
    let dateColIndex = headerRow.indexOf(today);

    // 如果今天的日期欄不存在，新增它（在「出席次數」欄之前）
    const statsColIndex = headerRow.indexOf('出席次數');
    if (dateColIndex === -1) {
        if (statsColIndex !== -1) {
            // 在統計欄之前插入
            dateColIndex = statsColIndex;
            headerRow.splice(dateColIndex, 0, today);
            // 同步在所有資料列的相同位置插入空值
            for (let i = 1; i < data.length; i++) {
                if (data[i]) {
                    data[i].splice(dateColIndex, 0, '');
                }
            }
        } else {
            // 沒有統計欄，直接加在最後
            dateColIndex = headerRow.length;
            headerRow.push(today);
        }
    }

    // 建立成員名稱到列索引的映射
    const memberRowMap = new Map();
    for (let i = 1; i < data.length; i++) {
        if (data[i] && data[i][0]) {
            memberRowMap.set(data[i][0], i);
        }
    }

    // 準備更新的資料
    const updates = [];
    const newMembers = [];

    for (const member of members) {
        const memberName = member.displayName || member.user?.username || member;

        if (memberRowMap.has(memberName)) {
            // 已存在的成員，更新出席記錄
            const rowIndex = memberRowMap.get(memberName);
            // 確保該列有足夠的欄位
            while (!data[rowIndex]) data[rowIndex] = [];
            while (data[rowIndex].length <= dateColIndex) data[rowIndex].push('');

            // 如果尚未標記（避免覆蓋準時為晚到）
            if (!data[rowIndex][dateColIndex]) {
                data[rowIndex][dateColIndex] = isLate ? '晚' : '✓';
            }
        } else {
            // 新成員
            newMembers.push({
                name: memberName,
                status: isLate ? '晚' : '✓'
            });
        }
    }

    // 新增新成員的列
    for (const newMember of newMembers) {
        const newRow = new Array(headerRow.length).fill('');
        newRow[0] = newMember.name;
        newRow[dateColIndex] = newMember.status;
        data.push(newRow);
        memberRowMap.set(newMember.name, data.length - 1);
    }

    // 更新標題列
    data[0] = headerRow;

    // 更新統計欄
    await updateStatistics(data);

    // 寫回 Google Sheets
    await sheets.spreadsheets.values.update({
        spreadsheetId: config.google.sheetId,
        range: 'A1',
        valueInputOption: 'USER_ENTERED',
        resource: { values: data },
    });

    return {
        date: today,
        recorded: members.length,
        isLate,
    };
}

// 更新統計欄（出席次數）
async function updateStatistics(data) {
    if (!data || data.length === 0) return;

    const headerRow = data[0];

    // 確保有統計欄
    let attendanceColIndex = headerRow.indexOf('出席次數');

    if (attendanceColIndex === -1) {
        attendanceColIndex = headerRow.length;
        headerRow.push('出席次數');
    }

    // 計算每個成員的統計
    for (let i = 1; i < data.length; i++) {
        if (!data[i]) continue;

        let attendanceCount = 0;

        // 從第 1 欄開始計算（跳過成員名稱欄）
        for (let j = 1; j < headerRow.length; j++) {
            if (j === attendanceColIndex) continue;

            const value = data[i][j];
            if (value === '✓') {
                attendanceCount += 1;      // 準時 = 1
            } else if (value === '晚') {
                attendanceCount += 0.5;    // 晚到 = 0.5
            }
        }

        // 確保列有足夠的欄位
        while (data[i].length <= attendanceColIndex) {
            data[i].push('');
        }

        data[i][attendanceColIndex] = attendanceCount;
    }
}

// 取得今日出席統計
async function getTodayStats() {
    const data = await getSheetData();
    if (!data || data.length === 0) return null;

    const today = formatDate(new Date());
    const headerRow = data[0];
    const dateColIndex = headerRow.indexOf(today);

    if (dateColIndex === -1) {
        return { date: today, onTime: [], late: [], absent: [] };
    }

    const onTime = [];
    const late = [];
    const absent = [];

    for (let i = 1; i < data.length; i++) {
        if (!data[i] || !data[i][0]) continue;

        const memberName = data[i][0];
        const status = data[i][dateColIndex];

        if (status === '✓') {
            onTime.push(memberName);
        } else if (status === '晚') {
            late.push(memberName);
        } else {
            absent.push(memberName);
        }
    }

    return { date: today, onTime, late, absent };
}

// 同步成員名單到表格
async function syncMembers(members, mode = 'add') {
    await initialize();

    const data = await getSheetData();

    // 確保有標題列
    if (data.length === 0) {
        data.push(['成員', '出席次數']);
    }

    const headerRow = data[0];

    // 建立現有成員名稱到列索引的映射（處理帶有「(離)」標記的情況）
    const existingMembers = new Map();
    for (let i = 1; i < data.length; i++) {
        if (data[i] && data[i][0]) {
            const name = data[i][0];
            // 儲存原始名稱（去掉「(離)」標記）
            const cleanName = name.replace(/\(離\)$/, '').trim();
            existingMembers.set(cleanName, i);
        }
    }

    const stats = {
        added: [],
        returned: [],  // 回歸的成員
        left: [],      // 離開的成員
        unchanged: 0,
    };

    // 處理傳入的成員
    const currentMemberNames = new Set();

    for (const member of members) {
        const memberName = member.name;
        currentMemberNames.add(memberName);

        if (existingMembers.has(memberName)) {
            // 成員已存在
            const rowIndex = existingMembers.get(memberName);
            const currentName = data[rowIndex][0];

            // 如果之前標記為離開，現在回來了，移除標記
            if (currentName.endsWith('(離)')) {
                data[rowIndex][0] = memberName;
                stats.returned.push(memberName);
            } else {
                stats.unchanged++;
            }
        } else {
            // 新成員
            const newRow = new Array(headerRow.length).fill('');
            newRow[0] = memberName;
            data.push(newRow);
            stats.added.push(memberName);
        }
    }

    // 完整同步模式：標記不在伺服器的成員
    if (mode === 'full') {
        for (let i = 1; i < data.length; i++) {
            if (data[i] && data[i][0]) {
                const currentName = data[i][0];
                // 跳過已標記的成員
                if (currentName.endsWith('(離)')) continue;

                if (!currentMemberNames.has(currentName)) {
                    // 標記為離開
                    data[i][0] = `${currentName}(離)`;
                    stats.left.push(currentName);
                }
            }
        }
    }

    // 寫回 Google Sheets
    await sheets.spreadsheets.values.update({
        spreadsheetId: config.google.sheetId,
        range: 'A1',
        valueInputOption: 'USER_ENTERED',
        resource: { values: data },
    });

    return stats;
}

// 取得現有成員名單（不含已離開的）
async function getExistingMembers() {
    const data = await getSheetData();
    const members = [];

    for (let i = 1; i < data.length; i++) {
        if (data[i] && data[i][0] && !data[i][0].endsWith('(離)')) {
            members.push(data[i][0]);
        }
    }

    return members;
}

module.exports = {
    initialize,
    recordAttendance,
    getTodayStats,
    getSheetData,
    syncMembers,
    getExistingMembers,
};
