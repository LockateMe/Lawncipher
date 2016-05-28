var fs = require('fs');
var path = require('path')
var assert = require('assert');
var Lawncipher = require('../');
var Long = require('long');
var faker = require('faker');

var rmdir = require('rmdir');

var sodium = require('libsodium-wrappers');
var to_hex = sodium.to_hex, from_hex = sodium.from_hex;

var deepObjectEquality = Lawncipher.deepObjectEquality;
var randomBuffer = Lawncipher.randomBuffer;

var PearsonBPlusTree = Lawncipher.PearsonBPlusTree;
var PearsonSeedGenerator = Lawncipher.PearsonSeedGenerator;
var PearsonHasher = Lawncipher.PearsonHasher;
var Index = Lawncipher.Index;

var testIndexPath = path.join(__dirname, 'test_index');

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

function basicTests(next){
	var indexKey = randomBuffer(32);

	function saveIndex(_next){
		rmdir(testIndexPath, function(err){
			if (err) throw err;

			var testIndex = new Index(__dirname, 'test_index', 'index', indexKey, testSeed, function(loadErr){
				if (loadErr) throw loadErr;

				testIndex.add('test', 1, function(e){
					if (e) throw e;

					testIndex.add('hello', 2, function(e){
						if (e) throw e;

						_next();
					});
				});
			});
		});
	}

	function loadIndex(_next){
		var testIndex = new Index(__dirname, 'test_index', 'index', indexKey, testSeed, function(loadErr){
			if (loadErr) throw loadErr;

			testIndex.lookup('test', function(err, value){
				if (err) throw err;

				assert(value == 1);

				testIndex.lookup('hello', function(err, value){
					if (err) throw err;

					assert(value == 2);

					_next();
				});
			});
		});
	}

	saveIndex(function(){
		loadIndex(next);
	});
}

//A testing method, designed to test save, loading, lookup and removal of a non-negligeable data set
function loadTests(docCount, cb){
	docCount = docCount || 1000;
	if (typeof cb != 'function') throw new TypeError('cb must be a function');

	var testIndex;
	var indexKey = randomBuffer(32);
	var indexSeed = PearsonSeedGenerator();

	var dataSet = new Array(docCount);

	for (var i = 0; i < docCount; i++){
		dataSet[i] = {k: faker.random.uuid(), v: newRandomUserDoc()};
	}

	function saveIndex(_next){
		rmdir(testIndexPath, function(err){
			if (err) throw err;

			testIndex = new Index(__dirname, 'test_index', 'index', indexKey, indexSeed, function(loadErr){
				if (loadErr) throw loadErr;

				var addIndex = 0;

				function addOne(){
					var currentTuple = dataSet[addIndex];
					testIndex.add(currentTuple.k, currentTuple.v, function(err){
						if (err) throw err;

						nextAdd();
					});
				}

				function nextAdd(){
					addIndex++;
					if (addIndex == docCount){
						_next();
					} else {
						if (addIndex % 100 == 0) setTimeout(addOne, 0);
						else addOne();
					}
				}

				addOne();
			});
		});
	}

	function loadIndex(_next){
		testIndex = new Index(__dirname, 'test_index', 'index', indexKey, indexSeed, function(loadErr){
			if (loadErr) throw loadErr;

			var lookupIndex = 0;

			function lookupOne(){
				var currentTuple = dataSet[lookupIndex];
				testIndex.lookup(currentTuple.k, function(err, value){
					if (err) throw err;

					//console.log('lookupIndex: ' + lookupIndex);
					//console.log('Found value: ' + JSON.stringify(value));
					//console.log('Expected value: ' + JSON.stringify(currentTuple.v));
					assert(deepObjectEquality(currentTuple.v, value));

					nextLookup();
				});
			}

			function nextLookup(){
				lookupIndex++;
				if (lookupIndex == docCount){
					_next();
				} else {
					if (lookupIndex % 100 == 0) setTimeout(lookupOne, 0);
					else lookupOne();
				}
			}

			lookupOne();
		});
	}

	function destroyIndex(_next){
		if (!testIndex) throw new Error('testIndex must be defined');

		var removeIndex = 0;

		function removeOne(){
			var currentTuple = dataSet[removeIndex];
			testIndex.remove(currentTuple.k, currentTuple.v, function(err){
				if (err) throw err;

				nextRemoval();
			});
		}

		function nextRemoval(){
			removeIndex++;
			if (removeIndex == docCount){
				_next();
			} else {
				if (removeIndex % 100 == 0) setTimeout(removeOne, 0);
				else removeOne();
			}
		}

		removeOne();
	}

	function checkDestruction(_next){
		if (!testIndex) throw new Error('testIndex must be defined');

		var lookupIndex = 0;

		function lookupOne(){
			var currentTuple = dataSet[lookupIndex];
			testIndex.lookup(currentTuple.k, function(err, value){
				if (err) throw err;

				assert(!value);

				nextLookup();
			});
		}

		function nextLookup(){
			lookupIndex++;
			if (lookupIndex == docCount){
				_next();
			} else {
				if (lookupIndex % 100 == 0) setTimeout(lookupOne, 0);
				else lookupOne();
			}
		}

		lookupOne();
	}

	saveIndex(function(){
		loadIndex(function(){
			destroyIndex(function(){
				checkDestruction(cb);
			});
		});
	});
}

console.log('----------------------');
console.log('Basic index testing');
console.log('----------------------');
basicTests(function(){
	console.log('done');
	console.log('');
	console.log('----------------------');
	console.log('Data load index testing');
	console.log('----------------------');
	loadTests(undefined, function(){
		console.log('done');
	});
});
