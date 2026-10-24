const { compileTemplate } = require("vue/compiler-sfc");

module.exports = function svgLoader(source) {
  const svg = source
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<title[\s\S]*?<\/title>/g, "");
  const { code, errors } = compileTemplate({
    source: svg,
    filename: this.resourcePath,
    id: this.resourcePath,
  });
  if (errors.length) {
    throw new Error(errors.map(String).join("\n"));
  }
  return `${code}\nexport default { render };\n`;
};
