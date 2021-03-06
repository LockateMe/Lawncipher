var fs = require('fs');
var path = require('path')
var assert = require('assert');
var crypto = require('crypto');
var Lawncipher = require('../');
var Long = require('long');
var faker = require('faker');

Lawncipher.init();

var runMega = process.argv.length > 2 && process.argv[2] == 'mega';

var mkdirp = require('mkdirp');
var rmdirr = require('rmdir');

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

function randomInt(){
	var b = crypto.randomBytes(4);
	return (b[0] << 24) + (b[1] << 16) + (b[2] << 8) + b[3]
}

function clock(s){
	if (!s) return process.hrtime();
	var d = process.hrtime(s);
	return Math.round(d[0] * 1000 + d[1] / 1000000);
}

function basicTests(next, type){
	var indexKey = randomBuffer(32);
	var testIndexSettings;

	var k1, k2;
	var v1, v2;

	function saveIndex(_next){
		rmdirr(testIndexPath, function(err){
			if (err) throw err;

			if (!type || type == 'string'){
				k1 = 'test', v1 = 1;
				k2 = 'hello', v2 = 2;
			} else if (type == 'number'){
				k1 = 2, v1 = 'hello';
				k2 = 1, v2 = 'test';
			} else if (type == 'date'){
				k1 = new Date();
				k2 = new Date(k1.getTime() + 1000);
				v1 = 'hello';
				v2 = 'test';
			} else throw new Error('unknown index type:' + type);

			testIndexSettings = {
				rootPath: __dirname,
				collectionName: 'test_index',
				indexName: 'index',
				collectionKey: indexKey,
				pearsonSeed: testSeed,
				indexKeyType: type,
			};

			var testIndex = new Index(testIndexSettings, function(loadErr){
				if (loadErr) throw loadErr;

				testIndex.map(function(currentDoc, emit){
					console.error('mapFn call on an empty index!!!');
					console.error('currentDoc: ' + JSON.stringify(currentDoc));
					process.exit(1);
				}, function(e, results){
					if (e) throw e;

					testIndex.add(k1, v1, function(e){
						if (e) throw e;

						testIndex.add(k2, v2, function(e){
							if (e) throw e;

							_next();
						});
					});
				});
			});
		});
	}

	function loadIndex(_next){
		var testIndex = new Index(testIndexSettings, function(loadErr){
			if (loadErr) throw loadErr;

			testIndex.lookup(k1, function(err, value){
				if (err) throw err;

				assert(deepObjectEquality(v1, value));

				testIndex.lookup(k2, function(err, value){
					if (err) throw err;

					assert(deepObjectEquality(v2, value));

					_next();
				});
			});
		});
	}

	saveIndex(function(){
		loadIndex(next);
	});
}

function returnAndLog(v){
	console.log(v);
	return v;
}

//A testing method, designed to test save, loading, lookup and removal of a non-negligeable data set
function loadTests(docCount, cb, usingNoTrigger, indexType, unique, maxLoadedDataSize){
	docCount = docCount || 1000;
	if (typeof cb != 'function') throw new TypeError('cb must be a function');

	var testIndex;
	var indexKey = randomBuffer(32);
	var indexSeed = PearsonSeedGenerator();
	var testIndexSettings;

	var dataSet = new Array(docCount);

	console.log('Generating ' + docCount + ' documents');

	if (indexType == 'collection' || indexType == 'string' || !indexType){
		for (var i = 0; i < docCount; i++){
			dataSet[i] = {k: faker.random.uuid(), v: newRandomUserDoc()};
		}
		//indexType = 'index';
	} else if (indexType == 'number') {
		for (var i = 0; i < docCount; i++){
			dataSet[i] = {k: randomInt(), v: faker.random.uuid()};
		}
	} else if (indexType == 'date'){
		for (var i = 0; i < docCount; i++){
			dataSet[i] = {k: new Date(faker.date.past()), v: faker.random.uuid()};
		}
	} else if (indexType == 'boolean'){
		for (var i = 0; i < docCount; i++){
			dataSet[i] = {k: faker.random.boolean(), v: faker.random.uuid()};
		}
	} else if (indexType = 'buffer'){
		for (var i = 0; i < docCount; i++){
			dataSet[i] = {k: crypto.randomBytes(faker.random.number(100)), v: faker.random.uuid()};
		}
	} else {
		throw new TypeError('unknown index type: ' + indexType);
	}

	testIndexSettings = {
		rootPath: __dirname,
		collectionName: 'test_index',
		indexName: 'index',
		collectionKey: indexKey,
		pearsonSeed: indexSeed,
		indexKeyType: indexType,
		uniqueIndex: unique,
		_maxLoadedDataSize: maxLoadedDataSize,
	};

	function saveIndex(_next){
		rmdirr(testIndexPath, function(err){
			if (err) throw err;

			console.log('Starting index writes');
			var saveStart = clock();
			testIndex = new Index(testIndexSettings, function(loadErr){
				if (loadErr) throw loadErr;

				console.log('Saving ' + docCount + ' documents' + (usingNoTrigger ? ' (while using noTrigger = true)' : ''));

				if (usingNoTrigger){
					for (var i = 0; i < docCount - 1; i++){
						testIndex.add(dataSet[i].k, dataSet[i].v, undefined, true);
					}

					testIndex.add(dataSet[dataSet.length - 1].k, dataSet[dataSet.length - 1].v, function(err){
						if (err) throw err;

						var saveDuration = clock(saveStart);
						console.log('Saving ' + docCount + ' documents took ' + saveDuration + 'ms (noTrigger = true)');
						_next();
					});
				} else {
					//usingNoTrigger == false -> async everything

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
							var saveDuration = clock(saveStart);
							console.log('Saving ' + docCount + ' documents took ' + saveDuration + 'ms (noTrigger = false)')
							_next();
						} else {
							if (addIndex % 100 == 0) setTimeout(addOne, 0);
							else addOne();
						}
					}

					addOne();
				}
			});
		});
	}

	function loadIndex(_next){
		var loadStart = clock();
		testIndex = new Index(testIndexSettings, function(loadErr){
			if (loadErr) throw loadErr;

			console.log('Loading and looking up ' + docCount + ' documents');

			if (indexType != 'boolean'){
				var lookupIndex = 0;

				function lookupOne(){
					var currentTuple = dataSet[lookupIndex];
					testIndex.lookup(currentTuple.k, function(err, value){
						if (err) throw err;

						//console.log('Current key: ' + currentTuple.k);
						//console.log('Found value: ' + JSON.stringify(value));
						//console.log('Expected value: ' + JSON.stringify(currentTuple.v));
						if (indexType == 'boolean'){
							if (Array.isArray(value)){
								assert(value.indexOf(currentTuple.v) != -1);
							} else {
								assert(deepObjectEquality(currentTuple.v, value));
							}
						} else assert(deepObjectEquality(currentTuple.v, value));

						nextLookup();
					});
				}

				function nextLookup(){
					lookupIndex++;
					if (lookupIndex == docCount){
						var loadDuration = clock(loadStart);
						console.log('Loading and looking up ' + docCount + ' documents took ' + loadDuration + 'ms');
						_next();
					} else {
						if (lookupIndex % 100 == 0) setTimeout(lookupOne, 0);
						else lookupOne();
					}
				}

				lookupOne();
			} else {
				var truePairs = {}, falsePairs = {};
				dataSet.map(function(currentVector){
					if (currentVector.k === true) truePairs[currentVector.v] = true;
					else if (currentVector.k === false) falsePairs[currentVector.v] = false;
					else throw new TypeError('Unexpected key type: ' + currentVector.k);
				});

				var truePairsList = Object.keys(truePairs),
					falsePairsList = Object.keys(falsePairs);

				testIndex.lookup(true, function(err, values){
					if (err) throw err;

					assert(truePairsList.length === values.length);

					for (var i = 0; i < values.length; i++){
						assert(truePairs[values[i]] === true);
					}

					testIndex.lookup(false, function(err, values){
						if (err) throw err;

						assert(falsePairsList.length === values.length);

						for (var i = 0; i < values.length; i++){
							assert(falsePairs[values[i]] === false);
						}

						var loadDuration = clock(loadStart);
						console.log('Loading and looking up ' + docCount + ' documents took ' + loadDuration + 'ms');
						_next();
					});
				});
			}
		});
	}

	function destroyIndex(_next){
		if (!testIndex) throw new Error('testIndex must be defined');

		console.log('Removing ' + docCount + ' documents');

		var destroyStart = clock();

		/*if (usingNoTrigger){
			console.log('usingNoTrigger');
			for (var i = 0; i < docCount - 1; i++){
				testIndex.remove(dataSet[i].k, indexType == 'boolean' ? dataSet[i].v : undefined, undefined, true);
			}

			testIndex.remove(dataSet[docCount - 1].k, indexType == 'boolean' ? dataSet[docCount - 1].v : undefined, function(err){
				if (err) throw err;

				var destroyDuration = clock(destroyStart);
				console.log('Removing ' + docCount + ' documents took ' + destroyDuration + 'ms (noTrigger = true)');
				_next();
			});

		} else {*/
			var removeIndex = 0;

			function removeOne(){
				var currentTuple = dataSet[removeIndex];
				testIndex.remove(currentTuple.k, indexType == 'boolean' ? currentTuple.v : undefined, function(err){
					if (err) throw err;

					if (!(indexType == 'boolean')){
						testIndex.lookup(currentTuple.k, function(err, remainingValue){
							if (err) throw err;

							assert(!(remainingValue || (Array.isArray(remainingValue) && remainingValue.length > 0)), 'Cannot assert that the element no. ' + removeIndex + ' has been removed; currentTuple:\n' + JSON.stringify(currentTuple, undefined, '\t') + '\n\nvalue found:\n' + JSON.stringify(remainingValue, undefined, '\t'));

							nextRemoval();
						});
					} else nextRemoval();
				}, usingNoTrigger && removeIndex < docCount - 1);
			}

			function nextRemoval(){
				removeIndex++;
				if (removeIndex == docCount){
					var destroyDuration = clock(destroyStart);
					console.log('Removing ' + docCount + ' documents took ' + destroyDuration + 'ms (noTrigger = false)');
					_next();
				} else {
					if (removeIndex % 100 == 0) setTimeout(removeOne, 0);
					else removeOne();
				}
			}

			removeOne();
		//}
	}

	function checkDestruction(_next){
		if (!testIndex) throw new Error('testIndex must be defined');

		console.log('Checking the non-existence of ' + docCount + ' documents');

		var lookupStart = clock();

		if (indexType != 'boolean'){
			var lookupIndex = 0;

			function lookupOne(){
				var currentTuple = dataSet[lookupIndex];
				testIndex.lookup(currentTuple.k, function(err, value){
					if (err) throw err;

					if (indexType == 'boolean') console.log('val: ' + JSON.stringify(value));

					assert(!(value || (Array.isArray(value) && value.length > 0)), 'Cannot assert that the element no. ' + lookupIndex + ' has been removed; currentTuple:\n' + JSON.stringify(currentTuple, undefined, '\t') + '\n\nvalue found:\n' + JSON.stringify(value, undefined, '\t'));

					nextLookup();
				});
			}

			function nextLookup(){
				lookupIndex++;
				if (lookupIndex == docCount){
					var lookupDuration = clock(lookupStart);
					console.log('Looking up ' + docCount + ' non-existing docs took ' + lookupDuration + 'ms');
					_next();
				} else {
					if (lookupIndex % 100 == 0) setTimeout(lookupOne, 0);
					else lookupOne();
				}
			}

			lookupOne();
		} else {
			var truePairs = {}, falsePairs = {};
			dataSet.map(function(currentVector){
				if (currentVector.k === true) truePairs[currentVector.v] = true;
				else if (currentVector.k === false) falsePairs[currentVector.v] = false;
				else throw new TypeError('Unexpected key type: ' + currentVector.k);
			});

			var truePairsList = Object.keys(truePairs),
				falsePairsList = Object.keys(falsePairs);

			testIndex.lookup(true, function(err, values){
				if (err) throw err;

				assert(values.length == 0);

				testIndex.lookup(false, function(err, values){
					if (err) throw err;

					assert(values.length === 0);

					var lookupDuration = clock(lookupStart);
					console.log('Looking up ' + docCount + ' non-existing docs took ' + lookupDuration + 'ms');
					_next();
				});
			});
		}
	}

	saveIndex(function(){
		setTimeout(function(){
			loadIndex(function(){
				destroyIndex(function(){
					setTimeout(function(){
						checkDestruction(cb);
					}, 5000);
				});
			});
		}, 2500);
	});
}

showSectionMessage('Basic index testing');
basicTests(function(){
	console.log('done');

	showSectionMessage('Basic indexing of numbers');
	basicTests(function(){
		console.log('done');

		showSectionMessage('Basic indexing of dates');
		basicTests(function(){
			console.log('done');

			//Basic testing of boolean indexing still to be done

			showSectionMessage('Data load index testing');
			var st1 = clock();
			loadTests(undefined, function(){
				var duration = clock(st1);
				console.log('done in ' + duration.toString() + 'ms');

				showSectionMessage('Data load index testing (noTrigger == true)');
				var st2 = clock();
				loadTests(undefined, function(){
					var duration = clock(st2);
					console.log('done in ' + duration.toString() + 'ms');

					showSectionMessage('Number index testing (noTrigger == true)');
					var stNumber = clock();
					loadTests(undefined, function(){
						var duration = clock(stNumber);
						console.log('done in ' + duration.toString() + 'ms');

						showSectionMessage('Date index testing (noTrigger == true)');
						var stDate = clock();
						loadTests(undefined, function(){
							var duration = clock(stDate);
							console.log('done in ' + duration.toString() + 'ms');

							showSectionMessage('Boolean index testing (noTrigger == true)');
							var stBoolean = clock();
							loadTests(undefined, function(){
								var duration = clock(stBoolean);
								console.log('done in ' + duration.toString() + 'ms');

								showSectionMessage('Bigger load index testing');
								var st3 = clock();
								loadTests(100000, function(){
									var duration = clock(st3);
									console.log('done in ' + duration.toString() + 'ms');

									/*
									//Dynamic index unloading (with a maxDataLoad quota; disabled)
									showSectionMessage('Dynamic index loading test');
									var st_memory = clock();
									loadTests(10000, function(){
											var duration = clock(st_memory);
											console.log('done in ' + duration.toString() + 'ms');

											if (!runMega) return;

											showSectionMessage('Mega load index testing (500k docs)');
											var st4 = clock();
											loadTests(500000, function(){
												var duration = clock(st4);
												console.log('done in ' + duration.toString() + 'ms');
											}, true);
									}, true, undefined, true, 1024 * 1024);*/ //type: default, 'string'; unique: false; maxLoadedDataSize = 1MB

									if (!runMega) return;

									showSectionMessage('Mega load index testing (500k docs)');
									var st4 = clock();
									loadTests(500000, function(){
										var duration = clock(st4);
										console.log('done in ' + duration.toString() + 'ms');
									}, true);
								}, true);
							}, true, 'boolean');
						}, true, 'date');
					}, true, 'number');
				}, true);
			});
		}, 'date');
	}, 'number');
});

//Dynamic index unloading (with a maxDataLoad quota; disabled)
/*showSectionMessage('Dynamic index loading test');
var st_memory = clock();
loadTests(10000, function(){
		var duration = clock(st_memory);
		console.log('done in ' + duration.toString() + 'ms');

}, true, undefined, false, 1024 * 1024);*/ //noTrigger: true, type: default, 'string'; unique: false; maxLoadedDataSize = 1MB

function showSectionMessage(m){
	console.log('');
	console.log('----------------------');
	console.log(m);
	console.log('----------------------');
}
