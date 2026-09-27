// This is based on https://github.com/qwtel/jsonparse/ by Florian Klampfer but assumes the input is already a utf8 string, so it gets rid of a lot of complexity dealing with character encoding, and also seems to make it faster. That library in turn was based on https://github.com/creationix/jsonparse by Tim Caswell. Both of those libraries were released under the MIT license.

type Token =
	| "LEFT_BRACE"
	| "RIGHT_BRACE"
	| "LEFT_BRACKET"
	| "RIGHT_BRACKET"
	| "COLON"
	| "COMMA"
	| "TRUE"
	| "FALSE"
	| "NULL"
	| "STRING"
	| "NUMBER";

type ParserState = "VALUE" | "KEY" | "VALUE_AFTER_COMMA" | "KEY_AFTER_COMMA";

type TokenizerState =
	| "START"
	| "TRUE1"
	| "TRUE2"
	| "TRUE3"
	| "FALSE1"
	| "FALSE2"
	| "FALSE3"
	| "FALSE4"
	| "NULL1"
	| "NULL2"
	| "NULL3"
	| "NUMBER-" // After negative sign, needs a digit
	| "NUMBER0" // After a leading 0 (either no negative sign, or after negative sign), can't be followed by another digit
	| "NUMBER" // Integer digits after a leading 1-9
	| "NUMBER_DOT" // After decimal point, needs a digit
	| "NUMBER_FRACTION" // Digits after decimal point
	| "NUMBER_E" // After e/E, needs a sign or digit
	| "NUMBER_E_SIGN" // After sign of exponent, needs a digit
	| "NUMBER_EXPONENT" // Digits of exponent
	| "STRING1"
	| "STRING2"
	| "STRING3"
	| "STRING4"
	| "STRING5"
	| "STRING6";

type Mode = "OBJECT" | "ARRAY";

type Key = string | number;

type Value = any;

export type Stack = {
	key: Key | undefined;
	// oxlint-disable-next-line no-redundant-type-constituents
	value: Value | undefined;
	mode: Mode | undefined;
}[];

type OnPopPush = (stackLength: number) => void;
type OnValue = (value: Value) => void;

const isWhitespace = (n: string) =>
	n === " " || n === "\n" || n === "\r" || n === "\t";

export class JSONParseStreamRaw {
	tokenizerState: TokenizerState = "START";
	state: Token | ParserState = "VALUE";
	mode: Mode | undefined;
	stack: Stack = [];
	string: string | undefined;
	key: Key | undefined;
	value: Value;
	position = 0;
	onKey: OnPopPush | undefined;
	onPop: OnPopPush | undefined;
	onPush: OnPopPush | undefined;
	onValue: OnValue;
	unicode: string | undefined;
	seenRootObject = false;
	multi: boolean | undefined;
	multiIndex = 0;

	constructor({
		multi,
		onKey,
		onPop,
		onPush,
		onValue,
	}: {
		multi?: boolean;
		onKey?: OnPopPush;
		onPop?: OnPopPush;
		onPush?: OnPopPush;
		onValue: OnValue;
	}) {
		this.multi = multi;
		this.onKey = onKey;
		this.onPop = onPop;
		this.onPush = onPush;
		this.onValue = onValue;
	}

	charError(char: string, i: number) {
		throw new Error(
			`Unexpected ${JSON.stringify(char)} at position ${
				this.position + i
			} in state ${this.tokenizerState}`,
		);
	}

	parseError(token: Token, value: Value, i: number) {
		throw new Error(
			`Unexpected ${token}${
				value ? `(${JSON.stringify(value)})` : ""
			} at position ${this.position + i} in state ${this.state}`,
		);
	}

	write(text: string) {
		for (let i = 0, l = text.length; i < l; i++) {
			const n = text[i]!;
			//console.log('character', n, this.tokenizerState);

			// Handle any non-whitespace after the root object has closed
			if (
				!this.multi &&
				this.stack.length === 0 &&
				this.seenRootObject &&
				!isWhitespace(n)
			) {
				return this.charError(n, i);
			}

			if (this.tokenizerState === "START") {
				if (n === "{") {
					this.onToken("LEFT_BRACE", "{", i);
				} else if (n === "}") {
					this.onToken("RIGHT_BRACE", "}", i);
				} else if (n === "[") {
					this.onToken("LEFT_BRACKET", "[", i);
				} else if (n === "]") {
					this.onToken("RIGHT_BRACKET", "]", i);
				} else if (n === ":") {
					this.onToken("COLON", ":", i);
				} else if (n === ",") {
					this.onToken("COMMA", ",", i);
				} else if (n === "t") {
					this.tokenizerState = "TRUE1";
				} else if (n === "f") {
					this.tokenizerState = "FALSE1";
				} else if (n === "n") {
					this.tokenizerState = "NULL1";
				} else if (n === '"') {
					// "
					this.string = "";
					this.tokenizerState = "STRING1";
				} else if (n === "-") {
					this.string = "-";
					this.tokenizerState = "NUMBER-";
				} else if (n === "0") {
					this.string = n;
					this.tokenizerState = "NUMBER0";
				} else if (n >= "1" && n <= "9") {
					this.string = n;
					this.tokenizerState = "NUMBER";
				} else if (isWhitespace(n)) {
					// Ignore whitespace
				} else if (n === "␞" && this.multi && this.stack.length === 0) {
					// Ignore json-seq separator in multi mode
				} else {
					return this.charError(n, i);
				}
			} else if (this.tokenizerState === "STRING1") {
				if (n === '"') {
					this.tokenizerState = "START";
					this.onToken("STRING", this.string, i);
					this.string = undefined;
				} else if (n === "\\") {
					this.tokenizerState = "STRING2";
				} else {
					// Scan ahead to the next character that needs special handling, so the whole run of normal characters can be appended at once rather than one at a time
					let j = i;
					for (; j < l; j++) {
						const code = text.charCodeAt(j);
						if (code === 0x22 || code === 0x5c) {
							// " or \
							break;
						}
						if (code <= 0x1f) {
							// Control characters are not valid inside JSON strings
							return this.charError(text[j]!, j);
						}
					}

					this.string += text.slice(i, j);

					// Continue the main loop from the " or \ (or the end of this chunk)
					i = j - 1;
				}
			} else if (this.tokenizerState === "STRING2") {
				// After backslash
				if (n === '"') {
					this.string += '"';
					this.tokenizerState = "STRING1";
				} else if (n === "\\") {
					this.string += "\\";
					this.tokenizerState = "STRING1";
				} else if (n === "/") {
					this.string += "/";
					this.tokenizerState = "STRING1";
				} else if (n === "b") {
					this.string += "\b";
					this.tokenizerState = "STRING1";
				} else if (n === "f") {
					this.string += "\f";
					this.tokenizerState = "STRING1";
				} else if (n === "n") {
					this.string += "\n";
					this.tokenizerState = "STRING1";
				} else if (n === "r") {
					this.string += "\r";
					this.tokenizerState = "STRING1";
				} else if (n === "t") {
					this.string += "\t";
					this.tokenizerState = "STRING1";
				} else if (n === "u") {
					this.unicode = "";
					this.tokenizerState = "STRING3";
				} else {
					return this.charError(n, i);
				}
			} else if (
				this.tokenizerState === "STRING3" ||
				this.tokenizerState === "STRING4" ||
				this.tokenizerState === "STRING5" ||
				this.tokenizerState === "STRING6"
			) {
				// Unicode hex codes
				if (
					!(
						(n >= "0" && n <= "9") ||
						(n >= "a" && n <= "f") ||
						(n >= "A" && n <= "F")
					)
				) {
					return this.charError(n, i);
				}
				this.unicode += n;
				if (this.tokenizerState === "STRING3") {
					this.tokenizerState = "STRING4";
				} else if (this.tokenizerState === "STRING4") {
					this.tokenizerState = "STRING5";
				} else if (this.tokenizerState === "STRING5") {
					this.tokenizerState = "STRING6";
				} else if (this.tokenizerState === "STRING6") {
					const intVal = Number.parseInt(this.unicode!, 16);
					this.unicode = undefined;
					this.string += String.fromCharCode(intVal);
					this.tokenizerState = "STRING1";
				}
			} else if (this.tokenizerState === "NUMBER") {
				if (n >= "0" && n <= "9") {
					this.string += n;
				} else if (n === ".") {
					this.string += n;
					this.tokenizerState = "NUMBER_DOT";
				} else if (n === "e" || n === "E") {
					this.string += n;
					this.tokenizerState = "NUMBER_E";
				} else {
					this.endNumber(i);

					// Process this character (n) again, since it's not part of the number
					i--;
				}
			} else if (this.tokenizerState === "NUMBER_FRACTION") {
				if (n >= "0" && n <= "9") {
					this.string += n;
				} else if (n === "e" || n === "E") {
					this.string += n;
					this.tokenizerState = "NUMBER_E";
				} else {
					this.endNumber(i);

					// Process this character (n) again, since it's not part of the number
					i--;
				}
			} else if (this.tokenizerState === "NUMBER0") {
				if (n >= "0" && n <= "9") {
					// The error is the previous character, which must be a leading 0
					return this.charError("0", i - 1);
				} else if (n === ".") {
					this.string += n;
					this.tokenizerState = "NUMBER_DOT";
				} else if (n === "e" || n === "E") {
					this.string += n;
					this.tokenizerState = "NUMBER_E";
				} else {
					this.endNumber(i);

					// Process this character (n) again, since it's not part of the number
					i--;
				}
			} else if (this.tokenizerState === "NUMBER-") {
				if (n === "0") {
					this.string += n;
					this.tokenizerState = "NUMBER0";
				} else if (n >= "1" && n <= "9") {
					this.string += n;
					this.tokenizerState = "NUMBER";
				} else {
					return this.charError(n, i);
				}
			} else if (this.tokenizerState === "NUMBER_DOT") {
				if (n >= "0" && n <= "9") {
					this.string += n;
					this.tokenizerState = "NUMBER_FRACTION";
				} else {
					return this.charError(n, i);
				}
			} else if (this.tokenizerState === "NUMBER_E") {
				if (n >= "0" && n <= "9") {
					this.string += n;
					this.tokenizerState = "NUMBER_EXPONENT";
				} else if (n === "+" || n === "-") {
					this.string += n;
					this.tokenizerState = "NUMBER_E_SIGN";
				} else {
					return this.charError(n, i);
				}
			} else if (this.tokenizerState === "NUMBER_E_SIGN") {
				if (n >= "0" && n <= "9") {
					this.string += n;
					this.tokenizerState = "NUMBER_EXPONENT";
				} else {
					return this.charError(n, i);
				}
			} else if (this.tokenizerState === "NUMBER_EXPONENT") {
				if (n >= "0" && n <= "9") {
					this.string += n;
				} else {
					this.endNumber(i);

					// Process this character (n) again, since it's not part of the number
					i--;
				}
			} else if (this.tokenizerState === "TRUE1") {
				if (n === "r") {
					this.tokenizerState = "TRUE2";
				} else {
					return this.charError(n, i);
				}
			} else if (this.tokenizerState === "TRUE2") {
				if (n === "u") {
					this.tokenizerState = "TRUE3";
				} else {
					return this.charError(n, i);
				}
			} else if (this.tokenizerState === "TRUE3") {
				if (n === "e") {
					this.tokenizerState = "START";
					this.onToken("TRUE", true, i);
				} else {
					return this.charError(n, i);
				}
			} else if (this.tokenizerState === "FALSE1") {
				if (n === "a") {
					this.tokenizerState = "FALSE2";
				} else {
					return this.charError(n, i);
				}
			} else if (this.tokenizerState === "FALSE2") {
				if (n === "l") {
					this.tokenizerState = "FALSE3";
				} else {
					return this.charError(n, i);
				}
			} else if (this.tokenizerState === "FALSE3") {
				if (n === "s") {
					this.tokenizerState = "FALSE4";
				} else {
					return this.charError(n, i);
				}
			} else if (this.tokenizerState === "FALSE4") {
				if (n === "e") {
					this.tokenizerState = "START";
					this.onToken("FALSE", false, i);
				} else {
					return this.charError(n, i);
				}
			} else if (this.tokenizerState === "NULL1") {
				if (n === "u") {
					this.tokenizerState = "NULL2";
				} else {
					return this.charError(n, i);
				}
			} else if (this.tokenizerState === "NULL2") {
				if (n === "l") {
					this.tokenizerState = "NULL3";
				} else {
					return this.charError(n, i);
				}
			} else if (this.tokenizerState === "NULL3") {
				if (n === "l") {
					this.tokenizerState = "START";
					this.onToken("NULL", null, i);
				} else {
					return this.charError(n, i);
				}
			}
		}

		this.position += text.length;
	}

	push() {
		this.stack.push({ value: this.value, key: this.key, mode: this.mode });
		this.onPush?.(this.stack.length);
	}

	pop() {
		const value = this.value;
		const parent = this.stack.pop()!;
		this.value = parent.value;
		this.key = parent.key;
		this.mode = parent.mode;
		this.emit(value);
		this.onPop?.(this.stack.length);
		if (!this.mode) {
			this.state = "VALUE";
		}
	}

	setKey(key: number | string | undefined) {
		this.key = key;
		if (this.onKey && typeof key === "string" && this.mode === "OBJECT") {
			this.onKey(this.stack.length);
		}
	}

	emit(value: Value) {
		if (this.mode) {
			this.state = "COMMA";
		}

		if (value === undefined) {
			// Must have been deleted by JSONParseStream as irrelevant, so no need to emit
			return;
		}

		this.onValue(value);
	}

	onToken(token: Token, value: Value, i: number) {
		//console.log('onToken', token, value, this.state)
		if (this.stack.length === 0) {
			if (!this.seenRootObject) {
				this.seenRootObject = true;
			}
		}

		if (this.state === "VALUE" || this.state === "VALUE_AFTER_COMMA") {
			if (
				token === "STRING" ||
				token === "NUMBER" ||
				token === "TRUE" ||
				token === "FALSE" ||
				token === "NULL"
			) {
				if (this.value) {
					this.value[this.key!] = value;
				}
				this.emit(value);
			} else if (token === "LEFT_BRACE") {
				this.push();
				if (this.value) {
					this.value = this.value[this.key!] = {};
				} else {
					this.value = {};
				}
				this.setKey(undefined);
				this.state = "KEY";
				this.mode = "OBJECT";
			} else if (token === "LEFT_BRACKET") {
				this.push();
				if (this.value) {
					this.value = this.value[this.key!] = [];
				} else {
					this.value = [];
				}
				this.setKey(0);
				this.mode = "ARRAY";
				this.state = "VALUE";
			} else if (token === "RIGHT_BRACE") {
				if (this.mode === "OBJECT" && this.state !== "VALUE_AFTER_COMMA") {
					this.pop();
				} else {
					return this.parseError(token, value, i);
				}
			} else if (token === "RIGHT_BRACKET") {
				if (this.mode === "ARRAY" && this.state !== "VALUE_AFTER_COMMA") {
					this.pop();
				} else {
					return this.parseError(token, value, i);
				}
			} else {
				return this.parseError(token, value, i);
			}
		} else if (this.state === "KEY" || this.state === "KEY_AFTER_COMMA") {
			if (token === "STRING") {
				this.setKey(value);
				this.state = "COLON";
			} else if (token === "RIGHT_BRACE" && this.state !== "KEY_AFTER_COMMA") {
				this.pop();
			} else {
				return this.parseError(token, value, i);
			}
		} else if (this.state === "COLON") {
			if (token === "COLON") {
				this.state = "VALUE";
			} else {
				return this.parseError(token, value, i);
			}
		} else if (this.state === "COMMA") {
			if (token === "COMMA") {
				if (this.mode === "ARRAY") {
					// @ts-expect-error
					this.key++;
					this.state = "VALUE_AFTER_COMMA";
				} else if (this.mode === "OBJECT") {
					this.state = "KEY_AFTER_COMMA";
				}
			} else if (
				(token === "RIGHT_BRACKET" && this.mode === "ARRAY") ||
				(token === "RIGHT_BRACE" && this.mode === "OBJECT")
			) {
				this.pop();
			} else {
				return this.parseError(token, value, i);
			}
		} else {
			return this.parseError(token, value, i);
		}
	}

	endNumber(i: number) {
		// The tokenizer already validated this against the JSON number grammar, and for valid JSON numbers Number gives the same result as JSON.parse
		const number = Number(this.string);
		this.string = undefined;
		this.tokenizerState = "START";

		this.onToken("NUMBER", number, i);
	}

	checkEnd() {
		if (this.stack.length > 0) {
			throw new Error(
				`Unexpected end of input at position ${this.position} in state ${this.state}`,
			);
		}

		// Check for lonely number - other vaues have a defined end (like null is always 4 letters, so we can emit it after the 4th letter), but for lonely numbers there is no way to tell when the end is
		if (
			this.tokenizerState === "NUMBER" ||
			this.tokenizerState === "NUMBER0" ||
			this.tokenizerState === "NUMBER_FRACTION" ||
			this.tokenizerState === "NUMBER_EXPONENT"
		) {
			this.endNumber(this.position - 1);
		}

		// Input ended in the middle of a string, an incomplete number like "1." or "-", or a literal like true/false/null
		if (this.tokenizerState !== "START") {
			throw new Error(
				`Unexpected end of input at position ${this.position} in state ${this.tokenizerState}`,
			);
		}

		if (!this.seenRootObject) {
			// Check for empty input
			throw new Error("No data in input");
		}
	}
}
