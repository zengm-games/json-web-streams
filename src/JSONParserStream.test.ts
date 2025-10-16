import { glob, readFile } from "node:fs/promises";
import path from "node:path";
import { assert, describe, test } from "vitest";
import { JSONParserStream } from "./JSONParserStream.ts";
import type { JSONPath } from "./jsonPathToQueryPath.ts";
import { makeReadableStreamFromJson } from "./test/utils.ts";

describe("Parsing", async () => {
	const parseWholeJson = async (json: string) => {
		// With jsonPath $ (return root object) it should only emit one chunk, but with invalid JSON there could be more text, and we need to read through it all to make sure we see any errors that appear
		let firstValue: any;

		await makeReadableStreamFromJson(json)
			.pipeThrough(new JSONParserStream(["$"]))
			.pipeTo(
				new WritableStream({
					write({ value }) {
						if (firstValue === undefined) {
							firstValue = value;
						}
					},
				}),
			);

		return firstValue;
	};

	for await (const entry of glob(
		path.join(__dirname, "test/parsing/**/*.json"),
	)) {
		const filename = path.basename(entry);
		const shouldPass = filename.startsWith("pass") || filename.startsWith("y_");

		test(filename, async () => {
			const json = await readFile(entry, "utf8");

			let error, object;
			try {
				object = await parseWholeJson(json);
			} catch (error2) {
				error = error2;
			}

			if (shouldPass && error) {
				throw new Error("Expected valid JSON, but parsing failed", {
					cause: error,
				});
			} else if (!shouldPass && !error) {
				throw new Error("Expected invalid JSON, but parsing succeeded");
			}

			// If we expected a pass, confirm the parsed object matches JSON.parse
			if (shouldPass) {
				const object2 = JSON.parse(json);
				assert.deepStrictEqual(object, object2);
			}
		});
	}
});

describe("Streaming", () => {
	const json = JSON.stringify([{ foo: [1, 2] }, { bar: [{ x: 3 }, { x: 4 }] }]);

	test("streams values", async () => {
		const stream = makeReadableStreamFromJson(json).pipeThrough(
			new JSONParserStream(["$[*].foo[*]"]),
		);
		const chunks = await Array.fromAsync(stream);
		assert.deepStrictEqual(chunks, [
			{ value: 1, index: 0 },
			{ value: 2, index: 0 },
		]);
	});

	test("streams values from two paths", async () => {
		const stream = makeReadableStreamFromJson(json).pipeThrough(
			new JSONParserStream(["$[*].foo[*]", "$[*].bar[*]"]),
		);
		const chunks = await Array.fromAsync(stream);
		assert.deepStrictEqual(chunks, [
			{ value: 1, index: 0 },
			{ value: 2, index: 0 },
			{ value: { x: 3 }, index: 1 },
			{ value: { x: 4 }, index: 1 },
		]);
	});

	test("streams values from two paths, where one is nested in the other", async () => {
		const stream = makeReadableStreamFromJson(json).pipeThrough(
			new JSONParserStream(["$[*].bar[*]", "$[*].bar[*].x"]),
		);
		const chunks = await Array.fromAsync(stream);
		assert.deepStrictEqual(chunks, [
			{ value: 3, index: 1 },
			{ value: { x: 3 }, index: 0 },
			{ value: 4, index: 1 },
			{ value: { x: 4 }, index: 0 },
		]);
	});

	test("nested objects are distinct objects, one is not the child of the other", async () => {
		const json = JSON.stringify({ foo: { bar: 1 } });
		const stream = makeReadableStreamFromJson(json).pipeThrough(
			new JSONParserStream<[any, any]>(["$.foo", "$"]),
		);
		const chunks = await Array.fromAsync(stream, (row) => row.value);
		assert.deepStrictEqual(chunks, [{ bar: 1 }, { foo: { bar: 1 } }]);
		chunks[0].bar = 2;
		assert.deepStrictEqual(chunks, [{ bar: 2 }, { foo: { bar: 1 } }]);
	});

	test("streams values from non-overlapping paths at different levels, without clobbering each other", async () => {
		const stream = makeReadableStreamFromJson(
			'{"bar": [1,2,3], "foo": [{"key": 1}]}',
		).pipeThrough(
			// Why does order of jsonPaths matter?
			new JSONParserStream(["$.foo", "$.bar[*]"]),
		);

		const chunks = await Array.fromAsync(stream);
		const foo = chunks
			.filter((chunk) => chunk.index === 0)
			.map((chunk) => chunk.value);
		assert.deepStrictEqual(foo, [[{ key: 1 }]]);
	});

	test("confirm that we're not just reading everything into memory all the time", async () => {
		let maxStackSize = 0;

		// Monkey patch to track the size of the stack
		const monkeyPatch = (stream: JSONParserStream) => {
			const prevOnValue = stream._parser.onValue;
			stream._parser.onValue = (value, stack) => {
				// This is not a very accurate way to get stack size, but works enough for these purposes.
				const stackSize = JSON.stringify(stack).length;
				maxStackSize = Math.max(maxStackSize, stackSize);
				prevOnValue(value, stack);
			};
			return stream;
		};

		// This stream emits the whole object ($) so it has to read the whole object into memory at some point
		await makeReadableStreamFromJson(json)
			.pipeThrough(monkeyPatch(new JSONParserStream(["$"])))
			.pipeTo(new WritableStream());
		const maxStackSize0 = maxStackSize;

		// This stream only emits part of the object, so it should use less memory than the previous stream
		maxStackSize = 0;
		await makeReadableStreamFromJson(json)
			.pipeThrough(monkeyPatch(new JSONParserStream(["$[*].bar[*]"])))
			.pipeTo(new WritableStream());
		const maxStackSize1 = maxStackSize;

		// The first stream should use more memory than the second
		assert.isAbove(maxStackSize0, maxStackSize1);
	});

	test("[*] works for objects too, not just arrays", async () => {
		const cases: {
			jsonPath: JSONPath;
			data: unknown;
		}[] = [
			{
				jsonPath: "$[*]",
				data: { foo: "f", bar: "b" },
			},
			{
				jsonPath: "$.x[*]",
				data: { x: { foo: "f", bar: "b" } },
			},
		];

		for (const { jsonPath, data } of cases) {
			const json = JSON.stringify(data);
			const stream = makeReadableStreamFromJson(json).pipeThrough(
				new JSONParserStream([jsonPath]),
			);
			const values = await Array.fromAsync(stream);
			assert.deepStrictEqual(values, [
				{
					index: 0,
					value: "f",
					wildcardKeys: ["foo"],
				},
				{
					index: 0,
					value: "b",
					wildcardKeys: ["bar"],
				},
			]);
		}
	});

	test("[*][*] for object and array", async () => {
		// These are all equivalent
		const jsonPaths: JSONPath[] = [
			"$.*.*",
			"$[*].*",
			"$.*[*]",
			"$[*][*]",
			"$[*,*]",
		];

		const data = {
			foo: [1, 2],
			bar: [3, 4],
		};
		const json = JSON.stringify(data);

		for (const jsonPath of jsonPaths) {
			const stream = makeReadableStreamFromJson(json).pipeThrough(
				new JSONParserStream([jsonPath]),
			);
			const values = await Array.fromAsync(stream);
			assert.deepStrictEqual(
				values,
				[
					{
						index: 0,
						value: 1,
						wildcardKeys: ["foo"],
					},
					{
						index: 0,
						value: 2,
						wildcardKeys: ["foo"],
					},
					{
						index: 0,
						value: 3,
						wildcardKeys: ["bar"],
					},
					{
						index: 0,
						value: 4,
						wildcardKeys: ["bar"],
					},
				],
				jsonPath,
			);
		}
	});
});

describe("multi option", () => {
	const separators = ["", "\n", "\r\n", " ", " \n ", "␞"];
	for (const separator of separators) {
		test(`Multiple JSON objects with ${JSON.stringify(separator)} in between`, async () => {
			const objects = [{ a: 1 }, { a: 2 }, { foo: "bar" }, { a: 3 }];
			const json = objects
				.map((object) => JSON.stringify(object))
				.join(separator);
			const stream = makeReadableStreamFromJson(json).pipeThrough(
				new JSONParserStream(["$.a"], {
					multi: true,
				}),
			);
			const chunks = await Array.fromAsync(stream);
			assert.deepStrictEqual(chunks, [
				{ value: 1, index: 0 },
				{ value: 2, index: 0 },
				{ value: 3, index: 0 },
			]);
		});

		test(`Multiple JSON objects with ${JSON.stringify(separator)} in between, before, and after`, async () => {
			const objects = [{ a: 1 }, { a: 2 }, { foo: "bar" }, { a: 3 }];
			const json =
				separator +
				objects.map((object) => JSON.stringify(object)).join(separator) +
				separator;
			const stream = makeReadableStreamFromJson(json).pipeThrough(
				new JSONParserStream(["$.a"], {
					multi: true,
				}),
			);
			const chunks = await Array.fromAsync(stream);
			assert.deepStrictEqual(chunks, [
				{ value: 1, index: 0 },
				{ value: 2, index: 0 },
				{ value: 3, index: 0 },
			]);
		});
	}

	test("Multiple objects emitted for $", async () => {
		const json = "[1][2][3]";
		const stream = makeReadableStreamFromJson(json).pipeThrough(
			new JSONParserStream(["$"], {
				multi: true,
			}),
		);
		const chunks = await Array.fromAsync(stream);
		assert.deepStrictEqual(chunks, [
			{ value: [1], index: 0 },
			{ value: [2], index: 0 },
			{ value: [3], index: 0 },
		]);
	});
});
