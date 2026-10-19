const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const base = process.env.TASKORA_URL || 'http://127.0.0.1:5000';
const output = path.join(__dirname, '..', 'screenshots');
fs.mkdirSync(output, { recursive: true });
async function shot(page, name) { await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: false }); console.log(`saved screenshots/${name}.png`); }
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, colorScheme: 'light' });
  const page = await context.newPage();
  await page.goto(`${base}/`, { waitUntil: 'networkidle' }); await shot(page, 'landing');
  await page.goto(`${base}/login`, { waitUntil: 'networkidle' }); await shot(page, 'login');
  await page.fill('#identifier', 'demo'); await page.fill('#loginPassword', 'Password123!'); await page.click('#login-form button[type="submit"]'); await page.waitForURL(/\/app/); await page.waitForTimeout(500); await shot(page, 'dashboard-light');
  await page.click('[data-action="theme"]'); await page.waitForTimeout(250); await shot(page, 'dashboard-dark');
  await page.goto(`${base}/projects`, { waitUntil: 'networkidle' }); await page.locator('.project-card-main').first().click(); await page.waitForTimeout(600); await shot(page, 'board-dark');
  await page.click('[data-action="theme"]'); await page.waitForTimeout(250); await shot(page, 'board-light');
  await page.click('[data-action="set-view"][data-view="list"]'); await page.waitForTimeout(250); await shot(page, 'list-view');
  await page.click('[data-action="set-view"][data-view="calendar"]'); await page.waitForTimeout(250); await shot(page, 'calendar-view');
  const task = page.locator('[data-action="open-task"]').first(); if (await task.count()) { await task.click(); await page.waitForTimeout(300); await shot(page, 'task-detail'); }
  await page.goto(`${base}/notifications`, { waitUntil: 'networkidle' }); await page.waitForTimeout(250); await shot(page, 'notifications');
  await browser.close();
})().catch((error) => { console.error(error); process.exitCode = 1; });
