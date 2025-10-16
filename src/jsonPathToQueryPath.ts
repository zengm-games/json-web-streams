import parser from "jsonpath-rfc9535/parser";

export type QueryPath = (
	| {
			type: "key";
			value: string;
	  }
	| {
			type: "array";
	  }
)[];

// Would be nice to be more strict than this, but I think it's not possible
export type JSONPath = "$" | `$${"." | "["}${string}`;

export const jsonPathToQueryPath = (jsonPath: JSONPath): QueryPath => {
	let parsed;
	try {
		parsed = parser(jsonPath);
	} catch (error) {
		throw new Error(`Error parsing JSONPath "${jsonPath}"`, { cause: error });
	}
	return parsed.segments.flatMap((segment) => {
		if (segment.type === "ChildSegment") {
			const node = segment.node;
			if (node.type === "MemberNameShorthand") {
				return { type: "key", value: node.value };
			} else if (node.type === "BracketedSelection") {
				if (node.selectors.length === 1) {
					const selector = node.selectors[0]!;
					if (selector.type === "NameSelector") {
						return { type: "key", value: selector.value };
					} else if (selector.type === "WildcardSelector") {
						return { type: "array" };
					}
				} else if (node.selectors.length > 1) {
					return node.selectors.map((selector) => {
						if (selector.type === "NameSelector") {
							return {
								type: "key",
								value: selector.value,
							};
						} else {
							throw new Error(`Unsupported node: ${JSON.stringify(node)}`);
						}
					});
				}
				throw new Error(`Unsupported node: ${JSON.stringify(node)}`);
			} else {
				throw new Error(`${segment.type} node type not supported`);
			}
		} else {
			throw new Error(`${segment.type} segment type not supported`);
		}
	});
};
