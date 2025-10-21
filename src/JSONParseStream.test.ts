import { glob, readFile } from "node:fs/promises";
import path from "node:path";
import { assert, describe, test } from "vitest";
import { JSONParseStream } from "./JSONParseStream.ts";
import type { JSONPath } from "./jsonPathToPathArray.ts";
import { makeReadableStreamFromJson } from "./test/utils.ts";

describe("Parsing", async () => {
	const parseWholeJson = async (json: string) => {
		// With JSONPath $ (return root object) it should only emit one chunk, but with invalid JSON there could be more text, and we need to read through it all to make sure we see any errors that appear
		let firstValue: any;

		await makeReadableStreamFromJson(json)
			.pipeThrough(new JSONParseStream(["$"]))
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
	const path = "$[*].foo[*]";

	test("Streams values", async () => {
		const stream = makeReadableStreamFromJson(json).pipeThrough(
			new JSONParseStream([path]),
		);
		const chunks = await Array.fromAsync(stream);
		assert.deepStrictEqual(chunks, [
			{ value: 1, key: path },
			{ value: 2, key: path },
		]);
	});

	test("Streams values from two paths", async () => {
		const jsonPaths = ["$[*].foo[*]", "$[*].bar[*]"] as const;

		const stream = makeReadableStreamFromJson(json).pipeThrough(
			new JSONParseStream(jsonPaths),
		);
		const chunks = await Array.fromAsync(stream);
		assert.deepStrictEqual(chunks, [
			{ value: 1, key: jsonPaths[0] },
			{ value: 2, key: jsonPaths[0] },
			{ value: { x: 3 }, key: jsonPaths[1] },
			{ value: { x: 4 }, key: jsonPaths[1] },
		]);
	});

	test("Streams values from two paths, where one is nested in the other", async () => {
		const jsonPaths = ["$[*].bar[*]", "$[*].bar[*].x"] as const;

		const stream = makeReadableStreamFromJson(json).pipeThrough(
			new JSONParseStream(jsonPaths),
		);
		const chunks = await Array.fromAsync(stream);
		assert.deepStrictEqual(chunks, [
			{ value: 3, key: jsonPaths[1] },
			{ value: { x: 3 }, key: jsonPaths[0] },
			{ value: 4, key: jsonPaths[1] },
			{ value: { x: 4 }, key: jsonPaths[0] },
		]);
	});

	test("Nested objects reference the same shared arrays/objects", async () => {
		const json = JSON.stringify({ foo: { bar: 1 } });
		const stream = makeReadableStreamFromJson(json).pipeThrough(
			new JSONParseStream(["$.foo", "$"]),
		);
		const chunks: any[] = await Array.fromAsync(stream, (row) => row.value);
		assert.deepStrictEqual(chunks, [{ bar: 1 }, { foo: { bar: 1 } }]);
		chunks[0].bar = 2;
		assert.deepStrictEqual(chunks, [{ bar: 2 }, { foo: { bar: 2 } }]);
	});

	test("Streams values from non-overlapping paths at different levels, without clobbering each other", async () => {
		const jsonPaths = ["$.foo", "$.bar[*]"] as const;
		const stream = makeReadableStreamFromJson(
			'{"bar": [1,2,3], "foo": [{"key": 1}]}',
		).pipeThrough(new JSONParseStream(jsonPaths));

		const chunks = await Array.fromAsync(stream);
		const foo = chunks
			.filter((chunk) => chunk.key === jsonPaths[0])
			.map((chunk) => chunk.value);
		assert.deepStrictEqual(foo, [[{ key: 1 }]]);
	});

	test("Confirm that we're not just reading everything into memory all the time", async () => {
		let maxStackSize = 0;

		// Monkey patch to track the size of the stack
		const monkeyPatch = (stream: JSONParseStream<any>) => {
			const prevOnValue = stream._parser.onValue;
			stream._parser.onValue = (...params) => {
				// This is not a very accurate way to get stack size, but works enough for these purposes.
				const stackSize = JSON.stringify(stream._parser.stack).length;
				maxStackSize = Math.max(maxStackSize, stackSize);
				prevOnValue(...params);
			};
			return stream;
		};

		// This stream emits the whole object ($) so it has to read the whole object into memory at some point
		await makeReadableStreamFromJson(json)
			.pipeThrough(monkeyPatch(new JSONParseStream(["$"])))
			.pipeTo(new WritableStream());
		const maxStackSize0 = maxStackSize;

		// This stream only emits part of the object, so it should use less memory than the previous stream
		maxStackSize = 0;
		await makeReadableStreamFromJson(json)
			.pipeThrough(monkeyPatch(new JSONParseStream(["$[*].bar[*]"])))
			.pipeTo(new WritableStream());
		const maxStackSize1 = maxStackSize;

		// The first stream should use more memory than the second
		assert.isAbove(maxStackSize0, maxStackSize1);
	});

	test("[*] works for objects too, not just arrays", async () => {
		const cases: {
			path: JSONPath;
			data: unknown;
		}[] = [
			{
				path: "$[*]",
				data: { foo: "f", bar: "b" },
			},
			{
				path: "$.x[*]",
				data: { x: { foo: "f", bar: "b" } },
			},
		];

		for (const { path, data } of cases) {
			const json = JSON.stringify(data);
			const stream = makeReadableStreamFromJson(json).pipeThrough(
				new JSONParseStream([path]),
			);
			const values = await Array.fromAsync(stream);
			assert.deepStrictEqual(values, [
				{
					key: path,
					value: "f",
					wildcardKeys: ["foo"],
				},
				{
					key: path,
					value: "b",
					wildcardKeys: ["bar"],
				},
			]);
		}
	});

	test("[*][*] for object and array", async () => {
		// These are all equivalent
		const jsonPaths = [
			"$.*.*",
			"$[*].*",
			"$.*[*]",
			"$[*][*]",
			"$[*,*]",
		] as const;

		const data = {
			foo: [1, 2],
			bar: [3, 4],
		};
		const json = JSON.stringify(data);

		for (const path of jsonPaths) {
			const stream = makeReadableStreamFromJson(json).pipeThrough(
				new JSONParseStream([path]),
			);
			const values = await Array.fromAsync(stream);
			assert.deepStrictEqual(
				values,
				[
					{
						key: path,
						value: 1,
						wildcardKeys: ["foo"],
					},
					{
						key: path,
						value: 2,
						wildcardKeys: ["foo"],
					},
					{
						key: path,
						value: 3,
						wildcardKeys: ["bar"],
					},
					{
						key: path,
						value: 4,
						wildcardKeys: ["bar"],
					},
				],
				path,
			);
		}
	});

	test("key property propagated from input to output", async () => {
		const stream = makeReadableStreamFromJson(json).pipeThrough(
			new JSONParseStream([
				{
					path,
					key: "foo",
				},
			]),
		);
		const chunks = await Array.fromAsync(stream);
		assert.deepStrictEqual(chunks, [
			{ key: "foo", value: 1 },
			{ key: "foo", value: 2 },
		]);
	});
});

describe("Multi option", () => {
	const separators = ["", "\n", "\r\n", " ", " \n ", "␞"];
	for (const separator of separators) {
		test(`Multiple JSON objects with ${JSON.stringify(separator)} in between`, async () => {
			const objects = [{ a: 1 }, { a: 2 }, { foo: "bar" }, { a: 3 }];
			const json = objects
				.map((object) => JSON.stringify(object))
				.join(separator);
			const path = "$.a";
			const stream = makeReadableStreamFromJson(json).pipeThrough(
				new JSONParseStream([path], {
					multi: true,
				}),
			);
			const chunks = await Array.fromAsync(stream);
			assert.deepStrictEqual(chunks, [
				{ value: 1, key: path },
				{ value: 2, key: path },
				{ value: 3, key: path },
			]);
		});

		test(`Multiple JSON objects with ${JSON.stringify(separator)} in between, before, and after`, async () => {
			const objects = [{ a: 1 }, { a: 2 }, { foo: "bar" }, { a: 3 }];
			const json =
				separator +
				objects.map((object) => JSON.stringify(object)).join(separator) +
				separator;
			const path = "$.a";
			const stream = makeReadableStreamFromJson(json).pipeThrough(
				new JSONParseStream([path], {
					multi: true,
				}),
			);
			const chunks = await Array.fromAsync(stream);
			assert.deepStrictEqual(chunks, [
				{ value: 1, key: path },
				{ value: 2, key: path },
				{ value: 3, key: path },
			]);
		});
	}

	test("Multiple objects emitted for $", async () => {
		const json = "[1][2][3]";
		const path = "$";
		const stream = makeReadableStreamFromJson(json).pipeThrough(
			new JSONParseStream([path], {
				multi: true,
			}),
		);
		const chunks = await Array.fromAsync(stream);
		assert.deepStrictEqual(chunks, [
			{ value: [1], key: path },
			{ value: [2], key: path },
			{ value: [3], key: path },
		]);
	});
});
