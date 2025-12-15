# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Discord bot for automatically recording guild war (GvG) attendance in voice channels and syncing data to Google Sheets.

## Commands

```bash
# Install dependencies
npm install

# Register Discord slash commands (run once after setup)
npm run register

# Start the bot
npm start

# Development mode (auto-restart on changes)
npm run dev
```

## Architecture

```
src/
├── index.js          # Entry point, initializes bot and validates config
├── discord.js        # Discord client, slash command handlers
├── sheets.js         # Google Sheets API operations
├── scheduler.js      # Cron jobs for auto-recording during GvG time
└── register-commands.js  # One-time script to register slash commands
```

### Key Components

- **Scheduler** (`scheduler.js`): Runs cron jobs on Wed/Sun 21:00-22:00, records attendance every 10 minutes, sends summary at end
- **Sheets** (`sheets.js`): Manages attendance grid (dates as columns, members as rows), tracks on-time (✓) vs late (遲) attendance
- **Discord** (`discord.js`): Handles `/attend`, `/setchannel`, `/setnotify`, `/status` commands

### Configuration

- `config/config.js`: Schedule settings (days, hours, late threshold)
- `.env`: API tokens and channel IDs (see `.env.example`)
- `credentials.json`: Google Service Account credentials (not committed)

## Setup Requirements

1. Discord Bot with `GUILD_MEMBERS` and `GUILD_VOICE_STATES` intents enabled
2. Google Cloud project with Sheets API enabled
3. Service Account with credentials.json, shared to target spreadsheet
