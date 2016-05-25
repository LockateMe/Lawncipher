var assert = require('assert');
var Lawncipher = require('../');
var Long = require('long');
var faker = require('faker');

var sodium = require('libsodium-wrappers');
var to_hex = sodium.to_hex, from_hex = sodium.from_hex;

var deepObjectEquality = Lawncipher.deepObjectEquality;

var PearsonBPlusTree = Lawncipher.PearsonBPlusTree;
var PearsonSeedGenerator = Lawncipher.PearsonSeedGenerator;
var PearsonHasher = Lawncipher.PearsonHasher;

function arrayEquality(a1, a2){
	if (!(Array.isArray(a1) && Array.isArray(a2))) return false;
	if (a1.length != a2.length) return false;

	for (var i = 0; i < a1.length; i++){
		if (a1[i] != a2[i]) return false;
	}
	return true;
}

function newRandomUserDoc(){
	return {
		name: faker.name.firstName() + ' ' + faker.name.lastName(),
		email: faker.internet.email(),
		address: faker.address.streetName() + '\n' + faker.address.city() + '\n' + faker.address.country()
	};
}

function logChange(dRange, data){
	console.log('[change ' + dRange.toString() + '] ' + JSON.stringify(data));
}

function logChangeWithoutData(dRange, data){
	console.log('[change ' + dRange.toString() + ']');
}

function logDelete(dRange){
	console.log('[delete ' + dRange.toString() + ']');
}

function basicTests(){
	var testSeed = [
		98,  6, 85, 150, 36, 23, 112, 164, 135, 207, 169,  5, 26, 64, 165, 219,
	    61, 20, 68, 89, 130, 63, 52, 102, 24, 229, 132, 245, 80, 216, 195, 115,
		90, 168, 156, 203, 177, 120,  2, 190, 188,  7, 100, 185, 174, 243, 162, 10,
		237, 18, 253, 225, 8, 208, 172, 244, 255, 126, 101, 79, 145, 235, 228, 121,
		123, 251, 67, 250, 161, 0, 107, 97, 241, 111, 181, 82, 249, 33, 69, 55,
		59,153, 29, 9, 213, 167, 84, 93, 30, 46, 94, 75, 151, 114, 73, 222,
		197, 96, 210, 45, 16, 227, 248, 202, 51, 152, 252, 125, 81, 206, 215, 186,
		39, 158, 178, 187, 131, 136,  1, 49, 50, 17, 141, 91, 47, 129, 60, 99,
		154, 35, 86, 171, 105, 34, 38, 200, 147, 58, 77, 118, 173, 246, 76, 254,
		133, 232, 196, 144, 198, 124, 53, 4, 108, 74, 223, 234, 134, 230, 157, 139,
		189, 205, 199, 128, 176, 19, 211, 236, 127, 192, 231, 70, 233, 88, 146, 44,
		183, 201, 22, 83, 13, 214, 116, 109, 159, 32, 95, 226, 140, 220, 57, 12,
		221, 31, 209, 182, 143, 92, 149, 184, 148, 62, 113, 65, 37, 27, 106, 166,
		3, 14, 204, 72, 21, 41, 56, 66, 28, 193, 40, 217, 25, 54,179,117,
		238, 87, 240, 155, 180, 170, 242, 212, 191, 163, 78, 218, 137, 194, 175, 110,
		43, 119, 224, 71, 122, 142, 42, 160, 104, 48, 247, 103, 15, 11, 138, 239
	];

	var ph = PearsonHasher(testSeed);

	console.log('Testing while disallowing key collisions');

	var testTree = new PearsonBPlusTree(undefined, ph, undefined, true);

	testTree.on('change', logChange);
	testTree.on('delete', logDelete);

	testTree.add('test', 1);
	testTree.add('hello', 2);

	//Checking that key collisions are indeed disallowed
	assert.throws(function(){
		testTree.add('test', 3);
	});
	assert.throws(function(){
		testTree.add('hello', 4);
	});

	assert(testTree.lookup('test') == 1);
	assert(testTree.lookup('hello') == 2);

	testTree.remove('test');
	testTree.remove('hello');

	assert(!testTree.lookup('test'));
	assert(!testTree.lookup('hello'));

	console.log('Testing while allowing key collisions');

	testTree = new PearsonBPlusTree(undefined, ph, undefined, false);

	testTree.on('change', logChange);
	testTree.on('delete', logDelete);

	testTree.add('test', 1);
	testTree.add('test', 2);
	testTree.add('hello', 3);
	testTree.add('hello', 4);

	assert(arrayEquality(testTree.lookup('test'), [1, 2]));
	assert(arrayEquality(testTree.lookup('hello'), [3, 4]));

	//Partial key removal
	testTree.remove('test', 1);
	assert(arrayEquality(testTree.lookup('test'), [2]));
	testTree.remove('test', 2);
	assert(!testTree.lookup('test'));
	//Full-key removal
	testTree.remove('hello');
	assert(!testTree.lookup('hello'));
}

function loadTests(docCount){
	docCount = docCount || 100;

	var testSeed = PearsonSeedGenerator();

	var ph = PearsonHasher(testSeed);

	var testTree = new PearsonBPlusTree(1000, ph, undefined, true);

	testTree.on('change', logChangeWithoutData);
	testTree.on('delete', logDelete);

	var futureLookups = [];
	var dataSet = [];

	for (var i = 0; i < docCount; i++){
		var tuple = {k: faker.random.uuid(), v: newRandomUserDoc()};
		dataSet.push(tuple);
		if (i % 10 == 0){
			futureLookups.push(tuple);
		}
		testTree.add(tuple.k, tuple.v);
	}

	for (var i = 0; i < futureLookups.length; i++){
		assert(deepObjectEquality(testTree.lookup(futureLookups[i].k), futureLookups[i].v));
	}

	for (var i = 0; i < dataSet.length; i++){
		testTree.remove(dataSet[i].k);
	}
}

function postponingEventsTests(docCount){
	docCount = docCount || 100;

	var testSeed = PearsonSeedGenerator();

	var ph = PearsonHasher(testSeed);

	var testTree = new PearsonBPlusTree(1000, ph, undefined, true);

	testTree.on('change', logChangeWithoutData);
	testTree.on('delete', logDelete);

	var futureLookups = [];
	var dataSet = [];

	console.log('---START OF ADDITIONS---');
	for (var i = 0; i < docCount; i++){
		var tuple = {k: faker.random.uuid(), v: newRandomUserDoc()};
		dataSet.push(tuple);
		if (i % 10 == 0){
			futureLookups.push(tuple);
		}
		testTree.add(tuple.k, tuple.v, i < docCount - 1 ? true : false); //noTrigger == false for last the tuple only
	}
	console.log('---END OF ADDITIONS---');

	for (var i = 0; i < futureLookups.length; i++){
		assert(deepObjectEquality(testTree.lookup(futureLookups[i].k), futureLookups[i].v));
	}

	console.log('---START OF REMOVALS---');
	for (var i = 0; i < dataSet.length; i++){
		testTree.remove(dataSet[i].k, undefined, i < dataSet.length - 1 ? true : false); //noTrigger == false for the last tuple only
	}
	console.log('---END OF REMOVALS---');
}

console.log('----------------------');
console.log('Basic Tree testing');
console.log('----------------------');
basicTests();
console.log('----------------------');
console.log('Tree load testing');
console.log('----------------------');
loadTests();
console.log('----------------------');
console.log('Postponed events testing');
console.log('----------------------');
postponingEventsTests();
