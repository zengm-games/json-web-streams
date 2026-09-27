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

	for (const json of ["0", "-0", " 0 ", "-1"]) {
		test(`Lonely number ${JSON.stringify(json)}`, async () => {
			assert.strictEqual(await parseWholeJson(json), JSON.parse(json));
		});
	}

	const numbers = [
		"0",
		"-0",
		"12",
		"-12",
		"0.5",
		"-0.5",
		"10.25",
		"1e5",
		"1E5",
		"1e+5",
		"1e-5",
		"0e0",
		"1.5e10",
		"-1.5E-10",
		"123456789012345678901234567890",
		"1e400",
		"-1e400",
		"1e-400",
	];
	for (const number of numbers) {
		for (const json of [number, `[${number}]`, `{"a":${number}}`]) {
			test(`Number ${json}`, async () => {
				assert.deepStrictEqual(await parseWholeJson(json), JSON.parse(json));
			});

			test(`Number ${json}, one character per chunk`, async () => {
				const stream = new ReadableStream({
					start(controller) {
						for (const char of json) {
							controller.enqueue(char);
						}
						controller.close();
					},
				}).pipeThrough(new JSONParseStream(["$"]));
				const chunks = await Array.fromAsync(stream);
				assert.deepStrictEqual(chunks, [{ key: "$", value: JSON.parse(json) }]);
			});
		}
	}

	// Error position should point at the first character that makes the number invalid
	const invalidNumbers = {
		"[1.2.3]": 4,
		"[1.]": 3,
		"[1.e5]": 3,
		"[-]": 2,
		"[-a]": 2,
		"[1e]": 3,
		"[1e+]": 4,
		"[1e5e5]": 4,
		"[1+2]": 2,
		"[1-2]": 4, // 1 and -2 are both valid numbers, so this is a parser error at the end of the second number

		"[01]": 1,
		"[.5]": 1,
	};
	for (const [json, position] of Object.entries(invalidNumbers)) {
		test(`Invalid number ${json} errors at position ${position}`, async () => {
			let error;
			try {
				await parseWholeJson(json);
			} catch (error2) {
				error = error2;
			}
			assert.instanceOf(error, Error);
			assert.include((error as Error).message, `at position ${position} `);
		});
	}

	test("Lonely minus sign is an error", async () => {
		let error;
		try {
			await parseWholeJson("-");
		} catch (error2) {
			error = error2;
		}
		assert.instanceOf(error, Error);
	});

	for (const escape of [
		"\\u12zz",
		"\\u0x12",
		"\\u-123",
		"\\u+123",
		"\\u 123",
	]) {
		test(`Invalid unicode escape ${JSON.stringify(escape)} is an error`, async () => {
			let error;
			try {
				await parseWholeJson(`["${escape}"]`);
			} catch (error2) {
				error = error2;
			}
			assert.instanceOf(error, Error);
		});
	}

	test("Unicode escapes are case insensitive", async () => {
		const json = '["\\u00aB\\u00Cd"]';
		assert.deepStrictEqual(await parseWholeJson(json), JSON.parse(json));
	});

	for (const json of [
		'["\\uD834\\uDD1E"]', // Valid surrogate pair
		'["\\uD800abc"]', // Lone high surrogate followed by text
		'["\\uD800\\n"]', // Lone high surrogate followed by another escape
		'["\\uD800"]', // Lone high surrogate at end of string
		'["\\uD800", "\\uDC00"]', // Lone surrogates in separate strings
		'["\\uD800\\uD800\\uDC00"]', // Two high surrogates then a low surrogate
		'["\\uDC00\\uD800"]', // Surrogates in reverse order
		'{"\\uD800": "\\uDC00"}', // Lone surrogates in key and value
	]) {
		test(`Surrogates ${json}`, async () => {
			assert.deepStrictEqual(await parseWholeJson(json), JSON.parse(json));
		});
	}

	test("Unterminated string reports unexpected end of input", async () => {
		let error;
		try {
			await parseWholeJson('"abc');
		} catch (error2) {
			error = error2;
		}
		assert.instanceOf(error, Error);
		assert.include((error as Error).message, "Unexpected end of input");
	});
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
		const monkeyPatch = (stream: JSONParseStream<any, any>) => {
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
		const jsonPaths = ["$.*.*", "$[*].*", "$.*[*]", "$[*][*]"] as const;

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

	test("Number at the end of input is emitted", async () => {
		const json = "{} 0";
		const path = "$";
		const stream = makeReadableStreamFromJson(json).pipeThrough(
			new JSONParseStream([path], {
				multi: true,
			}),
		);
		const chunks = await Array.fromAsync(stream);
		assert.deepStrictEqual(chunks, [
			{ value: {}, key: path },
			{ value: 0, key: path },
		]);
	});

	for (const truncated of ["tru", "fals", "nul", '"abc', '"abc\\', '"\\u12']) {
		test(`Truncated value ${JSON.stringify(truncated)} at the end of input is an error`, async () => {
			const stream = makeReadableStreamFromJson(`{} ${truncated}`).pipeThrough(
				new JSONParseStream(["$"], {
					multi: true,
				}),
			);
			let error;
			try {
				await Array.fromAsync(stream);
			} catch (error2) {
				error = error2;
			}
			assert.instanceOf(error, Error);
			assert.include((error as Error).message, "Unexpected end of input");
		});
	}

	test("Lonely minus sign at the end of input is an error", async () => {
		const stream = makeReadableStreamFromJson("{} -").pipeThrough(
			new JSONParseStream(["$"], {
				multi: true,
			}),
		);
		let error;
		try {
			await Array.fromAsync(stream);
		} catch (error2) {
			error = error2;
		}
		assert.instanceOf(error, Error);
	});
});
