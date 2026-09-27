import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { test } from "vitest";
import { JSONParseStream } from "./JSONParseStream.ts";
import { JSONParseStreamRaw } from "./JSONParseStreamRaw.ts";
import type { JSONPath } from "./jsonPathToPathArray.ts";

// This data is an export of BBGM from a new random players league with all default settings, simmed for 1 season
const filename = path.join(__dirname, "test/benchmark.json");

const CUMULATIVE_OBJECTS = new Set([
	"gameAttributes",
	"meta",
	"startingSeason",
	"version",
]);

test("parsing benchmark.json", async ({ bench }) => {
	await bench.compare(
		// This is similar to what zengm used to do, so it would be nice to be able to match this performance with JSONParseStream
		bench("JSONParseStreamRaw", async () => {
			let parser: JSONParseStreamRaw;

			const transformStream = new TransformStream({
				start(controller) {
					parser = new JSONParseStreamRaw({
						multi: false,
						onValue: (value) => {
							// Code below is basically just copied from zengm, to mirror that real use case
							let objectType;
							if (parser.stack.length > 1) {
								objectType = parser.stack[1]!.key;
							} else {
								objectType = parser.key;
							}

							const emitAtStackLength = CUMULATIVE_OBJECTS.has(
								objectType as any,
							)
								? 1
								: 2;

							if (parser.stack.length !== emitAtStackLength) {
								return;
							}

							controller.enqueue({
								key: objectType,
								value,
							});

							for (const row of parser.stack) {
								row.value = undefined;
							}
							if (typeof parser.value === "object" && parser.value !== null) {
								delete parser.value[parser.key!];
							}
						},
					});
				},

				transform(chunk) {
					parser.write(chunk);
				},
			});

			await Readable.toWeb(fs.createReadStream(filename, "utf8"))
				// @ts-expect-error
				.pipeThrough(transformStream)
				.pipeTo(new WritableStream());
		}),

		// Simpler case than with JSONStreamRaw, now this is even faster than the JSONStreamRaw version
		bench("JSONParseStream - one JSONPath", async () => {
			const transformStream = new JSONParseStream(["$.players[*]"]);

			await Readable.toWeb(fs.createReadStream(filename, "utf8"))
				// @ts-expect-error
				.pipeThrough(transformStream)
				.pipeTo(new WritableStream());
		}),

		// Equivalent functionality as the JSONStreamRaw example, now this has similar performance as the "one JSONPath" case
		bench("JSONParseStream - many JSONPaths", async () => {
			const allKeys = [
				"gameAttributes",
				"meta",
				"startingSeason",
				"version",
				"allStars",
				"awards",
				"draftLotteryResults",
				"draftPicks",
				"events",
				"games",
				"headToHeads",
				"messages",
				"negotiations",
				"playerFeats",
				"players",
				"playoffSeries",
				"releasedPlayers",
				"savedTrades",
				"savedTradingBlock",
				"schedule",
				"scheduledEvents",
				"seasonLeaders",
				"teamSeasons",
				"teamStats",
				"teams",
				"trade",
			];
			const jsonPaths: JSONPath[] = allKeys.map(
				(key) => `$.${key}${CUMULATIVE_OBJECTS.has(key) ? "" : "[*]"}` as const,
			);
			const transformStream = new JSONParseStream(jsonPaths);

			await Readable.toWeb(fs.createReadStream(filename, "utf8"))
				// @ts-expect-error
				.pipeThrough(transformStream)
				.pipeTo(new WritableStream());
		}),

		{
			iterations: 20,
			warmupIterations: 10,
		},
	);
});
