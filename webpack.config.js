const path = require("path");
const { DefinePlugin } = require("webpack");
const { VueLoaderPlugin } = require("vue-loader");

module.exports = {
  mode: "development",
  devtool: "source-map",
  entry: {
    background: "./src/background.ts",
    content: "./src/content.ts",
    popup: "./src/popup.ts",
    import: "./src/import.ts",
    options: "./src/options.ts",
  },
  module: {
    noParse: /\.wasm$/,
    rules: [
      {
        // argon2-browser overrides
        test: /\.wasm$/,
        loader: "base64-loader",
        type: "javascript/auto"
      },
      {
        test: /\.tsx?$/,
        loader: "ts-loader",
        options: {
          appendTsSuffixTo: [/\.vue$/],
          transpileOnly: true
        },
        exclude: /node_modules/
      },
      {
        test: /\.vue$/,
        loader: "vue-loader",
        options: {
          compilerOptions: {
            whitespace: "preserve"
          }
        }
      },
      {
        test: /\.svg$/,
        loader: path.resolve(__dirname, "scripts/svg-loader.js")
      },
      {
        test: /\.(png|jpe?g|gif)$/,
        use: [
          {
            loader: 'url-loader',
            options: {},
          }
        ]
      }
    ],
  },
  plugins: [
    new VueLoaderPlugin(),
    new DefinePlugin({
      __VUE_OPTIONS_API__: true,
      __VUE_PROD_DEVTOOLS__: false,
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false
    })
  ],
  resolve: {
    extensions: [
      ".mjs",
      ".js",
      ".jsx",
      ".vue",
      ".json",
      ".wasm",
      ".ts",
      ".tsx"
    ],
    modules: ["node_modules"],
    fallback: {
      // Stop argon2-browser from trying to bring in node modules
      fs: false,
      path: false
    }
  },
  output: {
    path: path.resolve(__dirname, "dist"),
    publicPath: "/dist/"
  }
};
