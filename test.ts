import { JSONParseStream } from "./src/JSONParseStream.ts";

// An array of data
const json =
	'{"bar": [1,2,3,4,5], "foo": [{"key": 1}, {"key": 2}, {"key": 3}]}';
const readableStream = new ReadableStream({
	start(controller) {
		controller.enqueue(json);
		controller.close();
	},
});

const jsonPaths = ["$.foo[*]", "$.foo", "$.bar[*]"] as const;
const transformStream = new JSONParseStream(jsonPaths);

await readableStream.pipeThrough(transformStream).pipeTo(
	new WritableStream({
		write({ value, index }) {
			console.log("output", index, jsonPaths[index], value);
		},
	}),
);
