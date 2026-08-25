const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const LAVALINK_VERSION = '4.2.2';
const LAVASRC_VERSION = '4.8.3';

const projectRoot = path.resolve(__dirname, '..');
const lavalinkDirectory = path.join(projectRoot, 'lavalink');
const jarPath = path.join(lavalinkDirectory, 'Lavalink.jar');
const pluginsDirectory = path.join(lavalinkDirectory, 'plugins');
const lavasrcPath = path.join(pluginsDirectory, `lavasrc-plugin-${LAVASRC_VERSION}.jar`);
const configPath = path.join(lavalinkDirectory, 'application.yml');

dotenv.config({ path: path.join(projectRoot, '.env') });

function download(url, target) {
  return new Promise((resolve, reject) => {
    console.log(`Downloading ${path.basename(target)}...`);
    const request = require('https').get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        download(response.headers.location, target).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`HTTP ${response.statusCode} for ${url}`));
        return;
      }
      const file = fs.createWriteStream(target);
      response.pipe(file);
      file.on('finish', () => file.end(resolve));
      file.on('error', reject);
    });
    request.on('error', reject);
  });
}

async function ensureFile(url, target, sizeHintBytes) {
  if (fs.existsSync(target) && fs.statSync(target).size > (sizeHintBytes || 0)) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  await download(url, target);
}

async function main() {
  if (!fs.existsSync(configPath)) {
    console.error(
      'Missing lavalink/application.yml. Copy lavalink/application.example.yml first.',
    );
    process.exit(1);
  }

  try {
    await ensureFile(
      `https://github.com/lavalink-devs/Lavalink/releases/download/${LAVALINK_VERSION}/Lavalink.jar`,
      jarPath,
      10_000_000,
    );
    await ensureFile(
      `https://github.com/topi314/LavaSrc/releases/download/${LAVASRC_VERSION}/lavasrc-plugin-${LAVASRC_VERSION}.jar`,
      lavasrcPath,
      1_000_000,
    );
  } catch (error) {
    console.error(`Failed to download Lavalink files: ${error.message}`);
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
}

main();
