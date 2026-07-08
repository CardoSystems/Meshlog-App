/*
Required Notice: Copyright (c) 2026 CardoSystems
*/
const { chromium } = require('playwright');

(async () => {
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: false }); // User requested headed mode
  const context = await browser.newContext();
  const page = await context.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.error('PAGE ERROR:', err));

  try {
    console.log('Navigating to app...');
    await page.goto('http://127.0.0.1:8787/');

    console.log('Waiting for log parsing/loading screen...');
    
    try {
      // Wait for either the loading screen to disappear OR the demo button to become visible
      await page.waitForFunction(() => {
        const loader = document.getElementById('loading-screen');
        const demoBtn = document.getElementById('btn-load-demo');
        const loaderGone = !loader || window.getComputedStyle(loader).display === 'none' || window.getComputedStyle(loader).opacity === '0';
        const demoBtnVisible = demoBtn && window.getComputedStyle(demoBtn.parentElement).display !== 'none';
        return loaderGone || demoBtnVisible;
      }, { timeout: 30000 });

      // If the demo button is visible, click it
      const demoBtn = await page.$('#btn-load-demo');
      if (demoBtn && await demoBtn.isVisible()) {
          console.log('Clicking Load Demo Dataset button...');
          await demoBtn.click();
          // Wait for loader to disappear after clicking
          await page.waitForFunction(() => {
            const loader = document.getElementById('loading-screen');
            return !loader || window.getComputedStyle(loader).display === 'none' || window.getComputedStyle(loader).opacity === '0';
          }, { timeout: 30000 });
      }

      console.log('Loading screen complete.');
    } catch (e) {
      console.log('Timeout waiting for loading screen. Taking a screenshot...');
      await page.screenshot({ path: `C:/Users/Cardoso/.gemini/antigravity-ide/brain/ab5e19c6-12eb-4411-af15-ac8cef604164/timeout_screenshot.png` });
      process.exit(1);
    }

    console.log('Waiting for Dashboard to fully initialize...');
    await page.waitForFunction(() => {
      const el = document.getElementById('main-content');
      return el && window.getComputedStyle(el).opacity === '1';
    }, { timeout: 30000 });

    console.log('Waiting for Driver.js popover to appear automatically...');
    await page.waitForFunction(() => {
      return document.querySelector('.driver-popover') !== null;
    }, { timeout: 10000 }).catch(async () => {
      console.log('Popover did not appear automatically. Clicking Tour button manually...');
      await page.click('#btn-tutorial');
    });

    await page.waitForTimeout(1000); // Give the popover time to fully animate in

    async function playTour(tourName, stepCounter) {
      console.log(`Iterating ${tourName} tour steps...`);
      let localStep = 1;
      while (true) {
        await page.waitForTimeout(1500); // Let UI animations settle
        console.log(`Taking screenshot for ${tourName} step ${localStep}...`);
        await page.screenshot({ path: `C:/Users/Cardoso/.gemini/antigravity-ide/brain/ab5e19c6-12eb-4411-af15-ac8cef604164/tutorial_${tourName}_step_${localStep}.png` });

        const btnNext = await page.$('.driver-popover-next-btn');
        if (!btnNext) {
          console.log('No next button found, tour finished.');
          break;
        }
        
        const isDisabled = await btnNext.evaluate(node => node.disabled || node.classList.contains('driver-popover-next-btn-disabled'));
        const btnText = await btnNext.innerText();
        console.log(`Step ${localStep} button text: "${btnText}", isDisabled: ${isDisabled}`);
        
        if (isDisabled || btnText.toLowerCase().includes('done')) {
          console.log(`Reached the final step of ${tourName}. Clicking Done...`);
          await btnNext.click();
          await page.waitForTimeout(500);
          break;
        }

        console.log('Clicking next...');
        await btnNext.click();
        localStep++;
      }
      return stepCounter + localStep;
    }

    let totalSteps = 0;
    totalSteps = await playTour('global', totalSteps);
    
    // UI now automatically chains into map tour after global finishes
    console.log('Playing Map Tour...');
    await page.waitForTimeout(500); // Wait for transition
    totalSteps = await playTour('map', totalSteps);
    
    console.log('Switching to Network Tab...');
    await page.click('#btn-net');
    await page.waitForTimeout(1000); // wait for driver popover
    totalSteps = await playTour('network', totalSteps);

    console.log('Switching to Sidebar Tab...');
    await page.click('#btn-sidebar');
    await page.waitForTimeout(1000); // wait for driver popover
    totalSteps = await playTour('unmapped', totalSteps);

    console.log(`Finished capturing all contextual tours.`);
  } catch (err) {
    console.error('Error during test:', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
