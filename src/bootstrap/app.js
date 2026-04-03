'use strict';

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const { securityHeaders } = require('../security');

function createHttpApp({ isProd = false } = {}) {
  const app = express();
  app.disable('x-powered-by');
  if (['1', 'true', 'yes'].includes(process.env.TRUST_PROXY)) app.set('trust proxy', 1);
  app.use(securityHeaders({ isProd }));

  if (!isProd) {
    app.use((_, res, next) => { res.removeHeader('Content-Security-Policy'); next(); });
    app.use((_, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
    app.use(cors());
  } else if (process.env.CORS_ORIGIN) {
    app.use(cors({ origin: process.env.CORS_ORIGIN.split(',').map(s => s.trim()), credentials: true }));
  }

  app.use(express.json({ limit: '256kb' }));

  const SKIP_LOG = [
    '/api/me','/api/version','/api/nav/pages','/api/sites','/api/io/pinned','/api/logs',
    '/api/scenes','/api/zones','/api/entities','/api/io/overrides','/api/blocked-io',
    '/api/modules/instances','/api/weather','/api/automation/status'
  ];

  app.use(morgan('dev', {
    skip(req, res) {
      if (res.statusCode === 304) return true;
      if (/\.(js|css|png|ico|html|map|woff2?|ttf|svg)(\?|$)/.test(req.path)) return true;
      return SKIP_LOG.some(p => req.path === p || req.path.startsWith(p + '/') || req.path.startsWith(p + '?'));
    }
  }));

  return app;
}

function mountHtmlGuardAndStatic(app, { users, publicDir }) {
  const PUBLIC_PAGES = new Set(['/login.html', '/favicon.ico']);

  app.use((req, res, next) => {
    if (!req.path.endsWith('.html')) return next();
    if (PUBLIC_PAGES.has(req.path)) return next();
    const h = req.headers.cookie || '';
    const m = h.match(/(?:^|;\s*)elaris_session=([^;]+)/);
    const tok = m ? decodeURIComponent(m[1]) : null;
    if (!tok || !users.verifySession(tok)) return res.redirect('/login.html');
    next();
  });

  app.use(express.static(publicDir || path.join(__dirname, '../../public')));
}

module.exports = {
  createHttpApp,
  mountHtmlGuardAndStatic,
};