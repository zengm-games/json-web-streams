import type { StandardSchemaV1 } from "@standard-schema/spec";
import JSONParserText, { type Stack } from "./JSONParserText.ts";
import {
	jsonPathToPathArray,
	type JSONPath,
	type PathArray,
} from "./jsonPathToPathArray.ts";

const stackToPathComponent = (
	stackComponent: Stack[number],
): PathArray[number] => {
	if (stackComponent.mode === "OBJECT" && stackComponent.key !== undefined) {
		// stackComponent.key is number | string, but when mode is OBJECT it is always a string, number is for ARRAY
		const value = stackComponent.key as string;
		return { type: "key", value };
	}
	if (stackComponent.mode === "ARRAY") {
		return { type: "wildcard" };
	}

	throw new Error(`Unexpected mode "${stackComponent.mode}"`);
};

/*const stackToPathArray = (stack: Stack): PathArray => {
	return stack.slice(1).map(stackToPathComponent);
};*/

// x - from JSONPath query
// y - from parsing JSON data
const isEqual = (x: PathArray[number], y: PathArray[number] | undefined) => {
	if (!y) {
		return false;
	}

	if (x.type === y?.type) {
		if (x.type === "wildcard") {
			// Both are wildcard, meaning we're looking for wildcard and found array
			return true;
		}

		// Both must be key, in which case they are equal if the value of the key is the same
		if (x.value === (y as any).value) {
			return true;
		}

		return false;
	}

	// One is wildcard and the other is key. This could still be a match if the wildcard is being used to get all the values of an object, rather than array. In this case, wildcard would be on x, since x is from the supplied JSONPath query.
	return x.type === "wildcard";
};

type JSONParseStreamOutput<T> = T extends {
	path: infer P extends JSONPath;
	schema: infer S extends StandardSchemaV1;
}
	? {
			path: P;
			value: StandardSchemaV1.InferOutput<S>;
			wildcardKeys?: string[];
		}
	: T extends JSONPath
		? { path: T; value: unknown; wildcardKeys?: string[] }
		: never;

export class JSONParseStream<
	T extends readonly (
		| JSONPath
		| { path: JSONPath; schema: StandardSchemaV1 }
	)[],
> extends TransformStream<string, JSONParseStreamOutput<T[number]>> {
	_parser: JSONParserText;

	constructor(
		jsonPaths: T,
		options?: {
			multi?: boolean;
		},
	) {
		let parser: JSONParserText;
		const multi = options?.multi ?? false;

		const jsonPathInfos: {
			path: JSONPath;
			pathArray: PathArray;
			schema: StandardSchemaV1 | undefined;
			wildcardIndexes: number[] | undefined;
		}[] = jsonPaths.map((row) => {
			let path;
			let schema;
			if (typeof row === "string") {
				path = row;
			} else {
				path = row.path;
				schema = row.schema;
			}

			const pathArray = jsonPathToPathArray(path);

			let wildcardIndexes: number[] | undefined;
			for (const [i, component] of pathArray.entries()) {
				if (component.type === "wildcard") {
					if (wildcardIndexes === undefined) {
						wildcardIndexes = [];
					}
					wildcardIndexes.push(i);
				}
			}

			return {
				path,
				pathArray,
				schema,
				wildcardIndexes,
			};
		});

		super({
			start(controller) {
				parser = new JSONParserText({
					multi,
					onValue: (value) => {
						const stackPathArray = parser.stack
							.slice(1)
							.map((x) => stackToPathComponent(x));

						// Uses current parser values (value, key, mode) - faster than combining arrays with destructuring or something
						// length 0 check is because the first entry is always ignored, but this might be the first entry
						if (parser.stack.length > 0) {
							stackPathArray.push(
								stackToPathComponent({
									value: parser.value,
									key: parser.key,
									mode: parser.mode,
								}),
							);
						}
						// console.log("value", value);
						// console.log("path", path);
						// console.log("stack", stack);

						let keep = false;
						for (const {
							path,
							pathArray,
							schema,
							wildcardIndexes,
						} of jsonPathInfos) {
							if (pathArray.every((x, j) => isEqual(x, stackPathArray[j]))) {
								if (stackPathArray.length === pathArray.length) {
									// Exact match of pathArray - emit record, and we don't need to keep it any more for this pathArray

									let valueToEmit;
									if (schema) {
										const result = schema["~standard"].validate(value);
										if (result instanceof Promise) {
											throw new TypeError(
												"Schema validation must be synchronous",
											);
										}

										// if the `issues` field exists, the validation failed
										if (result.issues) {
											throw new Error(JSON.stringify(result.issues, null, 2));
										}

										valueToEmit = result.value;
									} else {
										valueToEmit = value;
									}

									let wildcardKeys: string[] | undefined;
									if (wildcardIndexes) {
										if (wildcardIndexes) {
											for (const index of wildcardIndexes) {
												const pathComponent = stackPathArray[index];
												if (pathComponent?.type === "key") {
													if (!wildcardKeys) {
														wildcardKeys = [];
													}
													wildcardKeys.push(pathComponent.value);
												}
											}
										}
									}

									// Casting to any is needed because jsonPathInfos is broader than it should be - it should be constrained so path is one of the input paths, and valueToEmit is the correct type if a schema is present
									if (wildcardKeys) {
										controller.enqueue({
											path: path,
											value: valueToEmit,
											wildcardKeys,
										} as any);
									} else {
										controller.enqueue({
											path: path,
											value: valueToEmit,
										} as any);
									}
								} else {
									// Matches pathArray, but is nested deeper - still building the record to emit later
									keep = true;
								}
							} else {
								// Doesn't match pathArray, don't need to keep, but only worry about arrays/objects. Or delete this branch and it will overwrite these primitive values too.
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
