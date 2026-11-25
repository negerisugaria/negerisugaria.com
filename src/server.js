import http from 'node:http';
import { config } from './config/env.js';
import { getDb } from './db/database.js';
import { seedDatabase } from './db/seed.js';
import { createApp } from './app.js';
import { publishDueScheduledPosts } from './modules/news/newsService.js';

const db = getDb();
seedDatabase(db);

const handler = createApp({ db });
const server = http.createServer(handler);

// Check scheduled posts periodically every 60s
const schedulerTimer = setInterval(() => {
  try {
    publishDueScheduledPosts(db);
  } catch (err) {
    console.error('Scheduler error:', err);
  }
}, 60_000);
schedulerTimer.unref();

server.listen(config.port, config.host, () => {
  console.log(`Portal & CMS WebSekolah berjalan di http://${config.host}:${config.port}`);
  console.log(`Dashboard Admin: http://${config.host}:${config.port}/admin`);
});
