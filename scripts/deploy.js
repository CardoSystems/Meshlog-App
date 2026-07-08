/*
Required Notice: Copyright (c) 2026 CardoSystems
*/
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const log = (msg) => console.log(`\x1b[35m[DEPLOY]\x1b[0m ${msg}`);
const error = (msg) => console.error(`\x1b[31m[ERROR]\x1b[0m ${msg}`);

function runCommand(command, env = {}) {
  try {
    execSync(command, { stdio: 'inherit', env: { ...process.env, ...env } });
  } catch (err) {
    error(`Command failed: ${command}`);
    process.exit(1);
  }
}

function askUser(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

(async function main() {
  log('Starting Interactive Deployment Process...');

  const stateFile = path.join(__dirname, '..', '.prechecks-passed');
  let defaultPrecheckAnswer = 'Y/n';
  
  if (fs.existsSync(stateFile)) {
    const timestamp = parseInt(fs.readFileSync(stateFile, 'utf-8'), 10);
    const now = Date.now();
    if (!isNaN(timestamp) && (now - timestamp) < 15 * 60 * 1000) {
      log('Recent successful pre-checks detected.');
      defaultPrecheckAnswer = 'y/N';
    }
  }

  // 1. RUN PRE-CHECKS IF NEEDED
  const precheckQ = defaultPrecheckAnswer === 'y/N' ? 'Run Pre-checks suite again? (y/N) ' : 'Run Pre-checks suite? (Y/n) ';
  const ans = await askUser(precheckQ);
  
  const runPrechecks = defaultPrecheckAnswer === 'y/N' ? (ans === 'y') : (ans !== 'n');
  
  if (runPrechecks) {
    runCommand('node scripts/prod-prechecks.js');
  } else {
    log('Skipping Pre-checks...');
  }

  // 2. DEPLOY
  if (await askUser('Deploy to Cloudflare Workers? (Y/n) ') !== 'n') {
    log('Deploying to Cloudflare Workers...');
    runCommand('npx wrangler deploy');
    log('✅ Deployment Successful!');
  } else {
    log('Deployment aborted by user.');
  }

  // 3. CLEANUP
  if (fs.existsSync(stateFile)) {
      fs.unlinkSync(stateFile);
  }

  process.exit(0);
})();
