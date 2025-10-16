import * as z from "zod";
import { createJSONParserStream } from "./src/createJSONParserStream.ts";
import { makeReadableStreamFromJson } from "./src/test/utils.ts";

const Player = z.object({
	username: z.string(),
	xp: z.number(),
});
const x = { username: "billie", xp: 100 };
const p = Player.parse(x);
console.log(p);
x.xp = 110;
console.log(p);

// An array of data
const json =
	'{"bar": [1,2,3,4,5], "foo": [{"key": 1}, {"key": 2}, {"key": 3}]}';

const jsonParserStream = createJSONParserStream({
	"$.foo[*]": z.object({
		key: z.number(),
	}),
	"$.bar[*]": z.number(),
});
await makeReadableStreamFromJson(json)
	.pipeThrough(jsonParserStream)
	.pipeTo(
		new WritableStream({
			write(x) {
				console.log("output", x);
			},
		}),
	);

//const jsonPaths = ["$.foo[*]", "$.bar[*]"] as const;
