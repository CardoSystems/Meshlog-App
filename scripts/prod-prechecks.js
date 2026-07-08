/*
Required Notice: Copyright (c) 2026 CardoSystems
*/
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const log = (msg) => console.log(`\x1b[36m[PRE-CHECKS]\x1b[0m ${msg}`);
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
  log('Starting Interactive Production Pre-Checks Suite v2.0...');

  // 0. UPDATE WRANGLER
  if (await askUser('Run Phase 0: Check and update Wrangler? (Y/n) ') !== 'n') {
    log('Phase 0: Checking and updating Wrangler to latest version...');
    runCommand('npm install -D wrangler@latest');
    log('Wrangler is up to date.');
  } else {
    log('Skipping Phase 0...');
  }

  // 1. SYNTAX SWEEP
  if (await askUser('Run Phase 1: Syntax Check? (Y/n) ') !== 'n') {
    log('Phase 1: Syntax Check...');
    const workers = ['src/worker.js', 'parser.worker.js', 'main.js'];
    workers.forEach(file => {
      const filePath = path.join(__dirname, '..', file);
      if (fs.existsSync(filePath)) {
        runCommand(`node --check ${filePath}`);
      }
    });
    log('Syntax Check passed.');
  } else {
    log('Skipping Phase 1...');
  }

  // 2. BUILD SWEEP
  if (await askUser('Run Phase 2: Build Vite Frontend? (Y/n) ') !== 'n') {
    log('Phase 2: Building Vite Frontend...');
    runCommand('npm run build');
    log('Build passed.');
  } else {
    log('Skipping Phase 2...');
  }

  // 3. E2E UI SWEEP
  if (await askUser('Run Phase 3: E2E Playwright UI Sweep? (Y/n) ') !== 'n') {
    log('Phase 3: E2E Playwright UI Sweep...');
    
    console.log('  Available Test Options:');
    console.log('  [1] Run All Tests');
    console.log('  [2] Run Mobile Tests Only');
    console.log('  [3] Run Tour Tests Only');
    console.log('  [4] Run Upload Tests Only');
    console.log('  [5] Run All EXCEPT Tour Tests');
    
    const choice = await askUser('  Select an option [1-5] (default: 1): ');
    
    let pwCommand = 'npx playwright test';
    if (choice === '2') {
      pwCommand += ' tests/mobile.spec.js';
    } else if (choice === '3') {
      pwCommand += ' tests/tour.spec.js';
    } else if (choice === '4') {
      pwCommand += ' tests/upload.spec.js';
    } else if (choice === '5') {
      pwCommand += ' --grep-invert "(?i)tour"';
    }
    
    log(`Running: ${pwCommand}`);
    runCommand(pwCommand);
    log('E2E Tests passed.');
  } else {
    log('Skipping Phase 3...');
  }

  // 4. SAVE SUCCESS STATE
  const stateFile = path.join(__dirname, '..', '.prechecks-passed');
  fs.writeFileSync(stateFile, Date.now().toString(), 'utf-8');
  log('✅ Production Pre-Checks Successful! State saved.');
  process.exit(0);
})();
