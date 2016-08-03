var assert = require('assert');
var Lawncipher = require('../');
var to_string = Lawncipher.to_string;
var from_string = Lawncipher.from_string;

Lawncipher.init();

var sodium = require('libsodium-wrappers');
var ls_to_string = sodium.to_string;
var ls_from_string = sodium.from_string;

var defaultBufferSize = 524288; //512kb as default test size

function generateArabicBuffer(_bSize){
	var bSize = _bSize || defaultBufferSize;

	var charIndex = 0;
	var baseChar = 0xd8a7; //Arabic Alef, binary UTF-8 representation
	var charCount = 25; //Not taking the whole arabic alphabet

	var b = new Uint8Array(bSize);
	for (var i = 0; i < bSize; i += 2){
		var currentChar = baseChar + charIndex;
		b[i] = currentChar >>> 8;
		b[i+1] = currentChar % 256;
		charIndex = (charIndex + 1) % charCount;
	}

	return b;
}

function generateGreekBuffer(_bSize){
	var bSize = _bSize || defaultBufferSize;

	var charIndex = 0;
	var baseChar = 0xceb1; //Greek alpha, binary UTF-8 representation
	var charCount = 15; //Not taking the whole greek alphabet

	var b = new Uint8Array(bSize);
	for (var i = 0; i < bSize; i += 2){
		var currentChar = baseChar + charIndex;
		b[i] = currentChar >>> 8;
		b[i+1] = currentChar % 256;
		charIndex = (charIndex + 1) % charCount;
	}

	return b;
}

function generateLatinBuffer(_bSize){
	var bSize = _bSize || defaultBufferSize;

	var charIndex = 0;
	var baseChar = 0x41;
	var charCount = 26;

	var b = new Uint8Array(bSize);
	for (var i = 0; i < bSize; i++){
		var currentChar = baseChar + charIndex;
		b[i] = currentChar;
		charIndex = (charIndex + 1) % charCount;
	}

	return b;
}

assert(to_string(generateLatinBuffer()));
assert(to_string(generateGreekBuffer()));
assert(to_string(generateArabicBuffer()));
