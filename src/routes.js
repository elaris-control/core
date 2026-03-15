'use strict';
// src/routes.js — core API: health, session info, engineer auth
const express = require('express');
const { buildMePayload } = require('./session_info');

function initRoutes({ auth, hasFeature, requireLogin, users }) {
  const router = express.Router();

  router.get('/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

  // Session info — also available at /api/me (mounted in index.js with CSRF)
  router.get('/me', (req, res) => {
    res.json(buildMePayload({ req, users, auth, hasFeature }));
  });

  // Engineer unlock/lock (requires login, handled by auth middleware)
  router.post('/engineer/unlock', requireLogin, auth.unlockEngineer);
  router.post('/engineer/lock',   requireLogin, auth.lockEngineer);

  return router;
}

module.exports = { initRoutes };
