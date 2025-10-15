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
			return { type: "array" };
		}

		throw new Error(`Unexpected mode "${row.mode}"`);
	});
};

const isEqual = (x: QueryPath[number], y: QueryPath[number] | undefined) => {
	return (
		x.type === y?.type && (x.type === "array" || x.value === (y as any).value)
	);
};

export class JSONParseStream extends TransformStream<
	string,
	{
		value: any;
		index: number;
	}
> {
	_parser: JSONParserText;

	constructor(jsonPaths: Readonly<JSONPath[]>) {
		let parser: JSONParserText;

		const queryPaths = jsonPaths.map(jsonPathToQueryPath);

		super({
			start(controller) {
				parser = new JSONParserText((value, stack) => {
					const path = stackToQueryPath(stack);
					// console.log("value", value);
					// console.log("path", path);
					// console.log("stack", stack);

					let keep = false;
					for (const [i, queryPath] of queryPaths.entries()) {
						if (queryPath.every((x, j) => isEqual(x, path[j]))) {
							if (path.length === queryPath.length) {
								// Exact match of queryPath - emit record, and we don't need to keep it any more for this queryPath
								controller.enqueue({ value, index: i });
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
