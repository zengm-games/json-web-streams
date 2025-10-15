import { test } from "vitest";

/*import { assert, test } from "vitest";
import { JSONParseStream } from "../JSONParseStream.ts";
import { makeReadableStreamFromJson } from "./utils.ts";*/

const separators = ["", "\n", "\r\n", " ", " \n ", "␞"];
for (const separator of separators) {
	test.skip(`Multiple JSON objects with ${JSON.stringify(separator)} in between`, async () => {
		/*const objects = [{ a: 1 }, { a: 2 }, { foo: "bar" }, { a: 3 }];
		const json = objects
			.map((object) => JSON.stringify(object))
			.join(separator);
		const stream = makeReadableStreamFromJson(json).pipeThrough(
			new JSONParseStream(["$.a"], {
				multi: true,
			}),
		);
		const chunks = await Array.fromAsync(stream);
		assert.deepStrictEqual(chunks, [
			{ value: 1, index: 0, multiIndex: 0 },
			{ value: 2, index: 0, multiIndex: 1 },
			{ value: 3, index: 0, multiIndex: 2 },
		]);*/
	});
}
