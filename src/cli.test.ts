import path from "path";

import { buildArgumentParser } from "./cli";

test("Parses basic arguments", async() => {
  let parser = buildArgumentParser();
  expect(await parser.parse(["a"])).toMatchObject({
    entrypoints: [path.resolve("a")],
    extensions: [".js"],
    includeWarnings: false,
  });
});

test("Allow warnings", async() => {
  let parser = buildArgumentParser();
  expect(await parser.parse(["a", "--warnings"])).toMatchObject({
    entrypoints: [path.resolve("a")],
    extensions: [".js"],
    includeWarnings: true,
  });
});

test("Fails on empty", () => {
  let parser = buildArgumentParser();
  return expect(parser.parse([])).rejects.toBe("At least one entrypoint must be provided.");
});

test("Parses extensions", async() => {
  let parser = buildArgumentParser();
  let args = [
    "a",
    "--ext", ".ts",
    "b",
    "--ext", ".tsx,.jsx",
    "--ext", "fs,.gs",
    "--ext", ".ys,.ps,ws",
    "--ext", "qs,.qs,,,qs,.qs",
    "c",
  ];

  let expected = [".ts", ".jsx", ".tsx", ".fs", ".gs", ".ys", ".ps", ".ws", ".qs"];
  expected.sort();
  let result = await parser.parse(args);
  if (result) {
    result.extensions.sort();
  }

  expect(result).toMatchObject({
    entrypoints: [path.resolve("a"), path.resolve("b"), path.resolve("c")],
    extensions: expected,
    includeWarnings: false,
  });
});
