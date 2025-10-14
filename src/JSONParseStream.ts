import JSONParserText, { type Stack } from "./JSONParserText.ts";

const stackToPath = (stack: Stack) => {
	return stack.slice(1).map((row) => {
		if (row.mode === "OBJECT") {
			return row.key;
		}
		if (row.mode === "ARRAY") {
			return "[*]";
		}

		throw new Error(`Unexpected mode ${row.mode}`);
	});
};

export class JSONParseStream extends TransformStream {
	constructor(queryPaths: string[][]) {
		let parser: JSONParserText;

		super({
			start(controller) {
				parser = new JSONParserText((value, stack) => {
					const path = stackToPath(stack);
					// console.log('value', value);
					// console.log('path', path);
					// console.log('stack', stack);

					let keep = false;
					for (const [i, queryPath] of queryPaths.entries()) {
						if (queryPath.every((x, j) => x === path[j])) {
							if (path.length === queryPath.length) {
								// Exact match of queryPath - emit record, and we don't need to keep it any more for this queryPath
								controller.enqueue([value, i]);
							} else {
								// Matches queryPath, but is nested deeper - still building the record to emit later
								keep = true;
							}
						} else {
							// Doesn't match queryPath, don't need to keep
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
				controller.terminate();
			},
		});
	}
}
