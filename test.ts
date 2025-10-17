import * as z from "zod";
import { JSONParseStream } from "./src/JSONParseStream.ts";
import { makeReadableStreamFromJson } from "./src/test/utils.ts";

// An array of data
const json =
	'{"bar": [1,2,3,4,5], "foo": [{"key": 1}, {"key": 2}, {"key": 3}]}';

await makeReadableStreamFromJson(json)
	.pipeThrough(
		new JSONParseStream([
			{
				path: "$.foo[*]",
				schema: z.object({
					key: z.number(),
				}),
			},
			{
				path: "$.bar[*]",
				schema: z.number(),
			},
		]),
	)
	.pipeTo(
		new WritableStream({
			write(x) {
				console.log("output", x);
			},
		}),
	);

await makeReadableStreamFromJson(json)
	.pipeThrough(new JSONParseStream(["$.foo[*]", "$.bar[*]"]))
	.pipeTo(
		new WritableStream({
			write(x) {
				console.log("output", x);
			},
		}),
	);
//const jsonPaths = ["$.foo[*]", "$.bar[*]"] as const;
await new ReadableStream({
	start(controller) {
		controller.enqueue('{ "foo": [1, 2], "bar": ["a", "b", "c"] }');
		controller.close();
	},
})
	.pipeThrough(new JSONParseStream(["$[*][*]"]))
	.pipeTo(
		new WritableStream({
			write(record) {
				console.log(record);
				if (record.wildcardKeys[0] === "foo") {
					// 1, 2
				} else {
					// a, b, c
				}
			},
		}),
	);
