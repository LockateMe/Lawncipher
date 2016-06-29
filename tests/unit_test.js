(function(root, factory){
	var _nodeContext = false;
	if (typeof process === 'object' && process != null){
		_nodeContext = true;
	}

	if (typeof define === 'function' && define.amd){
		define(['exports', 'Lawncipher', 'console', _nodeContext.toString(), 'require', 'window'], factory);
	} else if (typeof exports !== 'undefined'){
		factory(exports, _nodeContext ? require('../lawncipher.js') : require('./lawncipher.js'), console, _nodeContext, require, !_nodeContext ? window : undefined);
	} else {
		var cb = root.LawncipherTest && root.LawncipherTest.onload;
		factory((root.LawncipherTest = {}), Lawncipher, console, _nodeContext, typeof require != 'undefined' && require, !_nodeContext ? window : undefined);
		if (typeof cb == 'function'){
			cb(root.LawncipherTest);
		}
	}

	if (_nodeContext) runNodeTests();

	function runNodeTests(){
		if (!module.parent){
			var path = require('path');
			var mkdirp = require('mkdirp');

			var testPath = path.join(__dirname, 'test_db');

			mkdirp(testPath, function(err){
				if (err){
					console.error('Error while creating test_db directory: ' + err);
					process.exit(1);
				}

				exports.test(testPath, undefined, function(){
					console.log('Lawncipher works in Node.js! Yeeaaaah');
				});
			});
		}
	}
}(this, function(exports, Lawncipher, console, nodeContext, require, window){

	var fs;
	var randomBuffer;
	var rmdirr;

	if (nodeContext){
		fs = require('fs');
		rmdirr = require('rmdir');

		var crypto = require('crypto');
		var Buffer = require('buffer').Buffer;

		randomBuffer = function(size){
			if (!(typeof size == 'number' && size > 0 && Math.floor(size) == size)) throw new TypeError('size must be a strictly positive integer');
			var rand = crypto.randomBytes(size);

			return bufToUI8(rand);
		};

		function bufToUI8(b){
			if (!Buffer.isBuffer(b)) throw new TypeError('b must be a buffer');
			var ab = new ArrayBuffer(b.length);
			var ua = new Uint8Array(ab);
			for (var i = 0; i < b.length; i++) ua[i] = b[i];
			return ua;
		}

		function UI8ToBuf(ui8){
			return new Buffer(ui8);
		}

	} else {

		randomBuffer = function(size){
			if (!(typeof size == 'number' && size > 0 && Math.floor(size) == size)) throw new TypeError('size must be a strictly positive integer');
			var b = new Uint8Array(size);
			window.crypto.getRandomValues(b);
			return b;
		};

	}

	var passCharset = 'aAbBcCdDeEfFgGhHiIjJkKlLmMnNoOpPqQrRsStTuUvVwWxXyYzZ0123456789';

	function randomPassword(length){
		var s = '';
		for (var i = 0; i < length; i++) s += passCharset[Math.floor(Math.random() * passCharset.length)];
		return s;
	}

	exports.test = function(testPath, _fs, finalCallback){

		fs = _fs || fs;

		if (!fs) throw new Error('No file system has been provided for this test');

		if (!nodeContext) rmdirr = fs.rmdirr;

		var dbPath = testPath || 'test_db';

		if (finalCallback && typeof finalCallback != 'function') throw new TypeErorr('when defined, final callback must be a function');

		var db = new Lawncipher.db(dbPath, fs);
		var collections = {};
		var docs = {};

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
		var rootPassword = randomPassword(12);

		/*For future tests reorganization
		function testWithRootKey(cb){

		}

		function testWithPassword(cb){

		}

		function testUnmodelledCollection(cb){

		}

		function testModelledCollection(cb){

		}*/

		var params = [
			//Testing password protection
			{
				message: 'Opening with a password',
				expectedFailure: false
			},
			{
				message: 'Checking that the DB is open',
				result: true
			},
			{
				message: 'Opening a collection',
				collectionName: 'pass_test_collection'
			},
			{
				message: 'Saving a doc',
				index: {sender: 'me', receiver: 'me', message: 'forever alone'},
				collectionName: 'pass_test_collection'
			},
			{
				message: 'Closing collection',
				collectionName: 'pass_test_collection'
			},
			{
				message: 'Closing DB'
			},
			{
				message: 'Re-opening with password',
				password: randomPassword(12),
				expectedFailure: true
			},
			{
				message: 'Re-opening, with the correct password'
			},
			{
				message: 'Re-opening collection',
				collectionName: 'pass_test_collection'
			},
			{
				message: 'Checking index doc presence (via count)',
				query: {sender: 'me', receiver: 'me', message: 'forever alone'},
				collectionName: 'pass_test_collection',
				result: 1
			},
			{
				message: 'Changing the password',
				newPassword: randomPassword(12)
			},
			{
				message: 'Closing the collection',
				collectionName: 'pass_test_collection'
			},
			{
				message: 'Closing DB'
			},
			{
				message: 'Re-opening DB with new password'
			},
			{
				message: 'Re-opening collection',
				collectionName: 'pass_test_collection'
			},
			{
				message: 'Checking doc existence again, with count',
				query: {sender: 'me', receiver: 'me', message: 'forever alone'},
				collectionName: 'pass_test_collection',
				result: 1
			},
			{
				message: 'Closing collection, finally',
				collectionName: 'pass_test_collection'
			},
			{
				message: 'Closing the DB again. Will re-open with root keys and test all operations',
				clearDB: true
			},
			//Testing DB operations and operators, opening the DB with a rootKey (instead of a rootPassword)
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
			/*{
				message: 'Counting items (without query)',
				collectionName: 'test_nomodel_collection',
				result: 0
			},*/
			{
				message: 'Saving a blob',
				blob: 'Hello world',
				collectionName: 'test_nomodel_collection'
			},
			/*{
				message: 'Counting items (without query)',
				collectionName: 'test_nomodel_collection',
				result: 1
			},*/
			{
				message: 'Saving an index doc',
				index: {identifier: 'meh', purpose: 'Testing this stuff'},
				collectionName: 'test_nomodel_collection'
			},
			/*{
				message: 'Counting items (without query)',
				collectionName: 'test_nomodel_collection',
				result: 2
			},*/
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
			/*{
				message: 'Counting items (without query)',
				collectionName: 'test_nomodel_collection',
				result: 7
			},*/
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
			/*{
				message: 'Getting the size of the collection',
				collectionName: 'test_nomodel_collection'
			},*/
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
			//Testing with rootPassword
			test_openWithPassword,
			test_isOpen,
			test_collection,
			test_save,
			test_closeCollection,
			test_close,
			test_openWithPassword,
			test_openWithPassword,
			test_collection,
			test_count,
			test_changePassword,
			test_closeCollection,
			test_close,
			test_openWithPassword,
			test_collection,
			test_count,
			test_closeCollection,
			test_close,
			//Testing DB operations and features, using a rootKey
			test_open,
			test_isOpen,
			test_listCollections,
			test_collection,
			test_listCollections,
			//test_count,
			test_save, //Saving a blob
			//test_count,
			test_save, //Saving an index doc
			//test_count,
			test_save, //Saving an index doc
			test_save, //Saving an index doc
			test_save, //Saving an index doc
			test_save, //Saving a blob & index doc
			test_save, //Saving a blob & index doc, with index data extraction
			//test_count, //Counting without compound query
			test_closeCollection, //Closing collection and re-opening it
			test_collection,
			test_count,
			test_changeKey,
			test_close,
			test_open,
			test_collection,
			test_count,
			//test_size,
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

		function test_openWithPassword(next){
			var _params = getParams();
			db.openWithPassword(_params.password || rootPassword, function(err){
				if (err){
					if (!_params.expectedFailure) next(err);
					else next();
					return;
				}

				next();
			});
		}

		function test_close(next){
			var _params = getParams();
			try {
				db.close();
			} catch (e){
				next(e);
				return;
			}

			if (_params.clearDB) rmdirr(dbPath, next);
			else next();
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

		function test_changePassword(next){
			var _params = getParams();

			db.changePassword(_params.newPassword, function(err){
				if (err){
					next(err);
					return;
				}
				rootPassword = _params.newPassword;
				next();
			});;
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
				if (!id) throw new Error('id cannot be undefined!');
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
			collections[collectionName].count(query, function(err, r){
				if (err){
					next(err);
					return;
				}

				if (r != _params.result) next('Unexpected count: ' + r);
				else next();
			});
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
			collections[collectionName].getTTL(q, function(err, ttls){
				if (err) throw err;

				console.log('Currently set TTLs matching ' + JSON.stringify(q) + ': ' + JSON.stringify(ttls));
				next();
			});
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
					throw err;
					return;
				}
				taskIndex++;
				if (taskIndex == tasks.length) generalCallback();
				else doOne();
			}

			doOne();
		}

		rmdirr(dbPath, function(err){
			if (err){
				console.error('Error while deleting any existing test database');
				console.error(err);
				return;
			}

			queue(tasks, function(){
				console.log('All lawncipher tests completed with success!');
				if (finalCallback) finalCallback();
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

	};

}));
