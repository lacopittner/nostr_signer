// Quick test for Nostr Signer extension
// Usage: npx playwright test-extension.ts

import { chromium } from 'playwright';
import * as path from 'path';

async function testExtension() {
  console.log('Starting extension test...');
  const extensionPath = path.resolve('./dist');
  console.log('Extension path:', extensionPath);

  const browser = await chromium.launch({
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
  });

  // List extensions first
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('\nNavigating to chrome://extensions...');
  await page.goto('chrome://extensions/');
  await page.waitForTimeout(1000);

  // Check if extensions page loaded
  const extensionsLoaded = await page.evaluate(() => {
    return document.body.innerText.length > 0;
  });
  console.log('Extensions page loaded:', extensionsLoaded);

  // Now navigate to a test page
  console.log('\nNavigating to example.com...');
  await page.goto('https://example.com');
  await page.waitForTimeout(2000);

  // Check if window.nostr exists
  const nostrExists = await page.evaluate(() => {
    console.log('Checking window.nostr...');
    console.log('window object keys:', Object.keys(window).filter(k => k.toLowerCase().includes('nostr')));
    return typeof window.nostr !== 'undefined';
  });

  console.log('\n=== Test Results ===');
  console.log(`window.nostr exists: ${nostrExists}`);

  await browser.close();
  console.log('\nTest complete!');
}

testExtension().catch(console.error);
