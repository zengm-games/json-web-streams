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

type JSONPathsObject = Partial<
	Record<JSONPath, StandardSchemaV1 | null | undefined>
>;

// Without this, `createJSONParserStream({x: null})` is not a type error because TypeScript doesn't have exact object types
type NoExtras<T, U> = T & {
	[K in keyof T as K extends keyof U ? K : never]: T[K];
} & { [K in keyof T as K extends keyof U ? never : K]: never };

export function createJSONParserStream<T extends JSONPathsObject>(
	jsonPaths: NoExtras<T, JSONPathsObject>,
	options?: {
		multi?: boolean;
	},
): JSONParserStream<T>;
export function createJSONParserStream<T extends readonly JSONPath[]>(
	jsonPaths: T,
	options?: {
		multi?: boolean;
	},
): JSONParserStream<{ [K in T[number]]: undefined }>;
export function createJSONParserStream<
	T extends JSONPathsObject | readonly JSONPath[],
	// Not really sure why I need this so many places, but seems I do
	ArrayInput extends Extract<T, readonly JSONPath[]>,
	ArrayOutput extends Record<ArrayInput[number], undefined>,
>(
	jsonPaths: T,
	options?: {
		multi?: boolean;
	},
): JSONParserStream<T extends JSONPathsObject ? T : ArrayOutput> {
	if (Array.isArray(jsonPaths)) {
		// Type casting in this branch is mostly because https://github.com/microsoft/TypeScript/issues/33700
		const obj = {} as ArrayOutput;
		for (const jsonPath of jsonPaths) {
			(obj as any)[jsonPath] = undefined;
		}
		return new JSONParserStream(obj, options) as any;
	}

	// Type casting is needed because of https://github.com/microsoft/TypeScript/issues/17002
	return new JSONParserStream(jsonPaths as JSONPathsObject, options);
}

class JSONParserStream<T extends JSONPathsObject> extends TransformStream<
	string,
	{
		[K in keyof T]: {
			jsonPath: K;
			value: T[K] extends StandardSchemaV1
				? StandardSchemaV1.InferOutput<T[K]>
				: unknown;
			wildcardKeys?: string[];
		};
	}[keyof T]
> {
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
				schema: StandardSchemaV1 | null | undefined;
				wildcardIndexes: number[] | undefined;
			}
		>();
		for (const [key, schema] of Object.entries(jsonPaths)) {
			const jsonPath = key as JSONPath;
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
				schema: schema,
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
										// structuredClone is needed in case this object is emitted elsewhere as part of another object - they should not be linked as parent/child, that would be confusing. But as a quick optimization, if there's only one queryPath, we don't need to clone because there is no other query to overlap with.
										valueToEmit =
											queryInfos.size === 1 ? value : structuredClone(value);
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

export type { JSONParserStream };
