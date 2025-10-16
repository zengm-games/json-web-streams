import JSONParserText, { type Stack } from "./JSONParserText.ts";
import {
	jsonPathToQueryPath,
	type JSONPath,
	type QueryPath,
} from "./jsonPathToQueryPath.ts";

const stackToQueryPath = (stack: Stack): QueryPath => {
	return stack.slice(1).map((row) => {
		if (row.mode === "OBJECT" && row.key !== undefined) {
			// row.key is number | string, but when mode is OBJECT it is always a string, number is for ARRAY
			const value = row.key as string;
			return { type: "key", value };
		}
		if (row.mode === "ARRAY") {
			return { type: "wildcard" };
		}

		throw new Error(`Unexpected mode "${row.mode}"`);
	});
};

const isEqual = (x: QueryPath[number], y: QueryPath[number] | undefined) => {
	return (
		x.type === y?.type &&
		(x.type === "wildcard" || x.value === (y as any).value)
	);
};

// Convert string literal to number literal
type ToNumber<T extends string> = T extends `${infer N extends number}`
	? N
	: never;

// Convert an array like `[number, string]` to an indexed union where the values come from the input array and the indexes come from the position in the input array: `{ value: number, index: 0 } | { value: string, index: 1 }`
type IndexedUnion<T extends readonly unknown[]> = {
	[I in keyof T]: I extends `${number}`
		? {
				value: T[I];
				index: ToNumber<I & string>;
			}
		: never;
}[number];

export class JSONParseStream<
	T extends readonly unknown[] = unknown[],
> extends TransformStream<string, IndexedUnion<T>> {
	_parser: JSONParserText;

	constructor(
		jsonPaths: Readonly<[...{ [K in keyof T]: JSONPath }]>,
		options?: {
			multi?: boolean;
		},
	) {
		let parser: JSONParserText;
		const queryPaths = jsonPaths.map(jsonPathToQueryPath);
		const multi = options?.multi ?? false;

		super({
			start(controller) {
				parser = new JSONParserText({
					multi,
					onValue: (value, stack) => {
						const path = stackToQueryPath(stack);
						// console.log("value", value);
						// console.log("path", path);
						// console.log("stack", stack);

						let keep = false;
						for (const [i, queryPath] of queryPaths.entries()) {
							if (queryPath.every((x, j) => isEqual(x, path[j]))) {
								if (path.length === queryPath.length) {
									// Exact match of queryPath - emit record, and we don't need to keep it any more for this queryPath
									// structuredClone is needed in case this object is emitted elsewhere as part of another object - they should not be linked as parent/child, that would be confusing
									controller.enqueue({
										value: structuredClone(value),
										index: i,
									} as any);
								} else {
									// Matches queryPath, but is nested deeper - still building the record to emit later
									keep = true;
								}
							} else {
								// Doesn't match queryPath, don't need to keep, but only worry about arrays/objects. Or delete this branch and it will overwrite these primitive values too.
								const type = typeof value;
								if (
									type === "string" ||
									type === "number" ||
									type === "boolean" ||
									value === null
								) {
									keep = true;
								}
							}
						}
						// console.log("Keep?", keep, "\n");

						if (!keep) {
							// Now that we have emitted the object we want, we no longer need to keep track of all the values on the stack. This avoids keeping the whole JSON object in memory.
							for (const row of parser.stack) {
								row.value = undefined;
							}

							// Also, when processing an array/object, this.value will contain the current state of the array/object. So we should delete the value there too, but leave the array/object so it can still be used by the parser
							if (
								typeof parser.value === "object" &&
								parser.value !== null &&
								parser.key !== undefined
							) {
								delete parser.value[parser.key];
							}
						}
					},
				});
			},

			transform(chunk) {
				parser.write(chunk);
			},

			flush(controller) {
				parser.checkEnd();
				controller.terminate();
			},
		});

		// We know parser is defined because `start` runs synchronously
		this._parser = parser!;
	}
}
