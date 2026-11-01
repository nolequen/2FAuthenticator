const path = require("path");
const { merge } = require('webpack-merge');
const common = require('./webpack.config.js');

module.exports = merge(common, {
  entry: {
    test: "./src/test.ts",
    "site-name.worker": "./src/test/workers/site-name.worker.ts",
  },
  resolve: {
    alias: {
      mocha$: require.resolve("mocha/mocha.js"),
    },
  },
  module: {
    // to suppress mocha warnings
    exprContextCritical: false,
  },
});
