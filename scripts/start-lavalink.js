const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const projectRoot = path.resolve(__dirname, '..');
const lavalinkDirectory = path.join(projectRoot, 'lavalink');
const jarPath = path.join(lavalinkDirectory, 'Lavalink.jar');
const configPath = path.join(lavalinkDirectory, 'application.yml');

dotenv.config({ path: path.join(projectRoot, '.env') });

if (!fs.existsSync(jarPath)) {
  console.error(`Missing Lavalink JAR: ${jarPath}`);
  process.exit(1);
}

if (!fs.existsSync(configPath)) {
  console.error(
    'Missing lavalink/application.yml. Copy lavalink/application.example.yml first.',
  );
  process.exit(1);
}

const child = spawn('java', ['-jar', 'Lavalink.jar'], {
  cwd: lavalinkDirectory,
  env: process.env,
  stdio: 'inherit',
  windowsHide: true,
});

child.on('error', (error) => {
  console.error(`Failed to start Lavalink: ${error.message}`);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.log(`Lavalink stopped by signal ${signal}.`);
  }
  process.exitCode = code ?? 0;
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal);
  });
}
