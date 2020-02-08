module.exports = Object.assign({}, require("./jest.config"), {
  collectCoverage: true,

  coveragePathIgnorePatterns: [
    "/node_modules/",
    "/tests/",
    ".test.ts$",
  ],
});
