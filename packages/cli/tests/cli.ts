import path from "path";

import { buildArgumentParser } from "../src/cli";
import { getExample } from "./helpers/utils";

test("Parses basic arguments", async() => {
  let parser = buildArgumentParser();
  let file = path.join(getExample("basic-cycle"), "entry.js");
  expect(await parser.parse([file])).toMatchObject({
    entrypoints: [file],
    extensions: [".js"],
    allCycles: false,
  });
});

test("Allow warnings", async() => {
  let parser = buildArgumentParser();
  let file = path.join(getExample("basic-cycle"), "entry.js");
  let module = path.join(getExample("basic-cycle"), "entry");
  expect(await parser.parse([module, "--allCycles"])).toMatchObject({
    entrypoints: [file],
    extensions: [".js"],
    allCycles: true,
  });
});

test("Fails on empty", () => {
  let parser = buildArgumentParser();
  return expect(parser.parse([])).rejects.toBe("At least one entrypoint must be provided.");
});

test("Parses extensions", async() => {
  let file1 = path.join(getExample("basic-cycle"), "entry.js");
  let module = getExample("basic-cycle");
  let file2 = path.join(getExample("basic-cycle"), "module.js");
  let file3 = path.join(getExample("indirect-imports"), "direct.js");

  let parser = buildArgumentParser();
  let args = [
    module,
    "--ext", ".ts",
    file2,
    "--ext", ".tsx,.jsx",
    "--ext", "fs,.gs",
    "--ext", ".ys,.ps,ws",
    "--ext", "qs,.qs,,,qs,.qs",
    file3,
  ];

  let expected = [".ts", ".jsx", ".tsx", ".fs", ".gs", ".ys", ".ps", ".ws", ".qs"];
  expected.sort();
  let result = await parser.parse(args);
  if (result) {
    result.extensions.sort();
  }

  expect(result).toMatchObject({
    entrypoints: [file1, file2, file3],
    extensions: expected,
    allCycles: false,
  });
});
