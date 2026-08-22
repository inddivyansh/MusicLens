/**
 * api/[...path].js
 *
 * Single catch-all Vercel Serverless Function entry point for MusicLens.
 * All API requests (/api/*) are dispatched through server/router.js.
 *
 * This consolidated entry point ensures MusicLens deploys as exactly 1 Serverless
 * Function on Vercel Hobby (staying well within the 12-function limit).
 */

'use strict';

const dispatch = require('../server/router');

module.exports = async function handler(req, res) {
  return dispatch(req, res);
};
