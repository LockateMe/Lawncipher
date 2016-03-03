(function (LockateMeTests, window){

	function testLawncipher(){
		if (!window.Lawncipher) throw new Error('lawncipher not defined');
		if (!window.fs) throw new Error('fs not defined');

		var fs = window.fs;
		var console = window.console;
		var Lawncipher = window.Lawncipher;

		var dbPath = 'test_db';
		var db = new Lawncipher(dbPath);
		var collections = {};
		var docs = {};

		function randomBuffer(size){
			if (!(typeof size == 'number' && size > 0 && Math.floor(size) == size)) throw new TypeError('size must be a strictly positive integer');
			var b = new Uint8Array(size);
			window.crypto.getRandomValues(b);
			return b;
		}

		var userA = {
			firstName: 'A',
			lastName: 'B',
			isFriend: true,
			id: '1a2b',
			creationOrder: 1,
			creationDate: new Date(Date.now() - 1000),
			messages: ['Hello', 'world'],
			status: {lastSeen: Date.now() - 3600*1000},
			notes: {},
			things: 'stuff'
		};

		var userB = {
			firstName: 'C',
			lastName: 'D',
			isFriend: true,
			id: '1a2c',
			creationOrder: 2,
			creationDate: new Date(Date.now() - 2000),
			messages: ['Hello', 'world'],
			status: {lastSeen: Date.now() - 3600*1000},
			notes: {},
			things: 'stuff'
		};

		var userC = {
			firstName: 'E',
			lastName: 'F',
			isFriend: true,
			id: '1a2d',
			creationOrder: 3,
			creationDate: new Date(Date.now() - 3000),
			messages: ['Hello', 'world'],
			status: {lastSeen: Date.now() - 3600*1000},
			notes: {},
			things: 'stuff'
		};

		var userD = {
			firstName: 'G',
			lastName: 'H',
			isFriend: true,
			id: '1a2e',
			creationOrder: 4,
			creationDate: new Date(Date.now() - 4000),
			messages: ['Hello', 'world'],
			status: {lastSeen: Date.now() - 3600*1000},
			notes: {},
			things: 'stuff'
		};

		var rootKey = randomBuffer(32);

		var params = [
			{
				message: 'Opening database'
			},
			{
				message: 'Checking that the DB is open',
				result: true
			},
			{
				message: 'Listing (zero) collections',
				result: []
			},
			{
				message: 'Opening a collection',
				collectionName: 'test_nomodel_collection'
			},
			{
				message: 'Listing (one) collections',
				result: ['test_nomodel_collection']
			},
			{
				message: 'Counting items (without query)',
				collectionName: 'test_nomodel_collection',
				result: 0
			},
			{
				message: 'Saving a blob',
				blob: 'Hello world',
				collectionName: 'test_nomodel_collection'
			},
			{
				message: 'Counting items (without query)',
				collectionName: 'test_nomodel_collection',
				result: 1
			},
			{
				message: 'Saving an index doc',
				index: {identifier: 'meh', purpose: 'Testing this stuff'},
				collectionName: 'test_nomodel_collection'
			},
			{
				message: 'Counting items (without query)',
				collectionName: 'test_nomodel_collection',
				result: 2
			},
			{
				message: 'Saving an index doc',
				index: {identifier: 'doc1', purpose: 'Testing this stuff, again'},
				collectionName: 'test_nomodel_collection'
			},
			{
				message: 'Saving an index doc',
				index: {identifier: 'doc2', purpose: 'Testing this stuff, a third time'},
				collectionName: 'test_nomodel_collection'
			},
			{
				message: 'Saving an index doc',
				index: {identifier: 'doc2', identifier2: 'compound', purpose: 'Testing this stuff. Compound queries and stuff'},
				collectionName: 'test_nomodel_collection'
			},
			{
				message: 'Saving an index doc',
				index: {identifier: 'doc2', identifier2: 'compound', purpose: 'Testing this stuff. Compound queries and stuff'},
				collectionName: 'test_nomodel_collection',
				blob: 'Hello world'
			},
			{
				message: 'Saving a doc, with index data extraction',
				collectionName: 'test_nomodel_collection',
				blob: {
					identifier: 'doc2',
					purpose: '#swag #idiot',
					when: 'tomorrow'
				},
				index: ['identifier', 'when']
			},
			{
				message: 'Counting items (without query)',
				collectionName: 'test_nomodel_collection',
				result: 7
			},
			{
				message: 'Closing collection (before re-opening it)',
				collectionName: 'test_nomodel_collection'
			},
			{
				message: 'Re-opening the collection',
				collectionName: 'test_nomodel_collection',
			},
			{
				message: 'Counting items (with compound query)',
				collectionName: 'test_nomodel_collection',
				query: {'$not': {identifier: 'doc2'}},
				result: 3
			},
			{
				message: 'Changing root key',
				newKey: randomBuffer(32)
			},
			{
				message: 'Closing lawncipher'
			},
			{
				message: 'Re-opening lawncipher after changing the root key'
			},
			{
				message: 'Re-opening the collection',
				collectionName: 'test_nomodel_collection'
			},
			{
				message: 'Counting items (with compound query)',
				collectionName: 'test_nomodel_collection',
				query: {'$not': {identifier: 'doc2'}},
				result: 3
			},
			{
				message: 'Getting the size of the collection',
				collectionName: 'test_nomodel_collection'
			},
			{
				message: 'Looking for the blob (with `find`)',
				collectionName: 'test_nomodel_collection',
				docIndex: 0,
				result: ['Hello world']
			},
			{
				message: 'Looking for the blob (with `findOne`)',
				collectionName: 'test_nomodel_collection',
				docIndex: 0,
				result: 'Hello world'
			},
			{
				message: 'Looking for the index doc (with `find`)',
				collectionName: 'test_nomodel_collection',
				docIndex: 1,
				result: [{identifier: 'meh', purpose: 'Testing this stuff'}]
			},
			{
				message: 'Looking for the index doc (with `findOne`)',
				collectionName: 'test_nomodel_collection',
				docIndex: 1,
				result: {identifier: 'meh', purpose: 'Testing this stuff'}
			},
			{
				message: 'Looking for the index doc (with `find`)',
				collectionName: 'test_nomodel_collection',
				query: {identifier: 'meh'},
				result: [{identifier: 'meh', purpose: 'Testing this stuff'}]
			},
			{
				message: 'Looking for the index doc (with `findOne`)',
				collectionName: 'test_nomodel_collection',
				query: {identifier: 'meh'},
				result: {identifier: 'meh', purpose: 'Testing this stuff'}
			},
			{
				message: 'Looking for the index doc (with `find`)',
				collectionName: 'test_nomodel_collection',
				query: {identifier: 'doc2', identifier2: 'compound'},
				result: ['Hello world', {identifier: 'doc2', identifier2: 'compound', purpose: 'Testing this stuff. Compound queries and stuff'}]
			},
			{
				message: 'Looking for the index doc (with `findOne`)',
				collectionName: 'test_nomodel_collection',
				query: {identifier: 'doc2', identifier2: 'compound'},
				result: {identifier: 'doc2', identifier2: 'compound', purpose: 'Testing this stuff. Compound queries and stuff'}
			},
			{
				message: 'Looking for docs, using $not (with `find`)',
				collectionName: 'test_nomodel_collection',
				query: {'$not': {identifier: 'doc2'}},
				result: [
					'Hello world',
					{identifier: 'meh', purpose: 'Testing this stuff'},
					{identifier: 'doc1', purpose: 'Testing this stuff, again'}
				]
			},
			{
				message: 'Looking for docs, using $or (with `find`)',
				collectionName: 'test_nomodel_collection',
				query: {'$or': [{identifier: 'meh'}, {identifier: 'doc1'}]},
				result: [
					{identifier: 'meh', purpose: 'Testing this stuff'},
					{identifier: 'doc1', purpose: 'Testing this stuff, again'}
				]
			},
			{
				message: 'Looking for doc with extracted index data',
				collectionName: 'test_nomodel_collection',
				query: {identifier: 'doc2', when: 'tomorrow'},
				result: {identifier: 'doc2', purpose: '#swag #idiot', when: 'tomorrow'}
			},
			{
				message: 'Deleting a doc by id',
				collectionName: 'test_nomodel_collection',
				docIndex: 0
			},
			{
				message: 'Checking that the doc has been indeed deleted',
				collectionName: 'test_nomodel_collection',
				docIndex: 0,
				result: undefined
			},
			{
				message: 'Updating docs with {identifier: "doc2", identifier2: "compound"}',
				data: {purpose: 'This has been updated'},
				query: {identifier: 'doc2', identifier2: 'compound'},
				collectionName: 'test_nomodel_collection',
				indexOnly: true
			},
			{
				message: 'Counting the documents with {identifier: "doc2", identifier2: "compound"}',
				collectionName: 'test_nomodel_collection',
				query: {identifier: "doc2", identifier2: "compound", purpose: "This has been updated"},
				result: 2
			},
			{
				message: 'Deleting a doc with a compound proposition',
				collectionName: 'test_nomodel_collection',
				query: {identifier: 'doc2'}
			},
			{
				message: 'Checking that the docs have indeed been deleted',
				collectionName: 'test_nomodel_collection',
				query: {identifier: 'doc2'},
				result: []
			},
			{
				message: 'Adding a doc with a ttl',
				collectionName: 'test_nomodel_collection',
				blob: 'Hello world. It\'s gonna disappear',
				index: {expires: true},
				ttl: 4000
			},
			{
				message: 'Adding an other doc with a ttl',
				collectionName: 'test_nomodel_collection',
				blob: 'Hello world. This one will disappear as well',
				index: {expires: true, docId: 2},
				ttl: 4000
			},
			{
				message: 'Checking that the ttl-ed doc exists',
				collectionName: 'test_nomodel_collection',
				query: {expires: true},
				result: 2
			},
			{
				message: 'Getting the TTL of docs {expires: true}',
				collectionName: 'test_nomodel_collection',
				query: {expires: true}
			},
			{
				message: 'Setting a new TTL for docs currently with TTL',
				collectionName: 'test_nomodel_collection',
				query: {expires: true},
				ttl: 8000
			},
			{
				message: 'Waiting for first ttl to happen',
				wait: 6000
			},
			{
				message: 'Checking that the TTL has indeed been updated and that the documents still live',
				collectionName: 'test_nomodel_collection',
				query: {expires: true},
				result: 2
			},
			{
				message: 'Waiting for second ttl to happen (waiting 5 seconds after second TTL should be reached)',
				wait: 7000
			},
			{
				message: 'Checking that the ttl-ed doc disappeared',
				collectionName: 'test_nomodel_collection',
				query: {expires: true},
				result: 0
			},
			{
				message: 'Deleting a collection',
				collectionName: 'test_nomodel_collection'
			},
			{
				message: 'Listing (zero) collections',
				result: []
			},
			{
				message: 'Opening a collection',
				collectionName: 'test_model_collection',
				indexModel: {
					firstName: 'string',
					lastName: 'string',
					isFriend: 'boolean',
					id: {type: 'string', id: true},
					creationOrder: {type: 'number', unique: true},
					creationDate: 'date',
					messages: 'array',
					status: 'object',
					notes: '*'
				}
			},
			{
				message: 'Listing (one) collection',
				result: ['test_model_collection']
			},
			{
				message: 'Saving a doc',
				collectionName: 'test_model_collection',
				blob: userA,
				index: ['firstName', 'lastName', 'isFriend', 'id', 'creationOrder', 'creationDate', 'messages', 'status', 'notes']
			},
			{
				message: 'Saving a doc',
				collectionName: 'test_model_collection',
				blob: userB,
				index: ['firstName', 'lastName', 'isFriend', 'id', 'creationOrder', 'creationDate', 'messages', 'status', 'notes']
			},
			{
				message: 'Saving a doc',
				collectionName: 'test_model_collection',
				blob: userC,
				index: ['firstName', 'lastName', 'isFriend', 'id', 'creationOrder', 'creationDate', 'messages', 'status', 'notes']
			},
			{
				message: 'Saving a doc',
				collectionName: 'test_model_collection',
				blob: userD,
				index: ['firstName', 'lastName', 'isFriend', 'id', 'creationOrder', 'creationDate', 'messages', 'status', 'notes']
			},
			{
				message: 'Looking for the modelled doc (by id)',
				collectionName: 'test_model_collection',
				query: '1a2b',
				result: userA
			},
			{
				message: 'Looking for the modelled doc (compound query)',
				collectionName: 'test_model_collection',
				query: {firstName: 'A', lastName: 'B'},
				result: userA
			},
			{
				message: 'Looking for docs, with sorting',
				collectionName: 'test_model_collection',
				query: {'$sort': {id: 'asc'}},
				result: [userA, userB, userC, userD]
			},
			{
				message: 'Looking for docs, with sorting',
				collectionName: 'test_model_collection',
				query: {'$sort': {id: 'desc'}},
				result: [userD, userC, userB, userA]
			},
			{
				message: 'Looking for docs, with limitation and sorting',
				collectionName: 'test_model_collection',
				query: {$sort: {id: 'desc'}},
				result: [userD, userC],
				limit: 2
			},
			{
				message: 'Looking for docs, with sorting on dates',
				collectionName: 'test_model_collection',
				query: {$sort: {creationDate: 'asc'}},
				result: [userD, userC, userB, userA]
			},
			{
				message: 'Looking for docs, with sorting on dates',
				collectionName: 'test_model_collection',
				query: {$sort: {creationDate: 'desc'}},
				result: [userA, userB, userC, userD]
			},
			{
				message: 'Looking for docs, with sorting on dates and limitation',
				collectionName: 'test_model_collection',
				query: {$sort: {creationDate: 'asc'}},
				result: [userD],
				limit: 1
			},
			{
				message: 'Looking for docs, with sorting on dates and limitation',
				collectionName: 'test_model_collection',
				query: {$sort: {creationDate: 'desc'}},
				result: [userA, userB],
				limit: 2
			},
			{
				message: 'Looking for docs, with sorting on dates, skipping and limitation',
				collectionName: 'test_model_collection',
				query: {$sort: {creationDate: 'asc'}, $skip: 1},
				result: [userC, userB],
				limit: 2
			},
			{
				message: 'Looking for docs, with sorting on dates, skipping and limitation',
				collectionName: 'test_model_collection',
				query: {$sort: {creationDate: 'desc'}, $skip: 2},
				result: [userC, userD],
				limit: 2
			},
			{
				message: 'Closing the db'
			}
		];

		var tasks = [
			test_open,
			test_isOpen,
			test_listCollections,
			test_collection,
			test_listCollections,
			test_count,
			test_save, //Saving a blob
			test_count,
			test_save, //Saving an index doc
			test_count,
			test_save, //Saving an index doc
			test_save, //Saving an index doc
			test_save, //Saving an index doc
			test_save, //Saving a blob & index doc
			test_save, //Saving a blob & index doc, with index data extraction
			test_count,
			test_closeCollection, //Closing collection and re-opening it
			test_collection,
			test_count,
			test_changeKey,
			test_close,
			test_open,
			test_collection,
			test_count,
			test_size,
			test_find,
			test_findOne,
			test_find,
			test_findOne,
			test_find,
			test_findOne,
			test_find,
			test_findOne,
			test_find, //$not
			test_find, //$or
			test_findOne, //index extracted data
			test_remove,
			test_findOne,
			test_update, //Updating with indexOnly == true. There should be an other case for blob update
			test_count,
			test_remove,
			test_find,
			test_save, //TTL part
			test_save,
			test_count,
			test_getTTL,
			test_setTTL,
			test_wait,
			test_count,
			test_wait,
			test_count,
			test_dropCollection,
			test_listCollections,
			test_collection, //Opening a collection with model
			test_listCollections,
			test_save,
			test_save,
			test_save,
			test_save,
			test_findOne,
			test_findOne,
			test_find,
			test_find,
			test_find,
			test_find,
			test_find,
			test_find,
			test_find,
			test_find,
			test_find,
			test_close
		];

		var _currentParams;

		function test_open(next){
			var _params = getParams();
			db.open(rootKey, next);
		}

		function test_close(next){
			var _params = getParams();
			try {
				db.close();
			} catch (e){
				next(e);
				return;
			}
			next();
		}

		function test_changeKey(next){
			var _params = getParams();
			db.changeRootKey(_params.newKey, function(err){
				if (err){
					next(err);
					return;
				}
				rootKey = _params.newKey;
				next();
			});
		}

		function test_isOpen(next){
			var _params = getParams();
			var asExpected = _params.result == db.isOpen();
			if (asExpected) next();
			else next('DB open status; expected: ' + _params.result + '; actual state: ' + db.isOpen());
		}

		function test_listCollections(next){
			var _params = getParams();
			db.collections(function(err, collectionNames){
				if (err){
					next(err);
					return;
				}
				var foundCount = 0;
				for (var i = 0; i < collectionNames.length; i++){
					for (var j = 0; j < _params.result.length; j++){
						if (_params.result[j] == collectionNames[i]){
							foundCount++;
							break;
						}
					}
				}
				if (foundCount == _params.result.length){
					next();
				} else {
					next('Unexpected collection list: ' + JSON.stringify(collectionNames));
				}
			});
		}

		function test_collection(next){
			var _params = getParams();
			var name = _params.collectionName;
			db.collection(name, _params.indexModel, function(err, c){
				if (err) next(err);
				else {
					collections[name] = c;
					next();
				}
			});
		}

		function test_dropCollection(next){
			var _params = getParams();
			var name = _params.collectionName;
			db.dropCollection(name, next);
		}

		function test_closeCollection(next){
			var _params = getParams();
			var name = _params.collectionName;
			collections[name].close();
			delete collections[name];
			next();
		}

		function test_save(next){
			var _params = getParams();
			var collectionName = _params.collectionName;
			var blob = _params.blob;
			var index = _params.index;
			collections[collectionName].save(blob, index, function(err, id){
				if (err){
					next(err);
					return;
				}
				console.log('New docId: ' + id);
				if (!docs[collectionName]) docs[collectionName] = [id];
				else docs[collectionName].push(id);
				next();
			}, _params.overwrite, _params.ttl);
		}

		function test_count(next){
			var _params = getParams();
			var collectionName = _params.collectionName;
			var query = _params.query;
			var r = collections[collectionName].count(query);
			if (r != _params.result) next('Unexpected count: ' + r);
			else next();
		}

		function test_size(next){
			var _params = getParams();
			var collectionName = _params.collectionName;
			collections[collectionName].size(function(err, totalSize){
				if (err){
					next(err);
					return;
				}
				console.log('Total collection "' + collectionName + '" size: ' + totalSize);
				next();
			});
		}

		function test_find(next){
			var _params = getParams();
			var collectionName = _params.collectionName;
			var q = _params.query || docs[collectionName][_params.docIndex];
			collections[collectionName].find(q, function(err, resultSet){
				if (err){
					next(err);
					return;
				}
				if (!resultSet || resultSet.length == 0){
					if (!_params.result || _params.result.length == 0) next(); //Expecting no results
					else next('No result set returned, despite that we expected one');
					return;
				}
				var foundCount = 0;
				for (var i = 0; i < resultSet.length; i++){
					var currentResult = resultSet[i];
					for (var j = 0; j < _params.result.length; j++){
						var currentExpectedResult = _params.result[j];
						if (deepObjectEquality(currentResult, currentExpectedResult)){
							foundCount++;
							break;
						}
					}
				}
				if (foundCount == _params.result.length) next();
				else next('Unexpected results: ' + JSON.stringify(resultSet));
			}, _params.limit);
		}

		function test_findOne(next){
			var _params = getParams();
			var collectionName = _params.collectionName;
			var q = _params.query || docs[collectionName][_params.docIndex];
			collections[collectionName].findOne(q, function(err, result){
				if (err){
					next(err);
					return;
				}
				if (!(result || _params.result) || deepObjectEquality(result, _params.result)) next();
				else next('Unexpected result: ' + JSON.stringify(result));
			});
		}

		function test_update(next){
			var _params = getParams();
			var collectionName = _params.collectionName;
			var q = _params.query;
			var updateData = _params.data;
			var indexOnly = _params.indexOnly;
			collections[collectionName].update(q, updateData, function(err, updatedCount){
				if (err){
					next(err);
					return;
				}
				if (typeof _params.expectedCount != 'undefined'){
					if (_params.expectedCount == updatedCount) next();
					else next('Unexpected updatedCount: ' + updatedCount);
				} else next();
			}, indexOnly);
		}

		function test_remove(next){
			var _params = getParams();
			var collectionName = _params.collectionName;
			var q = _params.query || docs[collectionName][_params.docIndex];
			collections[collectionName].remove(q, function(err){
				if (err){
					next(err);
					return;
				}
				next();
			});
		}

		function test_wait(next){
			var _params = getParams();
			var sleepTime = _params.wait;
			if (sleepTime > Date.now()){
				sleepTime -= Date.now();
				if (sleepTime < 0) sleepTime = 0;
			}
			setTimeout(function(){
				next();
			}, sleepTime);
		}

		function test_getTTL(next){
			var _params = getParams();
			var collectionName = _params.collectionName
			var q = _params.query || docs[collectionName][_params.docIndex];
			var ttls = collections[collectionName].getTTL(q);
			console.log('Currently set TTLs matching ' + JSON.stringify(q) + ': ' + JSON.stringify(ttls));
			next();
		}

		function test_setTTL(next){
			var _params = getParams();
			var collectionName = _params.collectionName;
			var q = _params.query || docs[collectionName][_params.docIndex];
			var ttl = _params.ttl;
			collections[collectionName].setTTL(q, ttl, next);
		}

		function getParams(){
			var currentParams = params[0];
			_currentParams = currentParams;
			params.splice(0, 1);
			console.log('Current task: ' + currentParams.message);
			return currentParams;
		}

		function queue(tasks, generalCallback){
			var taskIndex = 0;

			function doOne(){
				tasks[taskIndex](next);
			}

			function next(err){
				if (err && !_currentParams.throws){
					console.error('Unexpected error');
					console.error(err);
					return;
				}
				taskIndex++;
				if (taskIndex == tasks.length) generalCallback();
				else doOne();
			}

			doOne();
		}

		fs.rmdirr(dbPath, function(err){
			if (err){
				console.error('Error while deleting any existing test database');
				console.error(err);
				return;
			}

			queue(tasks, function(){
				console.log('All lawncipher tests completed with success!');
			});
		});

		function deepObjectEquality(o1, o2){
			if (!(typeof o1 == typeof o2)) return false;
			var paramType = typeof o1;
			if (paramType == 'object'){
				if (Array.isArray(o1) || Array.isArray(o2)){
					if (xor(Array.isArray(o1), Array.isArray(o2))) return false;
					//We assume that both parameters are arrays
					if (o1.length != o2.length) return false;
					for (var i = 0; i < o1.length; i++){
						if (!deepObjectEquality(o1[i], o2[i])) return false;
					}
					return true;
				} else if (o1 instanceof Date || o2 instanceof Date){
					if (xor(o1 instanceof Date, o2 instanceof Date)) return false;
					return o1.getTime() == o2.getTime();
				}

				var o1Keys = Object.keys(o1);
				var o2Keys = Object.keys(o2);
				if (o1Keys.length != o2Keys.length) return false;

				var commonPropertiesNames = 0;
				for (var i = 0; i < o1Keys.length; i++){
					for (var j = 0; j < o2Keys.length; j++){
						if (o1Keys[i] == o2Keys[j]){
							commonPropertiesNames++;
							break;
						}
					}
				}

				if (commonPropertiesNames < o1Keys.length) return false;

				for (var i = 0; i < o1Keys.length; i++){
					if (!deepObjectEquality(o1[o1Keys[i]], o2[o1Keys[i]])) return false;
				}
				return true;
			} else if (paramType == 'function'){
				throw new TypeError('Cannot check equality for functions');
			} else return o1 == o2;
		}

		function xor(a, b){
			return (a && !b) || (!a && b);
		}

	}

	LockateMeTests.lawncipher = testLawncipher;

})(window.LockateMeTests = window.LockateMeTests || {}, window);
