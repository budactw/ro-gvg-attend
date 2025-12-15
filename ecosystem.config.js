module.exports = {
  apps: [
    {
      name: 'ro-gvg-bot',
      script: 'src/index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '200M',
      env: {
        NODE_ENV: 'production',
      },
      // 錯誤時自動重啟，但有頻率限制
      exp_backoff_restart_delay: 100,
      // 日誌設定
      error_file: 'logs/error.log',
      out_file: 'logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      // 合併日誌
      merge_logs: true,
    },
  ],
};