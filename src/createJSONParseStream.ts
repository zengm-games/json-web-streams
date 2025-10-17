import type { StandardSchemaV1 } from "@standard-schema/spec";
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

// x - from JSONPath query
// y - from parsing JSON data
const isEqual = (x: QueryPath[number], y: QueryPath[number] | undefined) => {
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

export function createJSONParseStream<
	T extends readonly (
		| JSONPath
		| { path: JSONPath; schema: StandardSchemaV1 }
	)[],
>(
	jsonPaths: T,
	options?: {
		multi?: boolean;
	},
): JSONParseStream<T> {
	return new JSONParseStream(jsonPaths, options);
}

// Extract jsonPath and value type from each tuple element
type JSONParseStreamOutputItem<T> = T extends {
	path: infer P extends JSONPath;
	schema: infer S extends StandardSchemaV1;
}
	? {
			jsonPath: P;
			value: StandardSchemaV1.InferOutput<S>;
			wildcardKeys?: string[];
		}
	: T extends JSONPath
		? { jsonPath: T; value: unknown; wildcardKeys?: string[] }
		: never;

class JSONParseStream<
	T extends readonly (
		| JSONPath
		| { path: JSONPath; schema: StandardSchemaV1 }
	)[],
> extends TransformStream<string, JSONParseStreamOutputItem<T[number]>> {
	_parser: JSONParserText;

	constructor(
		jsonPaths: T,
		options?: {
			multi?: boolean;
		},
	) {
		let parser: JSONParserText;
		const multi = options?.multi ?? false;

		const queryInfos = new Map<
			JSONPath,
			{
				jsonPath: JSONPath;
				queryPath: QueryPath;
				schema: StandardSchemaV1 | undefined;
				wildcardIndexes: number[] | undefined;
			}
		>();
		for (const row of jsonPaths) {
			let jsonPath;
			let schema;
			if (typeof row === "string") {
				jsonPath = row;
			} else {
				jsonPath = row.path;
				schema = row.schema;
			}
			const queryPath = jsonPathToQueryPath(jsonPath);

			let wildcardIndexes: number[] | undefined;
			for (const [i, component] of queryPath.entries()) {
				if (component.type === "wildcard") {
					if (wildcardIndexes === undefined) {
						wildcardIndexes = [];
					}
					wildcardIndexes.push(i);
				}
			}

			queryInfos.set(jsonPath, {
				jsonPath,
				queryPath,
				schema,
				wildcardIndexes,
			});
		}

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
						for (const {
							jsonPath,
							queryPath,
							schema,
							wildcardIndexes,
						} of queryInfos.values()) {
							if (queryPath.every((x, j) => isEqual(x, path[j]))) {
								if (path.length === queryPath.length) {
									// Exact match of queryPath - emit record, and we don't need to keep it any more for this queryPath

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
												const pathComponent = path[index];
												if (pathComponent?.type === "key") {
													if (!wildcardKeys) {
														wildcardKeys = [];
													}
													wildcardKeys.push(pathComponent.value);
												}
											}
										}
									}

									if (wildcardKeys) {
										controller.enqueue({
											jsonPath,
											value: valueToEmit,
											wildcardKeys,
										});
									} else {
										controller.enqueue({
											jsonPath,
											value: valueToEmit,
										});
									}
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

export type { JSONParseStream };
