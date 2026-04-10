const port = Number(process.env.PORT || 3100);
const appName = process.env.PM2_APP_NAME || 'ugmovies247-web';
const workerName = process.env.PM2_WORKER_NAME || 'ugmovies247-worker';

module.exports = {
  apps: [
    {
      name: appName,
      cwd: __dirname,
      script: 'npm',
      args: `start -- -p ${port}`,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '700M',
      env: {
        NODE_ENV: 'production',
        PORT: String(port),
      },
    },
    {
      name: workerName,
      cwd: __dirname,
      script: 'npm',
      args: 'run video-worker',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '700M',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
