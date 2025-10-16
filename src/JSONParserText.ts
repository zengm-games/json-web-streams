// This is based on https://github.com/qwtel/jsonparse/ but assumes the input is already a utf8 string, so it gets rid of a lot of complexity dealing with character encoding. It runs much faster too!

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
	| "NUMBER-" // Number startign with negative sign
	| "NUMBER0" // Number with a leading 0 (either no negative sign, or after negative sign)
	| "NUMBER" // Any other number
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

type OnValue = (value: Value, stack: Stack) => void;

const WHITESPACE = new Set([" ", "\t", "\n", "\r"]);

class JSONParserText {
	tokenizerState: TokenizerState = "START";
	state: Token | ParserState = "VALUE";
	mode: Mode | undefined;
	stack: Stack = [];
	string: string | undefined;
	key: Key | undefined;
	value: Value;
	position = 0;
	onValue: OnValue;
	unicode: string | undefined;
	highSurrogate: number | undefined;
	seenRootObject = false;
	multi: boolean;
	multiIndex = 0;

	constructor({ multi, onValue }: { multi: boolean; onValue: OnValue }) {
		this.onValue = onValue;
		this.multi = multi;
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
				!WHITESPACE.has(n)
			) {
				return this.charError(n, i);
			}

			if (this.multi && this.stack.length === 0 && this.seenRootObject) {
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
				} else if (WHITESPACE.has(n)) {
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
					// Check for control characters that are not valid inside JSON strings
					const code = n.charCodeAt(0);
					if (code <= 0x001f) {
						this.charError(n, i);
					}

					this.string += n;
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
				this.unicode += n;
				if (this.tokenizerState === "STRING3") {
					this.tokenizerState = "STRING4";
				} else if (this.tokenizerState === "STRING4") {
					this.tokenizerState = "STRING5";
				} else if (this.tokenizerState === "STRING5") {
					this.tokenizerState = "STRING6";
				} else if (this.tokenizerState === "STRING6") {
					const intVal = Number.parseInt(this.unicode!, 16);
					if (Number.isNaN(intVal)) {
						return this.charError(n, i);
					}
					this.unicode = undefined;
					if (
						this.highSurrogate !== undefined &&
						intVal >= 0xdc00 &&
						intVal < 0xdfff + 1
					) {
						//<56320,57343> - lowSurrogate
						this.string += String.fromCharCode(this.highSurrogate, intVal);
						this.highSurrogate = undefined;
					} else if (
						this.highSurrogate === undefined &&
						intVal >= 0xd800 &&
						intVal < 0xdbff + 1
					) {
						//<55296,56319> - highSurrogate
						this.highSurrogate = intVal;
					} else {
						if (this.highSurrogate !== undefined) {
							this.string += String.fromCharCode(this.highSurrogate);
							this.highSurrogate = undefined;
						}
						this.string += String.fromCharCode(intVal);
					}

					this.tokenizerState = "STRING1";
				}
			} else if (
				this.tokenizerState === "NUMBER" ||
				this.tokenizerState === "NUMBER-" ||
				this.tokenizerState === "NUMBER0"
			) {
				if (this.tokenizerState === "NUMBER0" && n >= "0" && n <= "9") {
					// The error is the previous characte,r which must be a leading 0
					return this.charError("0", i - 1);
				}

				switch (n) {
					case "0":
						this.string += n;
						this.tokenizerState =
							this.tokenizerState === "NUMBER-" ? "NUMBER0" : "NUMBER";
						break;
					case "1":
					case "2":
					case "3":
					case "4":
					case "5":
					case "6":
					case "7":
					case "8":
					case "9":
					case ".":
					case "e":
					case "E":
					case "+":
					case "-":
						this.string += n;
						this.tokenizerState = "NUMBER";
						break;
					default: {
						this.tokenizerState = "START";
						this.numberReviver(this.string!, i);

						this.string = undefined;

						// Process this character (n) again, to get the actual value
						i--;
						break;
					}
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
	}

	pop() {
		const value = this.value;
		const parent = this.stack.pop()!;
		this.value = parent.value;
		this.key = parent.key;
		this.mode = parent.mode;
		this.emit(value);
		if (!this.mode) {
			this.state = "VALUE";
		}
	}

	emit(value: Value) {
		if (this.mode) {
			this.state = "COMMA";
		}
		this.onValue(value, [
			...this.stack,
			{
				value: this.value,
				key: this.key,
				mode: this.mode,
			},
		]);
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
				this.key = undefined;
				this.state = "KEY";
				this.mode = "OBJECT";
			} else if (token === "LEFT_BRACKET") {
				this.push();
				if (this.value) {
					this.value = this.value[this.key!] = [];
				} else {
					this.value = [];
				}
				this.key = 0;
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
				this.key = value;
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

	numberReviver(text: string, i: number) {
		// JSON.parse handles various number formatting quirks for us, so why not!
		const number = JSON.parse(text);

		if (Number.isNaN(number)) {
			return this.charError(text, i);
		}

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
			this.state === "VALUE" &&
			this.tokenizerState === "NUMBER" &&
			this.string !== undefined
		) {
			this.numberReviver(this.string!, this.position - 1);
			this.string = undefined;
		} else if (!this.seenRootObject) {
			// Check for empty input
			throw new Error("No data in input");
		}
	}
}

export default JSONParserText;
