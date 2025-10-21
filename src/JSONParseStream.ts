import type { StandardSchemaV1 } from "@standard-schema/spec";
import { JSONParseStreamRaw, type Stack } from "./JSONParseStreamRaw.ts";
import {
	jsonPathToPathArray,
	type JSONPath,
	type PathArray,
} from "./jsonPathToPathArray.ts";

/*const stackToPathComponent = (
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

const stackToPathArray = (stack: Stack): PathArray => {
	return stack.slice(1).map(stackToPathComponent);
};*/

// x - from JSONPath query
// y - from parsing JSON data
const isEqual = (x: PathArray[number], y: Stack[number] | undefined) => {
	if (!y) {
		return false;
	}

	if (x.type === "wildcard") {
		if (y.mode === "ARRAY") {
			// We're looking for wildcard and found array - match!
			return true;
		} else if (y.mode === "OBJECT") {
			// Object values are fine for wildcard too
			return true;
		}
	} else {
		// x.type is key, so we need to match that key exacty in the stack
		if (y.mode === "OBJECT" && x.value === y.key) {
			return true;
		}
	}

	return false;
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
	_parser: JSONParseStreamRaw;

	constructor(
		jsonPaths: T,
		options?: {
			multi?: boolean;
		},
	) {
		let parser: JSONParseStreamRaw;
		const multi = options?.multi ?? false;

		let minPathArrayLength = Infinity;
		let maxPathArrayLength = -Infinity;

		type JSONPathInfo = {
			matches: "yes" | "noBeforeEnd" | "noAtEnd" | "unknown"; // undefined means unknown if it matches or not, stack length is not long enough
			path: JSONPath;
			pathArray: PathArray;
			schema: StandardSchemaV1 | undefined;
			wildcardIndexes: number[] | undefined;
		};

		const jsonPathInfos: JSONPathInfo[] = jsonPaths.map((row) => {
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

			// Empty query starts out matching, everything else requires something in the stack
			const matches = pathArray.length === 0 ? "yes" : "unknown";

			if (pathArray.length > maxPathArrayLength) {
				maxPathArrayLength = pathArray.length;
			}
			if (pathArray.length < minPathArrayLength) {
				minPathArrayLength = pathArray.length;
			}

			return {
				matches,
				path,
				pathArray,
				schema,
				wildcardIndexes,
			};
		});

		const jsonPathInfosThatMatch = new Set<JSONPathInfo>(
			jsonPathInfos.filter((info) => info.matches === "yes"),
		);

		const updateMatches = (type: "key" | "push") => {
			const parserStack = parser.stack;
			for (const info of jsonPathInfos) {
				const pathArray = info.pathArray;
				// Need to do this here rather than in onPush because the value matters too
				if (
					((info.matches === "unknown" && type === "push") ||
						(info.matches !== "unknown" &&
							info.matches !== "noBeforeEnd" &&
							type === "key")) &&
					parserStack.length === pathArray.length
				) {
					//console.log('check matches', type, info.path, [...parser.stack, { key: parser.key, mode: parser.mode, value: parser.value }])
					// We have just added enough to the stack to compare with pathArray, so let's do it and save the result
					let pathMatches: (typeof info)["matches"] = "yes";
					for (let j = 0; j < pathArray.length; j++) {
						let stackComponent = parser.stack[j + 1];
						if (!stackComponent) {
							if (type === "key") {
								// When setting the key, it's in the current state of the parser, not in the stack
								stackComponent = parser;
							} else {
								// Can only match if the current (and final) pathArray component is a wildcard, because that means we're currently in an array/object so anything inside that will match
								if (pathArray[j]!.type === "wildcard") {
									pathMatches = "yes";
									break;
								}
							}
						}
						if (!isEqual(pathArray[j]!, stackComponent)) {
							if (j < pathArray.length - 1) {
								// Match failed before the last component of pathArray, meaning that it will take a "push" (after a pop) to make this match, and more "key" ones we receive cannot make it match
								pathMatches = "noBeforeEnd";
							} else {
								pathMatches = "noAtEnd";
							}
							break;
						}
					}
					info.matches = pathMatches;
					if (pathMatches === "yes") {
						jsonPathInfosThatMatch.add(info);
					} else {
						jsonPathInfosThatMatch.delete(info);
					}
					//console.log('set matches', type, info.path, info.matches)
				}
			}
		};

		super({
			start(controller) {
				parser = new JSONParseStreamRaw({
					multi,

					// When we receive a new object key, that could make a path match if that now matches the last component of pathArray
					onKey: (stackLength) => {
						if (
							stackLength <= maxPathArrayLength &&
							stackLength >= minPathArrayLength
						) {
							//console.log('onKey', [...parser.stack, { key: parser.key, mode: parser.mode, value: parser.value }]);
							updateMatches("key");
						}
					},

					// Possibly we have removed enough from the stack that we can now match if something is pushed to stack
					onPop: (stackLength) => {
						if (
							stackLength < maxPathArrayLength &&
							stackLength >= minPathArrayLength - 1
						) {
							//console.log('onPop', [...parser.stack, { key: parser.key, mode: parser.mode, value: parser.value }]);
							for (const info of jsonPathInfos) {
								if (
									info.matches !== "unknown" &&
									stackLength < info.pathArray.length
								) {
									info.matches = "unknown";
									jsonPathInfosThatMatch.delete(info);
									//console.log('reset matches', info.path);
								}
							}
						}
					},

					// Possibly we can now match
					onPush: (stackLength) => {
						if (
							stackLength <= maxPathArrayLength &&
							stackLength >= minPathArrayLength
						) {
							//console.log('onPush', [...parser.stack, { key: parser.key, mode: parser.mode, value: parser.value }]);
							updateMatches("push");
						}
					},
					onValue: (value) => {
						//console.log('onValue', value)
						const {
							key: parserKey,
							stack: parserStack,
							value: parserValue,
						} = parser;

						// console.log("value", value);
						// console.log("path", path);
						// console.log("stack", stack);

						let keep = false;
						for (const {
							path,
							pathArray,
							schema,
							wildcardIndexes,
						} of jsonPathInfosThatMatch) {
							if (parserStack.length === pathArray.length) {
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
									for (const index of wildcardIndexes) {
										const stackComponent = parserStack[index + 1] ?? parser;
										if (
											stackComponent.mode === "OBJECT" &&
											stackComponent.key !== undefined
										) {
											if (!wildcardKeys) {
												wildcardKeys = [];
											}
											wildcardKeys.push(stackComponent.key as string);
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
						}
						// console.log("Keep?", keep, "\n");

						if (!keep) {
							// Doesn't match pathArray, don't need to keep, but only worry about arrays/objects. Or delete this branch and it will overwrite these primitive values too.
							const type = typeof value;
							if (
								!(
									type === "string" ||
									type === "number" ||
									type === "boolean" ||
									value === null
								)
							) {
								// Now that we have emitted the object we want, we no longer need to keep track of all the values on the stack. This avoids keeping the whole JSON object in memory.
								for (const row of parserStack) {
									row.value = undefined;
								}

								// Also, when processing an array/object, this.value will contain the current state of the array/object. So we should delete the value there too, but leave the array/object so it can still be used by the parser
								if (
									typeof parserValue === "object" &&
									parserValue !== null &&
									parserKey !== undefined
								) {
									parserValue[parserKey] = undefined;
								}
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
