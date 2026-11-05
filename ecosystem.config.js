export default {
  apps: [
    {
      name: 'employee-tracker-api',
      cwd: './server',
      script: process.env.NODE_ENV === 'production' ? 'dist/server.js' : 'src/server.ts',
      interpreter: process.env.NODE_ENV === 'production' ? 'node' : 'tsx',
      watch: process.env.NODE_ENV !== 'production',
      env: { NODE_ENV: 'development', PORT: 42780, SERVE_STATIC: 'true' },
      env_production: { NODE_ENV: 'production', PORT: 42780, SERVE_STATIC: 'true' },
      max_restarts: 10,
      restart_delay: 5000,
    },
  ],
};