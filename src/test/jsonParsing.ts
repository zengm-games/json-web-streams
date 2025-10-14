import { glob, readFile } from "node:fs/promises";
import path from "node:path";
import { assert, describe, test } from "vitest";
import { JSONParseStream } from "../JSONParseStream.ts";

const parseWholeJson = async (json: string) => {
	const readableStream = new ReadableStream({
		start(controller) {
			controller.enqueue(json);
			controller.close();
		},
	});

	const stream = readableStream.pipeThrough(new JSONParseStream([[]]));

	// With queryPath [] (return root object) it should only emit one chunk, but with invalid JSON there could be more, and we need to read through it all to make sure we see any errors that appear
	let firstValue;
	for await (const [value] of stream) {
		if (firstValue === undefined) {
			firstValue = value;
		}
	}

	return firstValue;
};

describe("JSON parsing", async () => {
	for await (const entry of glob(
		path.join(__dirname, "jsonParsing/**/*.json"),
	)) {
		const filename = path.basename(entry);
		const shouldPass = filename.startsWith("pass");

		if (!filename.includes("fail4.")) {
			//continue;
		}

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
				if (!shouldPass) {
					throw new Error("Expected invalid JSON, but parsing succeeded");
				}
			}

			// If we expected a pass, confirm the parsed object matches JSON.parse
			if (shouldPass) {
				const object2 = JSON.parse(json);
				assert.deepStrictEqual(object, object2);
			}
		});
	}
});
