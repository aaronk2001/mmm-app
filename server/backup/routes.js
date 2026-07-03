'use strict';

const express = require('express');
const { runBackup, listBackups, restoreBackup, BACKUP_DIR } = require('./scheduler');

const router = express.Router();

router.get('/', (req, res) => {
  try {
    res.json({ backups: listBackups(), dir: BACKUP_DIR });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/run', async (req, res) => {
  try {
    const result = await runBackup({ force: true });
    res.json({ backedUp: true, date: result.date });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/restore', (req, res) => {
  try {
    res.json(restoreBackup(req.body?.date));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
